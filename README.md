# LinguClaw — Codebase-Aware Multi-Agent System

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-blue.svg" alt="TypeScript 5.0+">
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

- Node.js 18+
- npm or yarn
- Docker (for sandboxed execution)
- OpenRouter API key

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/linguclaw.git
cd linguclaw

# Install dependencies
npm install

# Set your OpenRouter API key
export OPENROUTER_API_KEY="your-key-here"

# Or use a .env file
echo "OPENROUTER_API_KEY=your-key-here" > .env
```

### Usage

```bash
# Build the project
npm run build

# Run with CLI
npm start -- dev "Refactor the authentication module"

# Run in a specific project directory
npm start -- dev --path ./my-project "Add user login feature"

# Disable Docker sandbox
npm start -- dev --no-docker "List all files"

# Check system status
npm start -- status

# Start Web UI server
npm start -- web --port 8080
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
| `orchestrator.ts` | Coordinates Planner, Executor, Reviewer agents with shared state |
| `prism.ts` | Multi-faceted architecture with reflection and dispatch |
| `prism-orchestrator.ts` | Integration layer connecting Prism to Orchestrator |
| `alphabeta.ts` | Alpha/Beta branching workflow with merge strategies |
| `plugins.ts` | OpenClaw plugin system with error isolation |
| `web.ts` | Express.js Web UI with WebSocket real-time updates |
| `cli.ts` | Commander.js CLI with `dev`, `index`, `status`, `web` commands |
| `memory.ts` | LanceDB vector storage + CodeIndexer for semantic search |
| `sandbox.ts` | Docker container management with resource limits |
| `tools.ts` | Containerized shell execution + file operations + plugin tools |
| `safety.ts` | Risk-scoring engine (0-100) with pattern matching |
| `multi-provider.ts` | Multi-provider LLM support (OpenRouter, OpenAI, Anthropic, Ollama, LM Studio) |

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

Express.js-based web interface with Prism workflow visualization:

- **Dashboard** — Real-time task execution, thoughts, logs
- **🔮 Prism Tab** — Workflow visualization, branch metrics, reflections
- **Plugins Tab** — Plugin management and configuration
- **Settings Tab** — Model selection, max steps, Docker toggle
- **WebSocket** — Live updates without page refresh

Access at `http://localhost:8080` after running `npm start -- web`.

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
npm start -- dev [TASK] [OPTIONS]

Options:
  --path PATH           Project root directory [default: .]
  --model TEXT          LLM model [default: anthropic/claude-3.5-sonnet]
  --max-budget INTEGER  Token budget [default: 128000]
  --max-steps INTEGER   Max steps [default: 15]
  --no-docker           Disable Docker sandbox
  --force-fallback      Force strict safety mode
  --log-dir PATH        Log directory [default: logs]

npm start -- web [OPTIONS]

Options:
  --host TEXT           Host to bind [default: 0.0.0.0]
  --port INTEGER        Port to bind [default: 8080]
```

---

## Project Structure

```
linguclaw/
├── package.json        # Dependencies and scripts
├── package-lock.json   # Lock file
├── tsconfig.json       # TypeScript configuration
├── .gitignore          # Git exclusions
├── README.md           # This file
├── LICENSE             # MIT License
├── src/
│   ├── index.ts        # Entry point
│   ├── cli.ts          # Commander.js CLI
│   ├── orchestrator.ts # Multi-agent coordinator
│   ├── types.ts        # TypeScript types and interfaces
│   ├── multi-provider.ts # Multi-provider LLM support
│   ├── safety.ts       # Risk scoring
│   ├── sandbox.ts      # Docker management
│   ├── tools.ts        # Shell/file tools
│   ├── memory.ts       # RAG memory system
│   ├── longterm-memory.ts # SQLite-based persistent storage
│   ├── skills.ts       # Modular skill system
│   ├── messaging.ts    # Messaging platform integrations
│   ├── proactive.ts    # Proactive behavior system
│   ├── privacy.ts      # Privacy and data control
│   ├── daemon.ts       # 24/7 daemon mode
│   └── web.ts          # Express.js Web UI with WebSockets
├── dist/               # Compiled JavaScript (gitignored)
└── logs/               # Session logs (gitignored)
```

---

## Development

### Running Tests

```bash
# Build the project
npm run build

# Run tests
npm test

# Check TypeScript compilation
npx tsc --noEmit
```

### Adding Plugins

1. Create a TypeScript file in `~/.linguclaw/plugins/`:

```typescript
// ~/.linguclaw/plugins/my_plugin.ts
import { ToolPlugin } from 'linguclaw';

export class MyPlugin extends ToolPlugin {
  NAME = "my_plugin";
  VERSION = "1.0.0";
  DESCRIPTION = "My custom plugin";
  AUTHOR = "Your Name";
  
  async initialize(): Promise<boolean> {
    this.logger.info("My plugin initialized");
    return true;
  }
  
  async shutdown(): Promise<void> {
    this.logger.info("My plugin shutdown");
  }
  
  _define_tools(): Record<string, Function> {
    return {
      hello: (name: string) => `Hello, ${name}!`
    };
  }
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
npm start -- dev "Run hello world using my_plugin.hello"
```

---

## License

MIT License — see [LICENSE](LICENSE) file.

## Acknowledgments

- [Rich](https://github.com/Textualize/rich) for the beautiful TUI components
- [LanceDB](https://lancedb.github.io/lancedb/) for vector storage
- [Commander.js](https://github.com/tj/commander.js/) for the CLI framework
- [Express](https://expressjs.com/) for the Web UI framework
- [OpenRouter](https://openrouter.ai/) for LLM API access
