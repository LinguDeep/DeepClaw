"""Configuration with .env support."""
import os
from dataclasses import dataclass
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

@dataclass(frozen=True)
class Config:
    api_key: Optional[str] = None
    model: str = "anthropic/claude-3.5-sonnet"
    max_budget: int = 128000
    project_root: str = "."
    confirm_high_risk: bool = True
    timeout: float = 60.0
    max_steps: int = 15
    log_dir: str = "logs"

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            api_key=os.getenv("OPENROUTER_API_KEY"),
            model=os.getenv("LINGUCLAW_MODEL", "anthropic/claude-3.5-sonnet"),
            max_budget=int(os.getenv("LINGUCLAW_MAX_BUDGET", "128000")),
            project_root=os.getenv("LINGUCLAW_PROJECT", "."),
            confirm_high_risk=os.getenv("LINGUCLAW_SKIP_CONFIRM", "").lower() != "true",
            timeout=float(os.getenv("LINGUCLAW_TIMEOUT", "60.0")),
            max_steps=int(os.getenv("LINGUCLAW_MAX_STEPS", "15")),
            log_dir=os.getenv("LINGUCLAW_LOG_DIR", "logs"),
        )
