"""Structured logging with optional Rich colorization."""
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    from rich.console import Console
    from rich.theme import Theme
    _RICH = True
except ImportError:
    _RICH = False

if _RICH:
    THEME = Theme({
        "thought": "cyan", "command": "bold white", "observation": "green",
        "error": "bold red", "warning": "yellow", "info": "dim white",
        "step": "bold magenta", "header": "bold blue", "success": "bold green",
        "blocked": "bold yellow",
    })
    console = Console(theme=THEME)
else:
    class _Console:
        def print(self, t: str, **kw): print(t)
        def input(self, p: str) -> str: return input(p)
        def rule(self, t: str = ""): print("=" * 60)
    console = _Console()

def setup_logger(name: str = "linguclaw", log_dir: str = "logs", level: int = logging.DEBUG) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers: return logger
    logger.setLevel(level)
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    fh = logging.FileHandler(Path(log_dir) / f"session_{ts}.log", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(name)s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    logger.addHandler(fh)
    ch = logging.StreamHandler()
    ch.setLevel(logging.WARNING)
    logger.addHandler(ch)
    return logger

if _RICH:
    def log_thought(s: int, t: str, l: Optional[logging.Logger] = None):
        console.print(f"\n[step]\\[Step {s}][/step] [thought]💭 {t}[/thought]")
        if l: l.info("Step %d THOUGHT: %s", s, t)
    def log_command(s: int, c: str, l: Optional[logging.Logger] = None):
        console.print(f"[step]\\[Step {s}][/step] [command]⚡ RUN: {c}[/command]")
        if l: l.info("Step %d RUN: %s", s, c)
    def log_observation(s: int, t: str, st: str, d: str = "", l: Optional[logging.Logger] = None):
        tag = {"success": "[success]✓", "error": "[error]✗", "blocked": "[blocked]🚫"}.get(st, "?")
        console.print(f"         {tag} {t}[/success]  {d[:120]}")
        if l: l.info("Step %d OBS (%s) [%s]: %s", s, t, st, d[:200])
    def log_error(m: str, l: Optional[logging.Logger] = None):
        console.print(f"[error]❌ {m}[/error]"); 
        if l: l.error(m)
    def log_warning(m: str, l: Optional[logging.Logger] = None):
        console.print(f"[warning]⚠️  {m}[/warning]"); 
        if l: l.warning(m)
    def log_header(t: str, s: str = "", l: Optional[logging.Logger] = None):
        console.rule(f"[header]{t}[/header]"); 
        if l: l.info("=== %s === %s", t, s)
    def log_final(a: str, l: Optional[logging.Logger] = None):
        console.rule("[success]FINAL ANSWER[/success]"); console.print(a); console.rule(); 
        if l: l.info("FINAL: %s", a)
    def log_stats(st: dict, l: Optional[logging.Logger] = None):
        console.print("\n[header]📊 Stats[/header]"); 
        for k, v in st.items(): console.print(f"   [info]{k}:[/info]  {v}")
        if l: l.info("Stats: %s", st)
else:
    def log_thought(s: int, t: str, l: Optional[logging.Logger] = None):
        print(f"\n[Step {s}] 💭 {t}"); 
        if l: l.info("Step %d THOUGHT: %s", s, t)
    def log_command(s: int, c: str, l: Optional[logging.Logger] = None):
        print(f"[Step {s}] ⚡ RUN: {c}"); 
        if l: l.info("Step %d RUN: %s", s, c)
    def log_observation(s: int, t: str, st: str, d: str = "", l: Optional[logging.Logger] = None):
        icon = {"success": "✓", "error": "✗", "blocked": "🚫"}.get(st, "?")
        print(f"         {icon} {t}: {d[:120]}")
        if l: l.info("Step %d OBS (%s) [%s]: %s", s, t, st, d[:200])
    def log_error(m: str, l: Optional[logging.Logger] = None):
        print(f"❌ {m}"); 
        if l: l.error(m)
    def log_warning(m: str, l: Optional[logging.Logger] = None):
        print(f"⚠️  {m}"); 
        if l: l.warning(m)
    def log_header(t: str, s: str = "", l: Optional[logging.Logger] = None):
        print("=" * 60); print(f"🤖 {t}"); 
        if l: l.info("=== %s === %s", t, s)
    def log_final(a: str, l: Optional[logging.Logger] = None):
        print("\n=== FINAL ANSWER ==="); print(a); print("=" * 60); 
        if l: l.info("FINAL: %s", a)
    def log_stats(st: dict, l: Optional[logging.Logger] = None):
        print("\n=== Stats ==="); 
        for k, v in st.items(): print(f"   {k}: {v}")
        if l: l.info("Stats: %s", st)
