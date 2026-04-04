"""Typer-based CLI entry point for LinguClaw."""
import asyncio
import os
import sys
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import typer
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

from .platform_info import detect_platform
from .provider import OpenRouterProvider, TokenBudget
from .tools import ShellTool, FileSystemTool
from .safety import SafetyMiddleware
from .memory import RAGMemory
from .orchestrator import Orchestrator
from .ui import LinguClawDashboard
from .logger import setup_logger

app = typer.Typer(
    name="linguclaw",
    help="LinguClaw — Codebase-Aware Multi-Agent System with Docker Sandboxing",
    add_completion=True,
)
console = Console()


def version_callback(value: bool):
    if value:
        console.print("[bold cyan]LinguClaw[/bold cyan] v0.3.0 — Multi-Agent Edition")
        raise typer.Exit()


@app.callback()
def main(
    version: Optional[bool] = typer.Option(
        None, "--version", "-v", callback=version_callback, is_eager=True,
        help="Show version and exit"
    )
):
    """LinguClaw — AI-powered codebase assistant with multi-agent orchestration."""
    pass


@app.command(name="dev")
def dev_command(
    path: Path = typer.Option(
        ".", "--path", "-p",
        help="Project root path to work in",
        exists=True, file_okay=False, dir_okay=True, resolve_path=True
    ),
    task: Optional[str] = typer.Argument(
        None,
        help="Task description (or interactive if not provided)"
    ),
    model: str = typer.Option(
        "anthropic/claude-3.5-sonnet", "--model", "-m",
        help="OpenRouter model to use"
    ),
    max_budget: int = typer.Option(
        128000, "--max-budget", "-b",
        help="Maximum token budget"
    ),
    max_steps: int = typer.Option(
        15, "--max-steps", "-s",
        help="Maximum execution steps"
    ),
    no_docker: bool = typer.Option(
        False, "--no-docker",
        help="Disable Docker sandbox, use strict safety fallback"
    ),
    force_fallback: bool = typer.Option(
        False, "--force-fallback",
        help="Force strict safety mode even if Docker available"
    ),
    no_tui: bool = typer.Option(
        False, "--no-tui",
        help="Disable TUI dashboard, use plain text output"
    ),
    log_dir: Path = typer.Option(
        "logs", "--log-dir", "-l",
        help="Directory for log files"
    ),
):
    """Start LinguClaw in development mode with full TUI dashboard."""
    
    # Banner
    banner = Panel(
        Text.from_markup(
            "[bold cyan]🦀 LinguClaw[/bold cyan] "
            "[dim]— Multi-Agent Codebase Assistant[/dim]\n"
            "[dim]Docker Sandbox • RAG Memory • Collaborative Validation[/dim]"
        ),
        border_style="cyan"
    )
    console.print(banner)
    
    # API key check
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        console.print("[bold red]Error:[/bold red] OPENROUTER_API_KEY environment variable not set")
        console.print("[dim]Set it with: export OPENROUTER_API_KEY=your_key[/dim]")
        raise typer.Exit(1)
    
    # Platform detection
    plat = detect_platform()
    console.print(f"🖥️  [dim]{plat.summary()}[/dim]")
    
    # Interactive task input if not provided
    if not task:
        task = console.input("[bold]Task: [/bold]").strip()
        if not task:
            console.print("[yellow]No task provided. Exiting.[/yellow]")
            raise typer.Exit(0)
    
    # Setup logging
    logger = setup_logger(log_dir=str(log_dir))
    logger.info(f"Starting LinguClaw dev mode in {path}")
    
    # Initialize components
    try:
        # Provider
        provider = OpenRouterProvider(
            api_key=api_key,
            model=model,
            budget=TokenBudget(max_total=max_budget),
            ctx_mgmt=True
        )
        
        # Shell (Docker or fallback)
        use_docker = not no_docker and not force_fallback
        shell = ShellTool(
            project_root=str(path),
            use_docker=use_docker,
            safety=SafetyMiddleware(),
            fallback_confirmed=force_fallback
        )
        
        # Filesystem
        fs = FileSystemTool(str(path))
        
        # Memory (RAG)
        memory = RAGMemory(str(path))
        if memory.available:
            stats = memory.get_stats()
            if stats.get("count", 0) == 0:
                console.print("🧠 [dim]Indexing codebase...[/dim]")
                indexed = memory.index_project()
                console.print(f"   [green]Indexed {indexed} chunks[/green]")
            else:
                console.print(f"🧠 [green]Memory ready ({stats.get('count', 0)} chunks)[/green]")
        else:
            console.print("🧠 [dim]Memory unavailable (install lancedb, sentence-transformers)[/dim]")
        
        # Sandbox status
        if shell.is_sandboxed:
            console.print("🔒 [green]Docker sandbox active[/green] (512MB RAM, 0.5 CPU)")
        else:
            console.print("⚠️  [yellow]Strict safety mode[/yellow] (Docker unavailable or disabled)")
        
        console.print()
        
        # Initialize orchestrator
        orchestrator = Orchestrator(
            provider=provider,
            shell=shell,
            fs=fs,
            memory=memory,
            max_iterations=max_steps
        )
        
        # Run with or without TUI
        if no_tui:
            # Plain text mode
            result = asyncio.run(orchestrator.run(task))
            console.print(f"\n[bold]Result:[/bold] {result}")
        else:
            # TUI Dashboard mode
            dashboard = LinguClawDashboard(str(path), orchestrator.state)
            
            # Run dashboard and orchestrator concurrently
            async def run_with_ui():
                dashboard_task = asyncio.create_task(dashboard.start())
                
                try:
                    result = await orchestrator.run(task)
                    console.print(f"\n[bold green]Complete:[/bold green] {result}")
                except Exception as e:
                    console.print(f"\n[bold red]Error:[/bold red] {e}")
                finally:
                    dashboard.stop()
                    dashboard_task.cancel()
                    try:
                        await dashboard_task
                    except asyncio.CancelledError:
                        pass
            
            asyncio.run(run_with_ui())
        
        # Cleanup
        shell.stop()
        
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted by user[/yellow]")
        raise typer.Exit(0)
    except Exception as e:
        console.print(f"\n[bold red]Fatal error:[/bold red] {e}")
        logger.exception("Fatal error")
        raise typer.Exit(1)


@app.command(name="index")
def index_command(
    path: Path = typer.Option(
        ".", "--path", "-p",
        help="Project path to index",
        exists=True, file_okay=False, dir_okay=True, resolve_path=True
    ),
    force: bool = typer.Option(
        False, "--force", "-f",
        help="Force re-index even if already indexed"
    ),
):
    """Index the codebase for RAG memory without running the agent."""
    console.print("🧠 [bold]Indexing codebase...[/bold]")
    
    memory = RAGMemory(str(path))
    if not memory.available:
        console.print("[red]Error: RAG memory unavailable[/red]")
        console.print("[dim]Install dependencies: pip install lancedb sentence-transformers pyarrow[/dim]")
        raise typer.Exit(1)
    
    stats_before = memory.get_stats()
    console.print(f"   Before: {stats_before.get('count', 0)} chunks")
    
    indexed = memory.index_project(force=force)
    
    stats_after = memory.get_stats()
    console.print(f"[green]✓ Indexed {indexed} new chunks[/green]")
    console.print(f"   Total: {stats_after.get('count', 0)} chunks in memory")


@app.command(name="status")
def status_command(
    path: Path = typer.Option(
        ".", "--path", "-p",
        help="Project path to check",
        exists=True, file_okay=False, dir_okay=True, resolve_path=True
    ),
):
    """Check LinguClaw status: Docker, Memory, Configuration."""
    console.print("[bold cyan]LinguClaw Status[/bold cyan]\n")
    
    # Platform
    plat = detect_platform()
    console.print(f"🖥️  Platform: {plat.summary()}")
    
    # Docker
    try:
        import docker
        client = docker.from_env()
        client.ping()
        console.print("🔒 Docker: [green]Available[/green]")
    except Exception:
        console.print("🔒 Docker: [red]Unavailable[/red]")
    
    # Memory
    memory = RAGMemory(str(path))
    if memory.available:
        stats = memory.get_stats()
        console.print(f"🧠 Memory: [green]Ready[/green] ({stats.get('count', 0)} chunks)")
    else:
        console.print("🧠 Memory: [red]Unavailable[/red]")
    
    # API Key
    if os.getenv("OPENROUTER_API_KEY"):
        key = os.getenv("OPENROUTER_API_KEY", "")
        masked = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
        console.print(f"🔑 API Key: [green]{masked}[/green]")
    else:
        console.print("🔑 API Key: [red]Not set[/red]")
    
    # Memory location
    memory_dir = path / ".linguclaw" / "memory"
    console.print(f"💾 Storage: {memory_dir}")


@app.command(name="web")
def web_command(
    path: Path = typer.Option(
        ".", "--path", "-p",
        help="Project root to serve",
        exists=True, file_okay=False, dir_okay=True, resolve_path=True
    ),
    host: str = typer.Option(
        "127.0.0.1", "--host", "-h",
        help="Host to bind to"
    ),
    port: int = typer.Option(
        8080, "--port",
        help="Port to listen on"
    ),
):
    """Start LinguClaw Web UI server."""
    console.print("[bold cyan]🌐 Starting LinguClaw Web UI...[/bold cyan]\n")
    
    # Check API key
    if not os.getenv("OPENROUTER_API_KEY"):
        console.print("[red]Error: OPENROUTER_API_KEY not set[/red]")
        raise typer.Exit(1)
    
    try:
        from .web import run_web_ui
        console.print(f"Server will start at: [bold blue]http://{host}:{port}[/bold blue]\n")
        console.print("Press Ctrl+C to stop\n")
        
        run_web_ui(project_root=str(path), host=host, port=port)
        
    except ImportError as e:
        console.print(f"[red]Error: Missing web dependencies[/red]")
        console.print("[dim]Install with: pip install fastapi uvicorn pydantic[/dim]")
        raise typer.Exit(1)
    except KeyboardInterrupt:
        console.print("\n[yellow]Server stopped[/yellow]")
        raise typer.Exit(0)


def cli_entry():
    """Entry point for console scripts."""
    app()
