"""Optimized ReAct agent with non-blocking execution."""
import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from enum import Enum

from .provider import OpenRouterProvider, Message
from .tools import ShellTool, FileSystemTool, CommandResult, SearchMemoryTool
from .safety import SafetyMiddleware
from .platform_info import PlatformInfo
from .memory import RAGMemory
from .logger import log_thought, log_command, log_observation, log_error, log_warning, log_header, log_final

logger = logging.getLogger("linguclaw.agent")

class ActionType(Enum):
    BASH = "bash"; READ = "read"; WRITE = "write"; LIST = "list"; SEARCH = "search"; FINAL = "final"; NONE = "none"

@dataclass
class ParsedAction:
    type: ActionType; input: str; raw: str; is_valid: bool = True; error: str = ""

@dataclass
class Observation:
    step: int; tool: str; status: str; stdout: str = ""; stderr: str = ""; content: str = ""; error_msg: str = ""
    def to_text(self) -> str:
        lines = [f"OBSERVATION (step {self.step}, {self.tool}):", f"Status: {self.status}"]
        if self.status == "success" and self.content: lines.append(f"Content:\n{self.content[:2000]}")
        if self.stdout: lines.append(f"Stdout:\n{self.stdout[:1500]}")
        if self.status == "error":
            if self.error_msg: lines.append(f"Error: {self.error_msg}")
            if self.stderr: lines.append(f"Stderr:\n{self.stderr[:1500]}")
        return "\n".join(lines)

@dataclass
class ThoughtStep:
    step: int; content: str; reasoning: str; plan: str = ""

@dataclass
class ReActState:
    thoughts: List[ThoughtStep] = field(default_factory=list)
    actions: List[ParsedAction] = field(default_factory=list)
    observations: List[Observation] = field(default_factory=list)
    step: int = 0; finished: bool = False; answer: str = ""

class Parser:
    PAT = {
        ActionType.BASH: re.compile(r'(?:RUN|BASH|ACTION:\s*(?:bash|run)):\s*(.+?)(?=\n(?:THOUGHT|OBS|ACTION|RUN|FINAL|$))', re.I|re.S),
        ActionType.READ: re.compile(r'(?:READ|ACTION:\s*read):\s*([^\n]+)', re.I),
        ActionType.WRITE: re.compile(r'(?:WRITE|ACTION:\s*write):\s*([^\n]+?)\s*\n```[^\n]*\n(.*?)\n```', re.I|re.S),
        ActionType.LIST: re.compile(r'(?:LIST|LS|ACTION:\s*list):\s*([^\n]*)', re.I),
        ActionType.SEARCH: re.compile(r'(?:SEARCH|SEARCH_CODEBASE|ACTION:\s*search):\s*([^\n]+)', re.I),
        ActionType.FINAL: re.compile(r'(?:FINAL|ANSWER):\s*(.*?)(?=\n(?:THOUGHT|OBS|ACTION|RUN)|$)', re.I|re.S),
    }
    GEN = re.compile(r'ACTION:\s*(\w+):\s*(.+?)(?=\n(?:THOUGHT|OBS|ACTION|RUN|FINAL)|$)', re.I|re.S)
    MAP = {"bash": ActionType.BASH, "run": ActionType.BASH, "shell": ActionType.BASH,
           "read": ActionType.READ, "cat": ActionType.READ, "write": ActionType.WRITE,
           "list": ActionType.LIST, "ls": ActionType.LIST, "search": ActionType.SEARCH, "search_codebase": ActionType.SEARCH}

    @classmethod
    def parse(cls, text: str) -> ParsedAction:
        t = text.strip()
        m = cls.PAT[ActionType.FINAL].search(t)
        if m: return ParsedAction(ActionType.FINAL, m.group(1).strip(), m.group(0))
        for at in (ActionType.BASH, ActionType.READ, ActionType.WRITE, ActionType.LIST, ActionType.SEARCH):
            m = cls.PAT[at].search(t)
            if m:
                v = m.group(1).strip()
                if at == ActionType.WRITE and len(m.groups()) >= 2: v = f"{v}\n{m.group(2)}"
                return ParsedAction(at, v, m.group(0))
        g = cls.GEN.search(t)
        if g:
            tool = g.group(1).strip().lower()
            at = cls.MAP.get(tool)
            if at: return ParsedAction(at, g.group(2).strip(), g.group(0))
        return ParsedAction(ActionType.NONE, "", t[:200], False, "Unparseable")

    @classmethod
    def extract(cls, text: str) -> Dict[str, str]:
        r = {"reasoning": "", "plan": ""}
        m = re.search(r'(?:THOUGHT|REASONING):\s*(.+?)(?=\n(?:PLAN|ACTION|RUN|OBS|FINAL)|$)', text, re.I|re.S)
        if m: r["reasoning"] = m.group(1).strip()
        m2 = re.search(r'(?:PLAN|NEXT):\s*(.+?)(?=\n(?:THOUGHT|ACTION|RUN|OBS|FINAL)|$)', text, re.I|re.S)
        if m2: r["plan"] = m2.group(1).strip()
        return r

class ReActAgent:
    def __init__(self, prov: OpenRouterProvider, shell: ShellTool, fs: FileSystemTool,
                 max_steps: int = 15, safety: Optional[SafetyMiddleware] = None,
                 platform: Optional[PlatformInfo] = None, log: Optional[logging.Logger] = None,
                 memory: Optional[RAGMemory] = None, auto_context: bool = True):
        self.prov, self.shell, self.fs, self.max_steps = prov, shell, fs, max_steps
        self.safety, self.platform, self.state, self.log = safety or SafetyMiddleware(), platform, ReActState(), log or logger
        self.parser = Parser()
        self.memory = memory
        self.auto_context = auto_context and (memory is not None and memory.available)
        self.sys_prompt = self._build_prompt(platform, shell.is_sandboxed if hasattr(shell, 'is_sandboxed') else False, self.auto_context)
        if self.prov.ctx: self.prov.ctx.buffer.set("Awaiting task")
        # Initialize memory search tool
        self.search_tool = SearchMemoryTool(memory) if memory else None

    def _build_prompt(self, p: Optional[PlatformInfo], sandboxed: bool = False, has_memory: bool = False) -> str:
        plat = p.summary() if p else "OS=unknown"
        guides = {
            "arch": "pacman/yay, ip addr, systemctl",
            "ubuntu": "apt, ip addr, systemctl",
            "debian": "apt, ip addr, systemctl",
            "fedora": "dnf, ip addr, systemctl",
            "macos": "brew, ifconfig, launchctl",
            "windows": "winget, ipconfig, Get-Service",
        }
        g = guides.get(p.distro if p else "", "Detect package manager")
        
        # Sandbox indicator
        sandbox_notice = "\n🔒 SANDBOXED: Running in Docker container (512MB RAM, 0.5 CPU limit)\n"
        fallback_notice = "\n⚠️  UNSANDBOXED: Docker unavailable - STRICT SAFETY MODE ACTIVE\n"
        mode_notice = sandbox_notice if sandboxed else fallback_notice
        
        # Memory indicator
        memory_notice = "\n🧠 CODEBASE-AWARE: RAG memory active - relevant code auto-injected\n" if has_memory else ""
        
        return (f"You are LinguClaw. Environment: {plat}\n"
                f"Platform: {g}{mode_notice}{memory_notice}\n"
                f"Tools: RUN, READ, WRITE, LIST, SEARCH_CODEBASE\n\n"
                f"Format:\nTHOUGHT: [analysis with code context]\nRUN: [command]\n\n"
                f"SEARCH_CODEBASE: [query] - Search memory for relevant code\n\n"
                f"Error: analyze stderr, propose fix\nFinal: FINAL: [answer]")

    def _build_msgs(self, task: str, include_memory: bool = False) -> List[Message]:
        # Auto-context: search memory for relevant code before building messages
        memory_context = ""
        if include_memory and self.memory and self.auto_context:
            memory_context = self.memory.auto_context(task)
            if memory_context and memory_context != "[No relevant code found in memory]":
                logger.info("Injected %d chars of code context from memory", len(memory_context))
        
        # Build system message with optional memory context
        system_content = self.sys_prompt
        if memory_context and not memory_context.startswith("["):
            system_content += f"\n\n[RELEVANT CODE CONTEXT FOR THIS TASK]\n{memory_context}\n[END CONTEXT]"
        
        msgs = [Message("system", system_content), Message("user", f"Task: {task}")]
        for i, th in enumerate(self.state.thoughts):
            t = f"THOUGHT: {th.reasoning}"
            if th.plan: t += f"\nPLAN: {th.plan}"
            msgs.append(Message("assistant", t))
            if i < len(self.state.observations):
                msgs.append(Message("user", self.state.observations[i].to_text()))
        return msgs

    async def _exec_cmd(self, cmd: str, timeout: float = 60.0) -> CommandResult:
        task = asyncio.create_task(self.shell.run(cmd, timeout=timeout))
        elapsed = 0.0
        while not task.done():
            await asyncio.sleep(min(2.0, timeout - elapsed))
            elapsed += 2.0
        return task.result()

    async def _exec(self, action: ParsedAction) -> Observation:
        self.state.step += 1
        s = self.state.step
        if action.type == ActionType.BASH:
            res = await self._exec_cmd(action.input)
            is_sandboxed = getattr(self.shell, 'is_sandboxed', False)
            status = "success" if res.returncode == 0 else "error"
            
            # Add sandbox indicator to observation
            sandbox_tag = " [SANDBOXED]" if is_sandboxed else " [UNSANDBOXED-STRICT]"
            if self.prov.ctx:
                (self.prov.ctx.buffer.add_a if res.returncode == 0 else self.prov.ctx.buffer.add_f)(action.input[:80])
            return Observation(s, f"bash{sandbox_tag}", status,
                              res.stdout, res.stderr, "", f"Exit: {res.returncode}" if res.returncode else "")
        elif action.type == ActionType.READ:
            r = self.fs.read(action.input, limit=4000)
            return Observation(s, "read", "success" if r.success else "error", content=r.content or "", error_msg=r.error or "")
        elif action.type == ActionType.WRITE:
            parts = action.input.split("\n", 1)
            if len(parts) >= 2:
                r = self.fs.write(parts[0].strip(), parts[1])
                return Observation(s, "write", "success" if r.success else "error",
                                  content=f"Wrote {len(parts[1])} chars" if r.success else "", error_msg=r.error or "")
            return Observation(s, "write", "error", error_msg="Invalid format")
        elif action.type == ActionType.LIST:
            r = self.fs.list_dir(action.input.strip() or ".")
            return Observation(s, "list", "success" if r.success else "error", content=r.content or "", error_msg=r.error or "")
        elif action.type == ActionType.SEARCH:
            if self.search_tool:
                result = self.search_tool.search_codebase(action.input, k=5)
                return Observation(s, "search_codebase", "success", content=result)
            return Observation(s, "search_codebase", "error", error_msg="Memory not available")
        elif action.type == ActionType.FINAL:
            self.state.finished = True; self.state.answer = action.input
            return Observation(s, "final", "success", content="Done")
        return Observation(s, "none", "error", error_msg=f"Unknown: {action.raw[:100]}")

    async def step(self, task: str) -> bool:
        # Auto-context on first step or when task changes significantly
        is_first_step = self.state.step == 0
        msgs = self._build_msgs(task, include_memory=is_first_step)
        resp = await self.prov.complete(msgs, 0.3)
        if resp.error:
            log_error(f"LLM: {resp.error}", self.log)
            self.state.observations.append(Observation(self.state.step + 1, "llm", "error", error_msg=resp.error))
            return self.state.step < self.max_steps
        parsed = self.parser.parse(resp.content)
        ext = self.parser.extract(resp.content)
        th = ThoughtStep(self.state.step + 1, resp.content[:500], ext["reasoning"], ext["plan"])
        self.state.thoughts.append(th); self.state.actions.append(parsed)
        if th.reasoning: log_thought(th.step, th.reasoning[:100], self.log)
        if parsed.type == ActionType.FINAL:
            log_thought(th.step, "FINAL", self.log); await self._exec(parsed); return False
        if parsed.is_valid: log_command(th.step, f"{parsed.type.value}: {parsed.input[:80]}", self.log)
        else: log_warning(f"Parse: {parsed.error}", self.log)
        obs = await self._exec(parsed); self.state.observations.append(obs)
        detail = obs.error_msg or obs.content or ""
        log_observation(obs.step, obs.tool, obs.status, detail[:80], self.log)
        if self.state.step >= self.max_steps: log_warning(f"Max {self.max_steps} steps", self.log); return False
        return True

    async def run(self, task: str) -> str:
        if self.prov.ctx: self.prov.ctx.buffer.set(task[:120])
        plat = f" | {self.platform.distro}/{self.platform.shell}" if self.platform else ""
        log_header(f"LinguClaw{plat}", f"Task: {task}", self.log)
        try:
            while await self.step(task): pass
        except asyncio.CancelledError: log_warning("Cancelled", self.log); raise
        except Exception as e: log_error(f"Error: {e}", self.log); return f"Error: {e}"
        if self.state.answer: return self.state.answer
        if self.state.step >= self.max_steps: return f"Max steps ({self.max_steps}) reached"
        if self.state.thoughts: return f"No FINAL. Last: {self.state.thoughts[-1].reasoning[:200]}..."
        return "No result"

    def summary(self) -> Dict[str, Any]:
        return {"steps": self.state.step, "max": self.max_steps, "finished": self.state.finished,
                "thoughts": len(self.state.thoughts), "obs": len(self.state.observations)}
