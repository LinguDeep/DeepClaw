# LinguClaw — Codebase-Aware Multi-Agent System

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.9+-blue.svg" alt="Python 3.9+">
  <img src="https://img.shields.io/badge/Docker-Required-green.svg" alt="Docker">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License">
</p>

**LinguClaw** is a professional, production-ready AI agent system that combines:

- 🦀 **Multi-Agent Orchestration** — Planner, Executor, and Reviewer agents collaborating on tasks
- 🔒 **Docker Sandboxing** — All commands run in isolated containers (512MB RAM, 0.5 CPU limit)
- 🧠 **RAG Memory** — Semantic code search with LanceDB and sentence-transformers
- 🖥️ **Professional TUI** — Rich.Live dashboard with real-time agent thoughts and execution logs
- 🔐 **Safety-First Design** — Dynamic risk scoring with mandatory confirmation for destructive actions

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
| `ui.py` | Rich.Live TUI dashboard with 3-pane layout (Sidebar, Main, Footer) |
| `cli.py` | Typer-based CLI with `dev`, `index`, `status` commands |
| `memory.py` | LanceDB vector storage + CodeIndexer for semantic search |
| `sandbox.py` | Docker container management with resource limits |
| `tools.py` | Containerized shell execution + file operations |
| `safety.py` | Risk-scoring engine (0-100) with pattern matching |
| `provider.py` | OpenRouter API client with token budgeting |

---

## Features

### 🔒 Docker Sandboxing

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
│   ├── ui.py           # TUI dashboard
│   ├── agent.py        # Legacy ReAct agent
│   ├── memory.py       # RAG memory system
│   ├── sandbox.py      # Docker management
│   ├── tools.py        # Shell/file tools
│   ├── provider.py     # LLM provider
│   ├── safety.py       # Risk scoring
│   ├── platform_info.py # OS detection
│   ├── config.py       # Settings
│   └── logger.py       # Structured logging
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

### Adding New Tools

1. Add tool logic in `tools.py`
2. Add action type in `orchestrator.py`
3. Update agent prompts with new capability

---

## License

MIT License — see [LICENSE](LICENSE) file.

## Acknowledgments

- [Rich](https://github.com/Textualize/rich) for the beautiful TUI components
- [LanceDB](https://lancedb.github.io/lancedb/) for vector storage
- [Typer](https://typer.tiangolo.com/) for the CLI framework
- [OpenRouter](https://openrouter.ai/) for LLM API access
