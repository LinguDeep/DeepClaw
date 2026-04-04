"""CLI entry point."""
import argparse
import asyncio
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from .platform_info import detect_platform
from .provider import OpenRouterProvider, TokenBudget
from .tools import ShellTool, FileSystemTool
from .safety import SafetyMiddleware
from .agent import ReActAgent
from .memory import RAGMemory
from .logger import setup_logger, console, log_header, log_final, log_stats, log_error

async def main():
    p = argparse.ArgumentParser(description="LinguClaw — Docker-sandboxed ReAct Agent")
    p.add_argument("prompt", nargs="?", help="Task")
    p.add_argument("--model", default="anthropic/claude-3.5-sonnet")
    p.add_argument("--max-budget", type=int, default=128000)
    p.add_argument("--project", default=".")
    p.add_argument("--max-steps", type=int, default=15)
    p.add_argument("--no-ctx", action="store_true")
    p.add_argument("--log-dir", default="logs")
    p.add_argument("--no-docker", action="store_true", help="Disable Docker sandbox, use strict safety fallback")
    p.add_argument("--force-fallback", action="store_true", help="Force strict safety mode even if Docker available")
    args = p.parse_args()

    log = setup_logger(log_dir=args.log_dir)
    plat = detect_platform()
    console.print(f"🖥️  {plat.summary()}")
    log.info("Platform: %s", plat.summary())

    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        log_error("OPENROUTER_API_KEY not set", log)
        sys.exit(1)

    prov = OpenRouterProvider(key, args.model, TokenBudget(args.max_budget), ctx_mgmt=not args.no_ctx)
    
    # Initialize ShellTool with Docker sandbox (or fallback)
    use_docker = not args.no_docker and not args.force_fallback
    shell = ShellTool(
        project_root=args.project,
        use_docker=use_docker,
        safety=SafetyMiddleware(),
        fallback_confirmed=args.force_fallback
    )
    fs = FileSystemTool(args.project)
    
    # Initialize RAG Memory system
    memory = RAGMemory(args.project)
    if memory.available:
        # Auto-index on startup if not already indexed
        stats = memory.get_stats()
        if not stats.get("indexed", False) and stats.get("count", 0) == 0:
            console.print("🧠 Indexing codebase for RAG memory...")
            indexed = memory.index_project()
            console.print(f"   Indexed {indexed} code chunks")
        else:
            console.print(f"🧠 RAG memory ready ({stats.get('count', 0)} chunks)")
    else:
        console.print("⚠️  RAG memory unavailable (install lancedb, sentence-transformers)")
    
    # Show sandbox status
    if shell.is_sandboxed:
        console.print("🔒 Docker sandbox active (512MB RAM, 0.5 CPU)")
        log.info("Docker sandbox enabled")
    else:
        console.print("⚠️  STRICT SAFETY MODE (Docker unavailable or disabled)")
        log.warning("Using strict safety fallback mode")

    task = args.prompt or console.input("Task: ").strip()
    if not task:
        log_error("No task", log)
        sys.exit(1)

    agent = ReActAgent(prov, shell, fs, args.max_steps, SafetyMiddleware(), plat, log, memory=memory, auto_context=True)
    try:
        result = await agent.run(task)
        log_final(result, log)
        st = {"Platform": f"{plat.distro}/{plat.shell}", "Steps": f"{agent.state.step}/{args.max_steps}",
              "Tokens": f"{prov.budget.used}/{prov.budget.max_total}",
              "Sandbox": "Docker" if shell.is_sandboxed else "Strict-Fallback",
              "Memory": f"{memory.get_stats().get('count', 0)} chunks" if memory.available else "N/A"}
        if prov.ctx: st["Summarized"] = f"{prov.ctx.total_summarized} turns"
        log_stats(st, log)
    except KeyboardInterrupt:
        console.print("\n[warning]Interrupted[/warning]")
    finally:
        await prov.close()
        shell.stop()  # Cleanup Docker container

def cli():
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
