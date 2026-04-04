"""Dynamic risk-scoring engine for cross-platform safety."""
import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional

from .logger import console

logger = logging.getLogger("linguclaw.safety")

@dataclass(frozen=True)
class RiskPattern:
    regex: str
    score: int
    desc: str
    compiled: re.Pattern = field(init=False, repr=False, compare=False)
    def __post_init__(self):
        object.__setattr__(self, 'compiled', re.compile(self.regex, re.IGNORECASE))

PATTERNS = [
    # Destructive (90-100)
    RiskPattern(r'rm\s+-[rf]+.*/', 100, 'Recursive delete'),
    RiskPattern(r'rm\s+-[rf]+\s*[~$/]', 100, 'Home/Root delete'),
    RiskPattern(r'\bmkfs\b', 100, 'Filesystem format'),
    RiskPattern(r'\bfdisk\b|\bparted\b', 95, 'Partition editor'),
    RiskPattern(r'\bdd\s+if=', 90, 'Raw disk write'),
    RiskPattern(r'>\s*/dev/[sh]da', 100, 'Overwrite disk'),
    RiskPattern(r':\(\)\s*\{\s*:\|:&\s*\};', 100, 'Fork bomb'),
    # macOS destructive
    RiskPattern(r'\bdiskutil\s+(eraseDisk|eraseVolume|secureErase)\b', 100, 'Disk erase'),
    RiskPattern(r'\bcsrutil\s+disable\b', 90, 'Disable SIP'),
    # Windows destructive
    RiskPattern(r'\bdel\s+/[sfq]|\brmdir?\s+/s', 95, 'Recursive delete'),
    RiskPattern(r'\bformat\s+[a-zA-Z]:', 100, 'Format drive'),
    RiskPattern(r'\bdiskpart\b|\bbcdedit\b', 95, 'Disk/boot editor'),
    RiskPattern(r'Remove-Item\s+.*-Recurse\s+-Force', 95, 'PS recursive delete'),
    # Privilege (35-45)
    RiskPattern(r'\bsudo\s+rm\b', 95, 'Sudo remove'),
    RiskPattern(r'\bsudo\b|\bsu\s+-|\bRunAs\b', 40, 'Privilege elevation'),
    RiskPattern(r'\bSet-ExecutionPolicy\b', 50, 'Change exec policy'),
    # System changes (30-45)
    RiskPattern(r'\bchmod\s+-R\s+777\s+/', 85, 'World-writable root'),
    RiskPattern(r'\bchmod\s+777\b|\bchown\s+-R\b', 45, 'Permission changes'),
    RiskPattern(r'\bsystemctl\s+(start|stop|restart|enable|disable)\b', 35, 'Service mgmt'),
    RiskPattern(r'\bnet\s+(user|localgroup)\b', 45, 'User/group mgmt'),
    RiskPattern(r'\breg\s+delete\b.*\/f', 85, 'Force reg delete'),
    # Network/pipe (60-70)
    RiskPattern(r'\b(wget|curl)\b.*\|.*\bsh\b', 70, 'Download & execute'),
    # Package install (25-35)
    RiskPattern(r'\b(pip|apt|pacman|yay|brew|winget|choco)\s+(install|remove)', 35, 'Package operation'),
]

@dataclass
class SafetyResult:
    is_safe: bool
    risk_level: str
    score: int
    reason: str = ""
    requires_confirmation: bool = False
    matched: List[str] = field(default_factory=list)

class SafetyMiddleware:
    def analyze(self, command: str) -> SafetyResult:
        if not command or not command.strip():
            return SafetyResult(True, "safe", 0, "Empty")
        max_score, matched = 0, []
        for p in PATTERNS:
            if p.compiled.search(command):
                matched.append(f"{p.desc} ({p.score})")
                max_score = max(max_score, p.score)
        level = "high" if max_score >= 80 else ("medium" if max_score >= 30 else "safe")
        return SafetyResult(
            level == "safe", level, max_score,
            f"Score {max_score}: {', '.join(matched)}" if matched else "No risk",
            max_score >= 30, matched[:3]
        )

    def confirm(self, command: str, result: SafetyResult) -> bool:
        console.print(f"\n[warning]⚠️  {result.risk_level.upper()} RISK (score={result.score})[/warning]")
        console.print(f"[command]{command}[/command]")
        for m in result.matched:
            console.print(f"   [error]• {m}[/error]")
        while True:
            try:
                r = input("Execute? [y/N]: ").strip().lower()
                if r in ("y", "yes"): return True
                if r in ("n", "no", ""): return False
            except EOFError:
                return False
