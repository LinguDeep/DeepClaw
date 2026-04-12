# DeepClaw

<p align="center">
  <img src="assets/deepclaw-hero.png" alt="DeepClaw" width="300" />
</p>

<p align="center">
  <strong>The Unified AI Engineering Assistant</strong>
</p>

DeepClaw is a deeply integrated AI assistant that combines high-performance engineering precision with autonomous assistant capabilities. It merges three powerful projects into a unified system:

- **The Engine (Claw)**: High-performance Rust/Python terminal handlers, filesystem manipulators, and repo-mapping logic from the Claude Code source
- **The Intelligence (Brain)**: Autonomous agent logic and skill framework from DeepClaw
- **The Command Center (Face)**: Visual GUI for monitoring and control from the DeepClaw Dashboard

## Architecture

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

## Components

### Engine (`/engine`)
The Rust workspace provides the foundational core:
- **Terminal handlers**: High-performance command execution and output streaming
- **Filesystem manipulators**: Safe, efficient file operations
- **Repo-mapper**: Intelligent codebase navigation and understanding
- **API clients**: Multi-provider LLM integration (Anthropic, OpenAI, Google, etc.)

### Brain (`/brain`)
The TypeScript agent framework provides intelligent capabilities:
- **Skill framework**: Extensible skill system for custom capabilities
- **Channel integration**: Multi-platform messaging (WhatsApp, Telegram, Slack, Discord, etc.)
- **Gateway protocol**: WebSocket-based control plane
- **Agent runtime**: Session management, tool orchestration, and reasoning

### Dashboard (`/dashboard`)
The visual interface provides real-time monitoring:
- **Terminal logs**: Live display of Rust engine terminal output
- **File explorer**: Repository browser powered by the repo-mapper
- **Settings panel**: API key management and configuration
- **Session monitoring**: Track agent sessions, costs, and usage

## Quick Start

### Prerequisites

- **Rust** 1.70+ (for the engine)
- **Node.js** 24+ or 22.16+ (for the brain and dashboard)
- **pnpm** (recommended for TypeScript dependencies)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/deepclaw.git
cd deepclaw

# Build the Rust engine
cd engine
cargo build --release

# Install TypeScript dependencies
cd ../brain
pnpm install

# Build the brain
pnpm build

# Start the dashboard
cd ../dashboard
npm install
node server.js
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
# Start the Rust engine (terminal handler)
./engine/target/release/deepclaw engine --port 9000

# Start the agent brain (in a new terminal)
cd brain
pnpm start

# Start the dashboard (in a new terminal)
cd dashboard
node server.js
```

Visit `http://localhost:7000` to access the dashboard.

## Features

### Engineering Precision (from Claude Code)
- **High-performance terminal**: Rust-based command execution with real-time output
- **Intelligent file operations**: Context-aware file editing and manipulation
- **Repository understanding**: Automatic codebase mapping and navigation
- **Multi-provider support**: Anthropic, OpenAI, Google, xAI, and more

### Autonomous Assistant (from DeepClaw)
- **Multi-channel inbox**: WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, and more
- **Skill system**: Extensible framework for custom capabilities
- **Session management**: Isolated agent sessions with context preservation
- **Tool orchestration**: Browser control, canvas, nodes, cron, and webhooks

### Visual Control (from Dashboard)
- **Real-time logs**: Live terminal output from the Rust engine
- **File explorer**: Browse and edit workspace files
- **Cost tracking**: Monitor API usage and spending
- **System health**: CPU, RAM, disk, and temperature monitoring
- **Security dashboard**: UFW rules, open ports, and audit logs

## Development

### Building from Source

```bash
# Build all components
make build

# Run tests
make test

# Development mode with hot reload
make dev
```

### Project Structure

```
deepclaw/
├── engine/          # Rust workspace (Claude Code source)
│   ├── crates/
│   │   ├── api/           # API clients and providers
│   │   ├── runtime/       # Core runtime logic
│   │   ├── tools/         # Tool implementations
│   │   └── rusty-claude-cli/  # CLI interface
│   └── Cargo.toml
├── brain/           # TypeScript agent (DeepClaw source)
│   ├── src/
│   │   ├── agents/        # Agent runtime
│   │   ├── gateway/       # Gateway protocol
│   │   ├── channels/      # Channel integrations
│   │   └── skills/        # Skill framework
│   ├── packages/          # Workspace packages
│   └── package.json
├── dashboard/       # Node.js dashboard
│   ├── server.js           # Dashboard server
│   ├── index.html          # Dashboard UI
│   └── scripts/            # Utility scripts
├── config/          # Shared configuration
└── README.md
```

## Integration Architecture

The DeepClaw integration layer bridges the Rust engine and TypeScript agent:

1. **WebSocket Bridge**: The Rust engine exposes a WebSocket API that the TypeScript agent connects to
2. **Tool Proxy**: Agent tools are proxied through the Rust engine for execution
3. **Log Streaming**: Terminal output from Rust is streamed to the dashboard in real-time
4. **File Operations**: File edits are coordinated between the engine's filesystem manipulator and the agent's tool layer

## Configuration

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

## Security

- **Local-first**: All data stays on your machine by default
- **Secure auth**: PBKDF2 password hashing with 100,000 iterations
- **Rate limiting**: Protection against brute-force attacks
- **Audit logging**: All actions logged for security review
- **Sandboxing**: Optional Docker sandboxing for non-main sessions

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details.

## Acknowledgments

DeepClaw is built on the shoulders of giants:

- **Claude Code** (ultraworkers/claw-code) - The Rust engine foundation
- **DeepClaw** (openclaw/openclaw) - The agent framework and skills
- **DeepClaw Dashboard** (tugcantopaloglu/openclaw-dashboard) - The visual interface

## Support

- **Issues**: [GitHub Issues](https://github.com/LinguDeep/deepclaw/issues)
- **Discussions**: [GitHub Discussions](https://github.com/LinguDeep/deepclaw/discussions)

---

Made with ✨ by the DeepClaw community
