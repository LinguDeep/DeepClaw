<div align="center">

# LinguClaw

**Codebase-Aware Multi-Agent AI System**

[![CI/CD](https://github.com/LinguDeep/LinguClaw/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/LinguDeep/LinguClaw/actions/workflows/ci-cd.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green?logo=node.js&logoColor=white)](https://nodejs.org/)

LinguClaw is a TypeScript-powered AI platform that combines multi-agent orchestration, static code analysis across 7 languages, a visual workflow engine, real-time messaging integrations, and a professional web dashboard — all in one system.

[Getting Started](#-getting-started) · [Features](#-features) · [Architecture](#-architecture) · [Docs](#-documentation) · [Contributing](CONTRIBUTING.md)

</div>

---

## ✨ Features

### Multi-Agent AI System

Seven specialized agents work together through an orchestrator:

| Agent | Role |
|-------|------|
| **Architect** | System design & architecture planning |
| **Coder** | Intelligent code implementation |
| **Reviewer** | Automated code review with quality checks |
| **Tester** | Test generation & coverage analysis |
| **Security** | Vulnerability detection & hardening |
| **Optimizer** | Performance analysis & optimization |
| **Coordinator** | Multi-agent task orchestration |

Supports **OpenAI**, **Anthropic**, **OpenRouter**, **Ollama**, and **LM Studio** as LLM providers.

### Multi-Language Code Analysis

Deep static analysis with AST parsing for **7 languages**:

- **TypeScript / JavaScript** — modern features, async patterns
- **Python** — security analysis, type inference
- **Rust** — ownership, lifetimes, memory safety
- **Go** — goroutines, channels, concurrency patterns
- **Java** — Spring annotations, enterprise patterns
- **C++** — templates, memory management, performance
- **C#** — LINQ, async/await, .NET patterns, nullable types

Detects SQL injection, XSS, hardcoded secrets, insecure deserialization, weak cryptography, and more. Computes cyclomatic complexity, Halstead metrics, and maintainability index.

### Visual Workflow Engine

An **n8n-style** node-based workflow system with a drag-and-drop canvas editor:

- **22 built-in nodes** across 5 categories
- **Triggers** — Manual, Schedule, Webhook, Email
- **Actions** — HTTP Request, Shell Command, Send Email, AI Prompt, Telegram, File R/W, Memory Store/Retrieve, Delay
- **Logic** — If/Else Condition, Switch
- **Transform** — Code Transform, JSON Transform, Text Template, Merge
- **Output** — Log, Webhook Response
- SVG bezier connections, zoom/pan, undo/redo, visual execution feedback
- Full CRUD API with topological-sort execution

### Messaging Integrations

Send and receive messages across 4 platforms:

| Platform | Method |
|----------|--------|
| **Telegram** | Bot API with long polling |
| **Discord** | Gateway WebSocket + REST |
| **Slack** | Web API + Socket Mode |
| **WhatsApp** | Twilio API |

Unified inbox with email (IMAP/SMTP) support via Nodemailer.

### Web Dashboard

A professional dark-themed SPA with 10 views:

- **Home** — System health, topology, quick actions
- **Inbox** — Unified message inbox across all platforms
- **Chat** — Streaming AI chat with model indicator
- **Tasks** — Planner → Executor → Reviewer pipeline
- **Memory** — Persistent key-value store with categories
- **Skills** — Plugin management & integration config
- **Workflows** — List, create, execute visual workflows
- **Scheduler** — Cron, interval, and one-time jobs
- **Browser** — Web automation, screenshots, AI summarization & extraction
- **Settings** — LLM provider, model, safety mode config

### Additional Capabilities

- **Refactoring Engine** — 15+ automated refactoring operations, dead code elimination, modern syntax conversion
- **Git Integration** — blame, diff, branch management, commit history, code churn analysis
- **Semantic Memory** — TF-IDF search with SQLite backend
- **Task Scheduler** — cron, interval, one-time, and reminder jobs
- **Plugin System** — load custom JS plugins from `plugins/`
- **Sandbox Execution** — Docker-based isolated code execution
- **24/7 Daemon Mode** — background service with auto-restart
- **Proactive Monitoring** — file watchers, automated suggestions
- **Resilience** — retry logic, circuit breakers, graceful degradation

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10

### Installation

```bash
git clone https://github.com/LinguDeep/LinguClaw.git
cd LinguClaw
npm install
npm run build
```

### Configuration

Create a `.env` file in the project root:

```env
# LLM Provider: openai | anthropic | openrouter | ollama | lmstudio
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4o

# OpenAI (alternative)
# LLM_PROVIDER=openai
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4

# Local LLM
# LLM_PROVIDER=ollama
# OLLAMA_URL=http://localhost:11434
```

### Usage

#### Web Interface

```bash
npm start
# Open http://localhost:3000
```

#### CLI

```bash
# Start the web UI
npx linguclaw web

# Interactive AI agent
npx linguclaw agent

# Index codebase for RAG memory
npx linguclaw index ./my-project

# Run as background daemon
npx linguclaw daemon start

# Check system status
npx linguclaw status

# Manage settings
npx linguclaw settings list
npx linguclaw settings set llm.model gpt-4o

# Execute a skill
npx linguclaw skills execute shell "ls -la"
```

#### Programmatic API

```typescript
import { LinguClawEngine, AgentOrchestrator } from 'linguclaw';

const engine = new LinguClawEngine();
await engine.initialize();

// Analyze a file
const result = await engine.analyzeFile('src/example.ts');
console.log(result.metrics);
console.log(result.securityIssues);

// Use the orchestrator
const orchestrator = new AgentOrchestrator('./project', './memory.db');
await orchestrator.initialize();
const taskId = await orchestrator.submitTask({
  type: 'implement',
  priority: 'high',
  description: 'Add user authentication',
});
```

---

## 🏗 Architecture

```
linguclaw/
├── src/
│   ├── core/
│   │   └── engine.ts              # Core analysis engine & AST types
│   ├── languages/
│   │   ├── python.ts              # Python parser & analyzer
│   │   ├── rust.ts                # Rust parser & analyzer
│   │   ├── go.ts                  # Go parser & analyzer
│   │   ├── java.ts                # Java parser & analyzer
│   │   ├── cpp.ts                 # C++ parser & analyzer
│   │   └── csharp.ts              # C# parser & analyzer
│   ├── static/
│   │   ├── dashboard.html         # Main web dashboard SPA
│   │   └── workflow-editor.html   # Visual node editor
│   ├── agent-system.ts            # Multi-agent AI system (7 agents)
│   ├── orchestrator.ts            # Prism orchestrator (plan → execute → review)
│   ├── workflow-engine.ts         # n8n-style workflow execution engine
│   ├── web.ts                     # Express server + REST API
│   ├── cli.ts                     # CLI interface (9 commands)
│   ├── messaging.ts               # Telegram, Discord, Slack, WhatsApp
│   ├── email-receiver.ts          # IMAP email ingestion
│   ├── inbox.ts                   # Unified message inbox
│   ├── browser.ts                 # Puppeteer web automation
│   ├── git-integration.ts         # Git operations & analysis
│   ├── refactoring-engine.ts      # 15+ automated refactorings
│   ├── semantic-memory.ts         # TF-IDF search with SQLite
│   ├── memory.ts                  # Persistent key-value memory
│   ├── scheduler.ts               # Task scheduling (cron/interval)
│   ├── plugins.ts                 # Plugin loader
│   ├── daemon.ts                  # Background service management
│   ├── safety.ts                  # Safety checks & content filtering
│   ├── sandbox.ts                 # Docker-based isolated execution
│   ├── resilience.ts              # Retry, circuit breaker, fallback
│   └── index.ts                   # Public API exports
├── plugins/
│   ├── notes.js                   # Notes plugin example
│   ├── system-info.js             # System info plugin
│   └── weather.js                 # Weather plugin
├── tests/                         # 13 test suites (unit + integration)
├── .github/workflows/             # CI/CD, docs, automation
├── package.json
└── tsconfig.json
```

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      Web Dashboard                       │
│  Home │ Chat │ Tasks │ Workflows │ Browser │ Settings    │
└──────────────────────┬──────────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────┴──────────────────────────────────┐
│                    Express Server                        │
│  /api/chat  /api/task  /api/workflows  /api/browser     │
└─────┬──────┬──────┬──────┬──────┬──────┬────────────────┘
      │      │      │      │      │      │
┌─────┴┐ ┌──┴──┐ ┌─┴──┐ ┌─┴──┐ ┌┴───┐ ┌┴────────┐
│Agents│ │Orch.│ │ WF │ │Git │ │Mem │ │Messaging│
│System│ │     │ │Eng.│ │Int.│ │    │ │TG/DC/SL │
└──────┘ └─────┘ └────┘ └────┘ └────┘ └─────────┘
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run a specific test
npm test -- tests/orchestrator.test.ts

# Watch mode
npm test -- --watch
```

---

## 🔌 Plugins

Create JS files under `plugins/`:

```javascript
// plugins/my-plugin.js
module.exports = {
  name: 'MyPlugin',
  version: '1.0.0',
  async initialize(context) {
    // setup
  },
  async execute(action, params) {
    // logic
    return { result: 'done' };
  }
};
```

See [plugins/README.md](plugins/README.md) for details.

---

## ⚙️ GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci-cd.yml` | Push, PR | Build, lint, test, security scan |
| `docs.yml` | Push to main | Generate & deploy API docs |
| `automation.yml` | Issues, PRs | Auto-labeling, stale management |

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit changes (`git commit -m 'feat: add my feature'`)
4. Push (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**[LinguDeep/LinguClaw](https://github.com/LinguDeep/LinguClaw)**

</div>
