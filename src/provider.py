"""OpenRouter provider with tiktoken, SummaryBuffer, and context management."""
import json
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, AsyncGenerator

import httpx

logger = logging.getLogger("linguclaw.provider")

@dataclass(frozen=True)
class Message:
    role: str
    content: str

@dataclass
class TokenBudget:
    max_total: int = 128000
    used: int = 0
    reserved: int = 4096
    threshold: float = 0.8
    @property
    def remaining(self) -> int: return max(0, self.max_total - self.used - self.reserved)
    @property
    def threshold_tokens(self) -> int: return int(self.max_total * self.threshold)
    def consume(self, t: int): self.used += t
    def max_tokens(self, prompt: int) -> int: return max(256, min(self.max_total - self.used - prompt, self.reserved))

@dataclass(frozen=True)
class LLMResponse:
    content: str
    usage: Dict[str, int] = field(default_factory=dict)
    model: str = ""
    finish_reason: Optional[str] = None
    error: Optional[str] = None

class TokenCounter:
    def __init__(self):
        self._enc = None
        try:
            import tiktoken
            self._enc = tiktoken.get_encoding("cl100k_base")
        except ImportError:
            pass
    def count(self, text: str) -> int:
        return len(self._enc.encode(text)) if self._enc else len(text) // 4 + 1
    def count_msgs(self, msgs: List[Message]) -> int:
        return sum(4 + self.count(m.content) for m in msgs) + 2

@dataclass
class SummaryBuffer:
    """Persistent mission summary."""
    mission: str = ""
    findings: List[str] = field(default_factory=list)
    actions: List[str] = field(default_factory=list)
    MAX: int = 10
    def set(self, m: str): self.mission = m
    def add_f(self, f: str):
        self.findings.append(f)
        if len(self.findings) > self.MAX: self.findings = self.findings[-self.MAX:]
    def add_a(self, a: str):
        self.actions.append(a)
        if len(self.actions) > self.MAX: self.actions = self.actions[-self.MAX:]
    def to_msg(self) -> Optional[Message]:
        parts = []
        if self.mission: parts.append(f"[Mission] {self.mission}")
        if self.findings: parts.append(f"[Findings] {' | '.join(self.findings[-5:])}")
        if self.actions: parts.append(f"[Done] {' | '.join(self.actions[-5:])}")
        return Message("system", "\n".join(parts)) if parts else None

@dataclass
class ContextWindow:
    msgs: List[Message] = field(default_factory=list)
    summaries: List[Message] = field(default_factory=list)
    buffer: SummaryBuffer = field(default_factory=SummaryBuffer)
    total_summarized: int = 0
    TURNS: int = 5
    MAX_SUMMARY: int = 500
    def __post_init__(self): self._counter = TokenCounter()
    def all_msgs(self) -> List[Message]:
        r = []
        m = self.buffer.to_msg()
        if m: r.append(m)
        return r + self.summaries + self.msgs
    def add(self, m: Message): self.msgs.append(m)
    def needs_summarize(self, th: int) -> bool: return self._counter.count_msgs(self.all_msgs()) > th
    async def summarize(self, prov: "OpenRouterProvider") -> bool:
        if len(self.msgs) < self.TURNS * 2: return False
        to_sum = self.msgs[:self.TURNS * 2]
        remaining = self.msgs[self.TURNS * 2:]
        prompt = "Summarize:\n" + "".join(f"{m.role.upper()}: {m.content[:200]}\n" for m in to_sum)
        tr = f"{self.total_summarized+1}-{self.total_summarized+self.TURNS}"
        try:
            r = await prov.complete([Message("system", "Summarize concisely."), Message("user", prompt)], 0.3, 300)
            txt = f"[Summary {tr}]: {r.content[:self.MAX_SUMMARY]}" if not r.error else f"[Summary {tr}]: {len(to_sum)} msgs"
            self.summaries.append(Message("system", txt))
            self.msgs = remaining
            self.total_summarized += self.TURNS
            return True
        except Exception as e:
            logger.warning("Summarize failed: %s", e)
            return False

class OpenRouterProvider:
    URL = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self, api_key: str, model: str = "anthropic/claude-3.5-sonnet",
                 budget: Optional[TokenBudget] = None, timeout: float = 120.0, ctx_mgmt: bool = True):
        self.api_key, self.model, self.budget = api_key, model, budget or TokenBudget()
        self.timeout, self.ctx_mgmt, self.counter = timeout, ctx_mgmt, TokenCounter()
        self.ctx = ContextWindow() if ctx_mgmt else None
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout, connect=10.0),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                     "HTTP-Referer": "https://linguclaw.local", "X-Title": "LinguClaw"}
        )

    async def manage_ctx(self) -> bool:
        if not self.ctx: return False
        th = self.budget.threshold_tokens
        if self.ctx.needs_summarize(th):
            logger.info("Summarizing context (>%d tokens)", th)
            return await self.ctx.summarize(self)
        return False

    def ctx_msgs(self, base: List[Message]) -> List[Message]:
        if not self.ctx: return base
        sys_msgs = [m for m in base if m.role == "system"]
        other = [m for m in base if m.role != "system"]
        return sys_msgs + self.ctx.all_msgs() + other

    def add_ctx(self, m: Message):
        if self.ctx: self.ctx.add(m)

    async def complete(self, msgs: List[Message], temp: float = 0.7, max_tok: Optional[int] = None) -> LLMResponse:
        prompt = self.counter.count_msgs(msgs)
        if max_tok is None: max_tok = self.budget.max_tokens(prompt)
        if max_tok < 256: return LLMResponse("", error="Budget exhausted")
        payload = {"model": self.model, "messages": [{"role": m.role, "content": m.content} for m in msgs],
                   "temperature": temp, "max_tokens": max_tok}
        try:
            r = await self.client.post(self.URL, json=payload)
            r.raise_for_status()
            d = r.json()
            if "error" in d: return LLMResponse("", error=f"API: {d['error']}")
            c = d.get("choices", [{}])[0]
            u = d.get("usage", {})
            content = c.get("message", {}).get("content", "")
            self.budget.consume(u.get("total_tokens", prompt + self.counter.count(content)))
            return LLMResponse(content, u, d.get("model", self.model), c.get("finish_reason"))
        except httpx.HTTPStatusError as e: return LLMResponse("", error=f"HTTP {e.response.status_code}")
        except httpx.TimeoutException: return LLMResponse("", error=f"Timeout {self.timeout}s")
        except Exception as e: return LLMResponse("", error=f"Fail: {e}")

    async def stream(self, msgs: List[Message], temp: float = 0.7, max_tok: Optional[int] = None) -> AsyncGenerator[str, None]:
        prompt = self.counter.count_msgs(msgs)
        if max_tok is None: max_tok = self.budget.max_tokens(prompt)
        payload = {"model": self.model, "messages": [{"role": m.role, "content": m.content} for m in msgs],
                   "temperature": temp, "max_tokens": max_tok, "stream": True}
        full = ""
        try:
            async with self.client.stream("POST", self.URL, json=payload) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if line.startswith("data: "):
                        raw = line[6:]
                        if raw == "[DONE]": break
                        try:
                            chunk = json.loads(raw)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            txt = delta.get("content", "")
                            if txt: full += txt; yield txt
                        except json.JSONDecodeError: continue
            self.budget.consume(prompt + self.counter.count(full))
        except Exception as e: yield f"\n[Stream error: {e}]"

    async def close(self): await self.client.aclose()

    def budget_status(self) -> Dict[str, Any]:
        return {"max": self.budget.max_total, "used": self.budget.used, "remaining": self.budget.remaining}
