"""Professional TUI Dashboard with Rich.Live and 3-pane layout."""
import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.tree import Tree
from rich.table import Table
from rich.text import Text
from rich.syntax import Syntax
from rich.progress import Progress, BarColumn, TextColumn
from rich.box import ROUNDED

from .orchestrator import SharedState, StepStatus, AgentRole


@dataclass
class UIConfig:
    refresh_rate: float = 0.5
    show_file_tree: bool = True
    max_log_entries: int = 50


class LinguClawDashboard:
    """Professional 3-pane TUI dashboard."""
    
    def __init__(self, project_root: str, state: Optional[SharedState] = None):
        self.console = Console()
        self.project_root = project_root
        self.state = state
        self.config = UIConfig()
        self.live: Optional[Live] = None
        self.logs: list = []
        self.running = False
        
        # Layout structure
        self.layout = Layout()
        self.layout.split_column(
            Layout(name="header", size=3),
            Layout(name="main", ratio=1),
            Layout(name="footer", size=5)
        )
        self.layout["main"].split_row(
            Layout(name="sidebar", size=40),
            Layout(name="content", ratio=1)
        )
        self.layout["content"].split_column(
            Layout(name="thoughts", ratio=2),
            Layout(name="actions", ratio=1)
        )
    
    def _make_header(self) -> Panel:
        """Create header panel with title."""
        title = Text("🦀 LinguClaw — Codebase-Aware Multi-Agent System", style="bold cyan")
        subtitle = Text(f"Project: {self.project_root}", style="dim")
        
        grid = Table.grid(expand=True)
        grid.add_column(justify="left")
        grid.add_column(justify="right")
        grid.add_row(title, subtitle)
        
        return Panel(grid, box=ROUNDED, border_style="cyan")
    
    def _make_sidebar(self) -> Panel:
        """Create sidebar with file tree and status."""
        # File tree
        tree = Tree("📁 Project Root", guide_style="dim")
        
        if self.state and self.state.plan:
            # Add plan steps as tree nodes
            plan_branch = tree.add("📋 Current Plan")
            for step in self.state.plan:
                icon = {
                    StepStatus.PENDING: "⏳",
                    StepStatus.IN_PROGRESS: "🔄",
                    StepStatus.COMPLETED: "✅",
                    StepStatus.FAILED: "❌",
                    StepStatus.RETRYING: "🔁"
                }.get(step.status, "❓")
                
                style = {
                    StepStatus.COMPLETED: "green",
                    StepStatus.FAILED: "red",
                    StepStatus.IN_PROGRESS: "yellow",
                }.get(step.status, "dim")
                
                plan_branch.add(f"{icon} {step.description[:40]}...", style=style)
        
        # Memory stats
        if self.state and self.state.memory_stats:
            mem = self.state.memory_stats
            tree.add(f"🧠 Memory: {mem.get('count', 0)} chunks")
        
        return Panel(tree, title="[bold]Sidebar[/bold]", border_style="blue", box=ROUNDED)
    
    def _make_thoughts(self) -> Panel:
        """Create thoughts panel showing agent reasoning."""
        content = []
        
        if self.state and self.state.thoughts:
            for thought in self.state.thoughts[-5:]:  # Show last 5
                agent = thought.get('agent', 'unknown')
                text = thought.get('content', '')[:200]
                
                role_color = {
                    'planner': 'cyan',
                    'executor': 'yellow',
                    'reviewer': 'magenta'
                }.get(agent, 'white')
                
                content.append(f"[bold {role_color}]{agent.upper()}:[/bold {role_color}] {text}...")
        else:
            content.append("[dim]Waiting for agent thoughts...[/dim]")
        
        text = Text.from_markup("\n".join(content))
        return Panel(text, title="[bold]Agent Thoughts[/bold]", border_style="yellow", box=ROUNDED)
    
    def _make_actions(self) -> Panel:
        """Create actions panel showing execution log."""
        table = Table(show_header=True, header_style="bold", box=ROUNDED, expand=True)
        table.add_column("Time", style="dim", width=8)
        table.add_column("Agent", width=10)
        table.add_column("Action", ratio=1)
        table.add_column("Status", width=10)
        
        if self.state and self.state.observations:
            for obs in self.state.observations[-10:]:
                time_str = datetime.now().strftime("%H:%M:%S")
                agent = obs.get('agent', 'system')
                action = obs.get('action', 'unknown')[:50]
                status = obs.get('status', 'pending')
                
                status_style = {
                    'success': 'green',
                    'error': 'red',
                    'running': 'yellow'
                }.get(status, 'white')
                
                table.add_row(time_str, agent, action, f"[{status_style}]{status}[/{status_style}]")
        else:
            table.add_row("--", "--", "[dim]No actions yet...[/dim]", "--")
        
        return Panel(table, title="[bold]Action Log[/bold]", border_style="green", box=ROUNDED)
    
    def _make_footer(self) -> Panel:
        """Create footer with system stats."""
        # Sandbox status
        sandbox_status = "🔒 Docker" if (self.state and self.state.sandbox_active) else "⚠️ Fallback"
        sandbox_color = "green" if (self.state and self.state.sandbox_active) else "yellow"
        
        # Token usage bar
        token_progress = Progress(
            TextColumn("[bold]Tokens:[/bold]"),
            BarColumn(bar_width=None),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%")
        )
        
        if self.state:
            used = self.state.token_usage
            max_tokens = 128000
            percentage = min(100, (used / max_tokens) * 100)
            token_progress.add_task("Tokens", completed=percentage, total=100)
        else:
            token_progress.add_task("Tokens", completed=0, total=100)
        
        # Risk score
        risk = self.state.risk_score if self.state else 0
        risk_color = "green" if risk < 30 else ("yellow" if risk < 80 else "red")
        risk_text = f"[bold {risk_color}]Risk: {risk}/100[/bold {risk_color}]"
        
        # Current step
        step_info = ""
        if self.state and self.state.plan:
            current = self.state.current_step_idx + 1
            total = len(self.state.plan)
            step_info = f"Step {current}/{total}"
        
        # Build footer grid
        grid = Table.grid(expand=True)
        grid.add_column(justify="left", ratio=1)
        grid.add_column(justify="center", ratio=1)
        grid.add_column(justify="right", ratio=1)
        grid.add_row(
            f"[{sandbox_color}]{sandbox_status}[/{sandbox_color}]",
            token_progress,
            f"{risk_text} | {step_info}"
        )
        
        return Panel(grid, box=ROUNDED, border_style="cyan")
    
    def update(self):
        """Update all panels."""
        if not self.live:
            return
        
        self.layout["header"].update(self._make_header())
        self.layout["sidebar"].update(self._make_sidebar())
        self.layout["thoughts"].update(self._make_thoughts())
        self.layout["actions"].update(self._make_actions())
        self.layout["footer"].update(self._make_footer())
    
    def _state_callback(self, state: SharedState):
        """Callback for state changes."""
        self.update()
    
    async def start(self):
        """Start the live dashboard."""
        self.running = True
        
        # Subscribe to state changes
        if self.state:
            self.state.subscribe(self._state_callback)
        
        with Live(self.layout, console=self.console, refresh_per_second=2) as live:
            self.live = live
            self.update()
            
            while self.running:
                await asyncio.sleep(self.config.refresh_rate)
                self.update()
    
    def stop(self):
        """Stop the dashboard."""
        self.running = False
        if self.live:
            self.live.stop()
    
    def log(self, message: str, level: str = "info"):
        """Add log entry to display."""
        self.logs.append({"time": datetime.now(), "message": message, "level": level})
        if len(self.logs) > self.config.max_log_entries:
            self.logs = self.logs[-self.config.max_log_entries:]
