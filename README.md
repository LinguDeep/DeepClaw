<div align="center">

# 🦾 DeepClaw
![Image_fx(1)](https://github.com/user-attachments/assets/9e81ac57-84fd-4903-accc-a97989811887)


https://github.com/user-attachments/assets/e03c22f9-908e-426b-bc2e-a3a3264de891



**The Unified AI Engineering Assistant**

A powerful, deeply integrated AI assistant that combines high-performance engineering precision with autonomous agent capabilities.

[![CI](https://github.com/LinguDeep/DeepClaw/workflows/DeepClaw%20CI/badge.svg)](https://github.com/LinguDeep/DeepClaw/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Rust](https://img.shields.io/badge/rust-1.70%2B-orange.svg)](https://www.rust-lang.org)
[![Node.js](https://img.shields.io/badge/node.js-18%2B-green.svg)](https://nodejs.org)

</div>

## 🚀 Overview

DeepClaw is a next-generation AI engineering assistant that seamlessly integrates:

- **🔧 High-Performance Engine** - Rust-powered terminal handlers, filesystem operations, and intelligent codebase navigation
- **🧠 Intelligent Brain** - TypeScript-based autonomous agent with extensible skill framework and multi-channel support
- **📊 Visual Dashboard** - Real-time monitoring, file exploration, and comprehensive system control

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     DeepClaw Dashboard                      │
│              (Real-time monitoring & control)               │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
┌────────▼────────┐          ┌──────────▼──────────┐
│  Rust Engine    │◄─────────►│  TypeScript Agent  │
│  (Terminal,     │  Bridge  │  (Skills, Channels,│
│   Filesystem,   │  Layer   │   Gateway Logic)   │
│   Repo-mapper)  │          │                    │
└─────────────────┘          └─────────────────────┘
```

## 📦 Components

### 🔧 Engine (`/engine`)
The Rust workspace provides the foundational core:
- **Terminal Handlers** - High-performance command execution with real-time output streaming
- **Filesystem Operations** - Safe, efficient file operations with context awareness
- **Repo-Mapper** - Intelligent codebase navigation and understanding
- **Multi-Provider API** - Support for Anthropic, OpenAI, Google, xAI, and more

### 🧠 Brain (`/brain`)
The TypeScript agent framework provides intelligent capabilities:
- **Skill Framework** - Extensible system for custom capabilities
- **Channel Integration** - Multi-platform messaging (WhatsApp, Telegram, Slack, Discord, Signal, etc.)
- **Gateway Protocol** - WebSocket-based control plane for agent communication
- **Agent Runtime** - Session management, tool orchestration, and advanced reasoning

### 📊 Dashboard (`/dashboard`)
The visual interface provides real-time monitoring:
- **Live Terminal Logs** - Real-time display of engine terminal output
- **File Explorer** - Repository browser with intelligent navigation
- **Settings Panel** - API key management and system configuration
- **Session Monitoring** - Track agent sessions, costs, and usage analytics

## 🚀 Quick Start

### Prerequisites

- **Rust** 1.70+ (for the engine)
- **Node.js** 18+ (for the brain and dashboard)
- **pnpm** (recommended for TypeScript dependencies)

### Installation

```bash
# Clone the repository
git clone https://github.com/LinguDeep/DeepClaw.git
cd DeepClaw

# Build the Rust engine
cd engine
cargo build --release

# Install TypeScript dependencies
cd ../brain
pnpm install

# Build the brain
pnpm build

# Install dashboard dependencies
cd ../dashboard
npm install
```

### Configuration

Create your configuration file at `~/.deepclaw/config.json`:

```json
{
  "agent": {
    "model": "anthropic/claude-3-5-sonnet",
    "workspace": "~/.deepclaw/workspace"
  },
  "gateway": {
    "port": 18789,
    "bind": "loopback"
  },
  "apiKeys": {
    "anthropic": "sk-ant-...",
    "openai": "sk-..."
  }
}
```

### Running DeepClaw

```bash
# Start the Rust engine bridge (in one terminal)
make run-engine

# Start the dashboard (in another terminal)
make run-dashboard

# Or start all components at once
make run-dev
```

Visit `http://localhost:7000` to access the dashboard.

## ✨ Features

### 🔧 High-Performance Engine
- **Lightning-fast terminal execution** - Rust-powered command execution with real-time output streaming
- **Intelligent file operations** - Context-aware file editing and manipulation
- **Smart codebase navigation** - Automatic repository mapping and understanding
- **Multi-provider support** - Anthropic, OpenAI, Google, xAI, and more

### 🧠 Autonomous Agent
- **Multi-channel communication** - WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, and more
- **Extensible skill system** - Build custom capabilities with the skill framework
- **Advanced session management** - Isolated agent sessions with context preservation
- **Powerful tool orchestration** - Browser control, canvas, nodes, cron jobs, and webhooks

### 📊 Visual Dashboard
- **Real-time log streaming** - Live terminal output from the Rust engine
- **Interactive file explorer** - Browse and edit workspace files with ease
- **Cost tracking** - Monitor API usage and spending in real-time
- **System health monitoring** - CPU, RAM, disk, and temperature metrics
- **Security dashboard** - UFW rules, open ports, and audit logs

## 🛠️ Development

### Building from Source

```bash
# Build all components
make build

# Run tests
make test

# Clean build artifacts
make clean

# Development setup
make setup
```

### Project Structure

```
DeepClaw/
├── engine/          # Rust workspace
│   ├── crates/
│   │   ├── api/           # API clients and providers
│   │   ├── runtime/       # Core runtime logic
│   │   ├── tools/         # Tool implementations
│   │   ├── websocket-bridge/  # WebSocket bridge server
│   │   └── rusty-claude-cli/  # CLI interface
│   └── Cargo.toml
├── brain/           # TypeScript agent
│   ├── src/
│   │   ├── agents/        # Agent runtime
│   │   ├── gateway/       # Gateway protocol
│   │   ├── channels/      # Channel integrations
│   │   ├── deepclaw-bridge/  # Bridge client for Rust engine
│   │   └── skills/        # Skill framework
│   ├── packages/          # Workspace packages
│   └── package.json
├── dashboard/       # Node.js dashboard
│   ├── server.js           # Dashboard server
│   ├── index.html          # Dashboard UI
│   └── scripts/            # Utility scripts
├── Makefile         # Unified build system
├── .github/         # GitHub Actions workflows
└── README.md
```

## 🔌 Integration Architecture

The DeepClaw integration layer bridges the Rust engine and TypeScript agent:

1. **WebSocket Bridge** - The Rust engine exposes a WebSocket API that the TypeScript agent connects to
2. **Tool Proxy** - Agent tools are proxied through the Rust engine for execution
3. **Log Streaming** - Terminal output from Rust is streamed to the dashboard in real-time
4. **File Operations** - File edits are coordinated between the engine's filesystem manipulator and the agent's tool layer

## ⚙️ Configuration

### API Keys

Set your API keys in the dashboard settings panel or in `~/.deepclaw/config.json`:

```json
{
  "apiKeys": {
    "anthropic": "sk-ant-...",
    "openai": "sk-...",
    "google": "AIza...",
    "xai": "xai-..."
  }
}
```

### Model Selection

Configure your preferred model:

```json
{
  "agent": {
    "model": "anthropic/claude-3-5-sonnet",
    "fallbackModels": [
      "openai/gpt-4o",
      "google/gemini-2.5-pro"
    ]
  }
}
```

### Channels

Configure messaging channels:

```json
{
  "channels": {
    "telegram": {
      "botToken": "123456:ABCDEF"
    },
    "slack": {
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }
}
```

## 🔒 Security

- **Local-first** - All data stays on your machine by default
- **Secure authentication** - PBKDF2 password hashing with 100,000 iterations
- **Rate limiting** - Protection against brute-force attacks
- **Audit logging** - All actions logged for security review
- **Sandboxing** - Optional Docker sandboxing for non-main sessions

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## 📄 License

MIT License - see LICENSE file for details.

## 📚 Documentation

For more detailed information, check out:
- [Integration Guide](INTEGRATION.md) - Detailed integration documentation
- [Architecture Overview](docs/architecture.md) - System architecture details

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/LinguDeep/DeepClaw/issues)
- **Discussions**: [GitHub Discussions](https://github.com/LinguDeep/DeepClaw/discussions)

---

<div align="center">

Made with ✨ by the DeepClaw community

</div>
