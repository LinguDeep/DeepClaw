# LinguClaw — Codebase-Aware Multi-Agent System

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.9+-blue.svg" alt="Python 3.9+">
  <img src="https://img.shields.io/badge/Docker-Required-green.svg" alt="Docker">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License">
  <img src="https://img.shields.io/badge/OpenClaw-Plugins-orange.svg" alt="OpenClaw Plugins">
</p>

**LinguClaw** is a professional, production-ready AI agent system that combines:

- 🦀 **Multi-Agent Orchestration** — Planner, Executor, and Reviewer agents collaborating on tasks
- � **Prism Architecture** — Multi-faceted agent system with reflection and dispatch
- 🌿 **AlphaBeta Workflow** — Branching execution with alpha (conservative) and beta (experimental) strategies
- 🔌 **OpenClaw Plugin System** — Production-ready extensible plugin architecture
- � **Docker Sandboxing** — All commands run in isolated containers (512MB RAM, 0.5 CPU limit)
- 🧠 **RAG Memory** — Semantic code search with LanceDB and sentence-transformers
- 🌐 **Web UI** — FastAPI-based dashboard with WebSocket real-time updates
- 🖥️ **Professional TUI** — Rich.Live dashboard with real-time agent thoughts and execution logs
- 🔐 **Safety-First Design** — Dynamic risk scoring with mandatory confirmation for destructive actions
<img width="1408" height="768" alt="images" src="https://github.com/user-attachments/assets/cc16af89-163f-4cd1-8838-78aa92b6e142" />

---

## Quick Start

### Prerequisites

- Python 3.9+
- Docker (for sandboxed execution)
- OpenRouter API key

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/linguclaw.git
cd linguclaw

# Install dependencies
pip install -r requirements.txt

# Set your OpenRouter API key
export OPENROUTER_API_KEY="your-key-here"

# Or use a .env file
echo "OPENROUTER_API_KEY=your-key-here" > .env
```

### Usage

```bash
# Run with full TUI dashboard
python run.py dev "Refactor the authentication module"

# Run in a specific project directory
python run.py dev --path ./my-project "Add user login feature"

# Disable Docker sandbox (strict safety fallback mode)
python run.py dev --no-docker "List all Python files"

# Index codebase for RAG memory without running agent
python run.py index --path ./my-project

# Check system status
python run.py status

# Start Web UI server
python run.py web --port 8080
```

---

## Architecture

### Multi-Agent System

```
┌─────────────────────────────────────────────────────────────┐
│                       Orchestrator                           │
│                    (State Management)                          │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Planner     │───▶│   Executor    │───▶│   Reviewer    │
│  (Creates     │    │  (Runs tools) │    │ (Validates    │
│    plan)      │    │               │    │   results)    │
└───────────────┘    └───────────────┘    └───────────────┘
                              │
                              ▼ (if rejected)
                    ┌───────────────────┐
                    │   Retry with      │
                    │   feedback        │
                    └───────────────────┘
```

### Component Overview

| Module | Purpose |
|--------|---------|
| `orchestrator.py` | Coordinates Planner, Executor, Reviewer agents with shared state |
| `prism.py` | Multi-faceted architecture with reflection and dispatch |
| `prism_orchestrator.py` | Integration layer connecting Prism to Orchestrator |
| `alphabeta.py` | Alpha/Beta branching workflow with merge strategies |
| `plugins.py` | OpenClaw plugin system with error isolation |
| `ui.py` | Rich.Live TUI dashboard with 3-pane layout |
| `web.py` | FastAPI Web UI with WebSocket real-time updates |
| `cli.py` | Typer-based CLI with `dev`, `index`, `status`, `web` commands |
| `memory.py` | LanceDB vector storage + CodeIndexer for semantic search |
| `sandbox.py` | Docker container management with resource limits |
| `tools.py` | Containerized shell execution + file operations + plugin tools |
| `safety.py` | Risk-scoring engine (0-100) with pattern matching |
| `provider.py` | OpenRouter API client with token budgeting |

---

## Features

### � Prism Architecture

Prism provides a multi-faceted execution model with reflection:

```
                    ┌─────────────┐
                    │   Task      │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
   ┌─────────┐      ┌──────────┐      ┌──────────┐
   │ Safety  │      │ Planning │      │ Memory   │
   │ Facet   │─────▶│ Facet    │─────▶│ Facet    │
   │ (risk)  │      │ (plan)   │      │ (context)│
   └─────────┘      └────┬─────┘      └──────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
         ┌────────┐ ┌──────────┐ ┌──────────┐
         │Execution│ │Validation│ │  Safety  │
         │ Facet   │ │ Facet    │ │ (final)  │
         └────┬────┘ └────┬─────┘ └────┬─────┘
              │           │          │
              └───────────┴──────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  Reflection   │
                  │  & Dispatch   │
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  Final Output │
                  └───────────────┘
```

**Facets:**
- **Safety Facet** — Risk assessment before action
- **Planning Facet** — Strategy generation
- **Memory Facet** — Context injection
- **Execution Facet** — Action execution
- **Validation Facet** — Result verification

Each facet can reflect on output and dispatch to other facets.

### 🌿 AlphaBeta Workflow

Branching execution with merge strategies:

```
              ┌─────────────┐
              │    Task     │
              └──────┬──────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │  Alpha   │ │   Beta   │ │  Gamma   │
   │ Branch   │ │ Branch   │ │ Branch   │
   │ (safe)   │ │ (risk 70)│ │ (custom) │
   └────┬─────┘ └────┬─────┘ └────┬─────┘
        │            │            │
        └────────────┼────────────┘
                     │
               ┌─────▼─────┐
               │  Prism    │
               │  Core     │
               └─────┬─────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
   ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
   │ Result  │  │ Result  │  │ Result  │
   │(fitness)│  │(fitness)│  │(fitness)│
   └────┬────┘  └────┬────┘  └────┬────┘
        └────────────┼────────────┘
                     │
               ┌─────▼─────┐
               │  Merge    │
               │ Strategy  │
               └─────┬─────┘
                     │
                     ▼
               ┌───────────┐
               │ Final     │
               │ Result    │
               └───────────┘
```

**Merge Strategies:**
- `BestBranch` — Select highest fitness branch
- `Consensus` — Merge outputs from multiple branches

### 🔌 OpenClaw Plugin System

Production-ready extensible plugin architecture:

```
┌─────────────────────────────────────────────────────┐
│              OpenClaw Plugin Manager                │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  ~/.linguclaw/plugins.yaml (config)         │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ ToolPlugin   │  │ AgentPlugin  │  │MemoryPlugin│ │
│  │              │  │              │  │            │ │
│  │ • get_tools()│  │ • modify_    │  │ • pre/     │ │
│  │              │  │   prompt()   │  │   post_    │ │
│  │ Example:     │  │              │  │   process()│ │
│  │ git_status   │  │ Example:     │  │            │ │
│  │ git_log      │  │ code_style   │  │            │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  Features:                                          │
│  • Auto directory creation (~/.linguclaw/plugins)  │
│  • Error isolation (plugin crash ≠ system crash)    │
│  • Runtime load/unload/reload API                   │
│  • Dependency management                            │
│  • Hook/event system                                │
└─────────────────────────────────────────────────────┘
```

**Plugin Types:**
- `ToolPlugin` — Add new tools to ShellTool
- `AgentPlugin` — Modify agent prompts and receive step callbacks
- `MemoryPlugin` — Pre/post process memory queries

### 🌐 Web UI

FastAPI-based web interface with Prism workflow visualization:

- **Dashboard** — Real-time task execution, thoughts, logs
- **🔮 Prism Tab** — Workflow visualization, branch metrics, reflections
- **Plugins Tab** — Plugin management and configuration
- **Settings Tab** — Model selection, max steps, Docker toggle
- **WebSocket** — Live updates without page refresh

Access at `http://localhost:8080` after running `python run.py web`.

### � Docker Sandboxing

Every command runs in an isolated Alpine Linux container:
- **512MB RAM limit**
- **0.5 CPU cores**
- **Read-only root filesystem**
- **Capability dropping** (`cap_drop: ALL`)
- **No new privileges**

Only the project root is mounted (at `/workspace`), keeping the host system protected.

### 🧠 RAG Memory System

Automatic codebase indexing with semantic search:
- Parses functions, classes, and modules
- Generates embeddings with `all-MiniLM-L6-v2`
- Persists in `.linguclaw/memory/` (project-local)
- Auto-injects relevant code into agent context

### 🖥️ Professional TUI

Real-time dashboard showing:
- **Sidebar**: File tree, plan checklist with status icons
- **Main Pane**: Agent thoughts (color-coded by role), action log table
- **Footer**: Docker status, token usage bar, risk score, step progress

### 🔐 Safety Middleware

Dynamic risk scoring for all commands:
- **100**: `rm -rf /`, `mkfs`, `dd if=` — **BLOCKED**
- **90-95**: Disk partition edits, SIP disable, registry force delete — **BLOCKED**
- **70**: `curl | sh` download-and-execute — **CONFIRMATION REQUIRED**
- **35**: Package installs, service management — **LOGGED**

Fallback strict safety mode when Docker is unavailable.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | — | **Required** — OpenRouter API key |
| `LINGUCLAW_MODEL` | `anthropic/claude-3.5-sonnet` | LLM model to use |
| `LINGUCLAW_MAX_BUDGET` | `128000` | Maximum token budget |
| `LINGUCLAW_PROJECT` | `.` | Default project root |
| `LINGUCLAW_TIMEOUT` | `60.0` | Command timeout in seconds |
| `LINGUCLAW_MAX_STEPS` | `15` | Maximum execution steps |
| `LINGUCLAW_LOG_DIR` | `logs` | Log file directory |
| `LINGUCLAW_SKIP_CONFIRM` | `false` | Skip high-risk confirmations (dangerous) |

### Plugin Configuration

Auto-created at `~/.linguclaw/plugins.yaml`:

```yaml
plugins:
  git_tools:
    enabled: true
    settings: {}
  code_style:
    enabled: true
    settings:
      max_line_length: 100
      indent: spaces
  my_plugin:
    enabled: true
    settings:
      api_key: "optional"

global:
  auto_load_builtin: true
  isolate_errors: true
  max_plugins: 10
```

### CLI Options

```bash
python run.py dev [TASK] [OPTIONS]

Options:
  --path PATH           Project root directory [default: .]
  --model TEXT          OpenRouter model [default: anthropic/claude-3.5-sonnet]
  --max-budget INTEGER  Token budget [default: 128000]
  --max-steps INTEGER   Max steps [default: 15]
  --no-docker           Disable Docker sandbox
  --force-fallback      Force strict safety mode
  --no-tui              Disable TUI (plain text)
  --log-dir PATH        Log directory [default: logs]

python run.py web [OPTIONS]

Options:
  --host TEXT           Host to bind [default: 0.0.0.0]
  --port INTEGER        Port to bind [default: 8080]
```

---

## Project Structure

```
linguclaw/
├── run.py              # Entry point
├── requirements.txt    # Dependencies
├── .gitignore          # Git exclusions
├── README.md           # This file
├── LICENSE             # MIT License
├── src/
│   ├── __init__.py
│   ├── cli.py          # Typer CLI
│   ├── orchestrator.py # Multi-agent coordinator
│   ├── prism.py        # Prism multi-faceted architecture
│   ├── prism_orchestrator.py # Prism integration layer
│   ├── alphabeta.py    # Alpha/Beta branching workflow
│   ├── plugins.py      # OpenClaw plugin system
│   ├── web.py          # FastAPI Web UI
│   ├── ui.py           # TUI dashboard
│   ├── agent.py        # Legacy ReAct agent
│   ├── memory.py       # RAG memory system
│   ├── sandbox.py      # Docker management
│   ├── tools.py        # Shell/file tools + plugin integration
│   ├── provider.py     # LLM provider
│   ├── safety.py       # Risk scoring
│   ├── platform_info.py # OS detection
│   ├── config.py       # Settings
│   └── logger.py       # Structured logging
├── src/static/         # Web UI assets
│   ├── style.css       # Main stylesheet
│   ├── prism.css       # Prism workflow styles
│   ├── app.js          # Frontend logic
│   └── prism.js        # Prism visualization
└── logs/               # Session logs (gitignored)
```

---

## Development

### Running Tests

```bash
# Syntax check all modules
python -m py_compile src/*.py

# Check imports
python -c "from src.cli import cli_entry; print('✓ All imports OK')"
```

### Adding Plugins

1. Create a Python file in `~/.linguclaw/plugins/`:

```python
# ~/.linguclaw/plugins/my_plugin.py
from src.plugins import ToolPlugin
from typing import Dict, Callable

class MyPlugin(ToolPlugin):
    NAME = "my_plugin"
    VERSION = "1.0.0"
    DESCRIPTION = "My custom plugin"
    AUTHOR = "Your Name"
    
    async def initialize(self) -> bool:
        self.logger.info("My plugin initialized")
        return True
    
    async def shutdown(self) -> None:
        self.logger.info("My plugin shutdown")
    
    def _define_tools(self) -> Dict[str, Callable]:
        return {
            "hello": lambda name: f"Hello, {name}!"
        }
```

2. Enable in `~/.linguclaw/plugins.yaml`:

```yaml
plugins:
  my_plugin:
    enabled: true
```

3. Use in tasks:

```bash
python run.py dev "Run hello world using my_plugin.hello"
```

---

## License

MIT License — see [LICENSE](LICENSE) file.

## Acknowledgments

- [Rich](https://github.com/Textualize/rich) for the beautiful TUI components
- [LanceDB](https://lancedb.github.io/lancedb/) for vector storage
- [Typer](https://typer.tiangolo.com/) for the CLI framework
- [FastAPI](https://fastapi.tiangolo.com/) for the Web UI framework
- [OpenRouter](https://openrouter.ai/) for LLM API access
