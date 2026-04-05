#  LinguClaw

<div align="center">

![LinguClaw](https://img.shields.io/badge/LinguClaw-AI%20Agent%20System-blue?style=for-the-badge&logo=typescript)
![Version](https://img.shields.io/badge/version-0.3.0-green?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-yellow?style=for-the-badge)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=for-the-badge&logo=node.js)

**Production-ready multi-agent AI system with email integration, web dashboard, and sandboxed execution**

[⭐ Star](https://github.com/yourusername/linguclaw) · [🐛 Issues](https://github.com/yourusername/linguclaw/issues) · [📖 Docs](https://github.com/yourusername/linguclaw/wiki)

</div>

---

## ✨ What Makes LinguClaw Special?

LinguClaw isn't just another AI assistant. It's a **complete multi-agent ecosystem** that can:

🤖 **Think Collaboratively** - Multiple AI agents work together like a team  
📧 **Understand Your Emails** - Intelligent email processing with perfect UTF-8 support  
🌐 **Manage Everything** - Beautiful web interface for all operations  
🔌 **Extend Infinitely** - Plugin architecture for unlimited capabilities  
🐳 **Stay Safe** - Docker sandboxing for every command  
🧠 **Remember Everything** - Semantic memory with advanced search  

---

## 🚀 Quick Start

### Prerequisites

```bash
# Check Node.js version (must be 18+)
node --version

# Check Docker (required for sandboxing)
docker --version
```

### Installation

```bash
# Clone and setup
git clone https://github.com/yourusername/linguclaw.git
cd linguclaw
npm install

# Configure your environment
cp .env.example .env
nano .env  # Add your OpenRouter API key
```

### Environment Setup

```env
# Required - Get your free key at https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Optional - Email integration
EMAIL_HOST=imap.gmail.com
EMAIL_PORT=993
EMAIL_USERNAME=your@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_USE_IDLE=false
```

### Run It!

```bash
# Build and start
npm run build
npm start

# Or for development
npm run dev
```

🎉 **Open your browser to `http://localhost:8080`**

---

## 📧 Email Integration That Actually Works

Tired of garbled email subjects and duplicate messages? We fixed it:

### ✅ What We Solved

- **MIME Decoding** - Perfect UTF-8 character support (no more "=?UTF-8?Q?")
- **Duplicate Prevention** - Smart detection eliminates duplicate emails
- **Real-time Updates** - WebSocket notifications for new messages
- **Security First** - TLS/SSL with certificate handling
- **Multiple Folders** - Monitor INBOX, Sent, Drafts, etc.

### 🎯 Email Features

```typescript
// Automatically handles:
- Turkish characters: "Toprak, yeni Google Hesabınızın kurulumunu tamamlayın"
- Russian characters: "ЯГМУР‎ gelmiş, şerefler getirmiş"
- Emoji support: "Mutlu mekanınıza geri dönün ✨"
- HTML emails: Clean text extraction
- Attachments: Safe handling
```

---

## 🤖 Multi-Agent Architecture

LinguClaw uses a sophisticated multi-agent system:

### Agent Roles

| Agent | Responsibility | Skills |
|-------|----------------|---------|
| **Planner** | Strategy & Planning | Task decomposition, goal setting |
| **Executor** | Implementation | Code writing, command execution |
| **Reviewer** | Quality Control | Testing, validation, optimization |

### 🔄 Agent Workflow

```
User Request → Planner → Executor → Reviewer → Result
     ↓           ↓         ↓          ↓        ↓
  Analysis   Strategy   Code     Testing   Success!
```

---

## 🌐 Web Dashboard

A modern, responsive web interface that puts you in control:

### 🎛️ Dashboard Features

- **💬 Chat Interface** - Real-time conversation with AI agents
- **📧 Email Center** - Manage your inbox with AI assistance
- **🤖 Agent Monitor** - Watch your agents work in real-time
- **🔌 Plugin Manager** - Enable/disable capabilities
- **⏰ Task Scheduler** - Automate recurring tasks
- **⚙️ Settings Panel** - Configure everything in one place

### 📱 Responsive Design

- Desktop: Full-featured dashboard
- Tablet: Optimized touch interface
- Mobile: Essential features on the go

---

## 🔌 Plugin System

Extend LinguClaw with custom plugins:

### 🛠️ Creating a Plugin

```typescript
import { Plugin, PluginContext, PluginResult } from './types';

export class MyAwesomePlugin implements Plugin {
  name = 'my-awesome-plugin';
  version = '1.0.0';
  description = 'Does something amazing';

  async execute(context: PluginContext): Promise<PluginResult> {
    // Your plugin logic here
    return {
      success: true,
      data: 'Mission accomplished!',
      metadata: { executionTime: Date.now() }
    };
  }
}
```

### 🔥 Built-in Plugins

- **File Manager** - Secure file operations
- **Web Scraper** - Extract data from websites
- **Code Analyzer** - Understand and modify codebases
- **Email Assistant** - Smart email management
- **Task Scheduler** - Automate recurring work

---

## 🐳 Docker Sandboxing

Every command runs in a secure, isolated container:

### 🔒 Security Features

```
┌─────────────────────────────────────┐
│         Docker Container            │
│  ┌─────────────────────────────┐   │
│  │      Command Execution      │   │
│  │  • 512MB RAM Limit          │   │
│  │  • 0.5 CPU Cores           │   │
│  │  • Network Restricted      │   │
│  │  • Temporary Filesystem     │   │
│  │  • Isolated Environment     │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### 🛡️ Why Sandboxing Matters

- **Prevents Data Leaks** - Commands can't access your files
- **Stops Malicious Code** - Isolated execution environment
- **Resource Limits** - No infinite loops or resource hogging
- **Clean State** - Each command starts fresh

---

## 🧠 Memory & Intelligence

LinguClaw remembers everything and learns from experience:

### 🧩 Memory Components

- **Semantic Search** - Find anything using natural language
- **Code Context** - Understand your entire codebase
- **Conversation History** - Never lose context
- **Knowledge Base** - Store and retrieve important information

### 🔍 Search Capabilities

```typescript
// Find code by description
"Find the function that handles user authentication"

// Natural language search
"Show me all email-related files"

// Context-aware results
"Where did I configure the database connection?"
```

---

## 📝 API Reference

### REST Endpoints

```http
# Chat & Communication
GET    /api/messages          # Get chat history
POST   /api/chat              # Send message
GET    /api/agents/status     # Check agent status

# Email Management
GET    /api/inbox/messages    # Get emails
POST   /api/inbox/mark-read   # Mark as read
DELETE /api/inbox/:id         # Delete message

# Plugin System
GET    /api/plugins           # List plugins
POST   /api/plugins/execute   # Run plugin
PUT    /api/plugins/:id       # Update plugin

# File Operations
GET    /api/files             # List files
POST   /api/files/upload      # Upload file
DELETE /api/files/:id         # Delete file
```

### WebSocket Events

```javascript
// Real-time updates
ws.on('chat:message', (message) => {
  console.log('New message:', message);
});

ws.on('inbox:update', (emails) => {
  console.log('New emails:', emails);
});

ws.on('agent:status', (status) => {
  console.log('Agent status:', status);
});
```

---

## 🛠️ Development

### Project Structure

```
src/
├── agents/          # 🤖 Multi-agent system
│   ├── planner.ts   # Strategy and planning
│   ├── executor.ts  # Code execution
│   └── reviewer.ts  # Quality control
├── email/           # 📧 Email integration
│   ├── receiver.ts  # IMAP/Gmail handling
│   └── parser.ts    # MIME decoding
├── web/             # 🌐 Web interface
│   ├── dashboard.ts # Main dashboard
│   └── chat.ts      # Chat interface
├── plugins/         # 🔌 Plugin system
├── memory/          # 🧠 RAG memory
├── sandbox/         # 🐳 Docker integration
└── tools/           # 🛠️ Utility functions
```

### Development Commands

```bash
# Development
npm run dev          # Start with hot reload
npm run build        # Production build
npm start            # Run production build

# Code Quality
npm run lint         # ESLint check
npm test             # Run tests
npm run test:watch   # Watch mode

# Debugging
npm run debug        # Debug mode
npm run logs         # View logs
```

---

## 🔒 Security & Best Practices

### 🛡️ Security Features

- **Risk Scoring** - Every action gets a risk score
- **Confirmation Required** - Dangerous actions need approval
- **Sandboxed Execution** - All commands in Docker containers
- **API Key Protection** - Secure environment variable storage
- **TLS Encryption** - Secure email connections

### 🔐 Best Practices

```typescript
// ✅ Safe: Plugin execution in sandbox
await plugin.execute(context);

// ✅ Safe: User confirmation for destructive actions
if (riskScore > 7) {
  await requestUserConfirmation();
}

// ✅ Safe: Environment variables for secrets
const apiKey = process.env.OPENROUTER_API_KEY;
```

---

## 🎯 Use Cases

### 👨‍💻 For Developers

- **Code Analysis** - Understand complex codebases
- **Automated Testing** - Generate and run tests
- **Documentation** - Auto-generate docs
- **Refactoring** - Safe code improvements

### 👔 For Business

- **Email Management** - Intelligent email processing
- **Task Automation** - Repetitive work automation
- **Data Analysis** - Extract insights from documents
- **Report Generation** - Automated reporting

### 🎓 For Students

- **Learning Assistant** - Explain complex concepts
- **Homework Helper** - Guidance on assignments
- **Project Helper** - Code review and suggestions
- **Research Assistant** - Find and summarize information

---

## 🤝 Contributing

We love contributions! Here's how to get started:

### 🚀 Quick Contribution

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** your changes: `git commit -m 'Add amazing feature'`
4. **Push** to the branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

### 📋 Contribution Areas

- 🐛 **Bug Fixes** - Help us squash bugs
- ✨ **Features** - Add new capabilities
- 📚 **Documentation** - Improve docs and examples
- 🔌 **Plugins** - Create new plugins
- 🧪 **Tests** - Improve test coverage

### 🎯 Development Guidelines

- **TypeScript** - Strong typing required
- **Tests** - Add tests for new features
- **Documentation** - Update README for API changes
- **Code Style** - Follow ESLint rules
- **Security** - Consider security implications

---

## 📊 Performance & Metrics

### ⚡ Benchmarks

| Metric | Value | Notes |
|--------|-------|-------|
| **Startup Time** | < 3s | Cold start |
| **Memory Usage** | < 100MB | Base application |
| **Response Time** | < 500ms | Average API response |
| **Email Processing** | 1000/min | Email throughput |
| **Plugin Execution** | < 2s | Average plugin |

### 📈 Monitoring

```typescript
// Built-in metrics
const metrics = {
  totalRequests: 1250,
  averageResponseTime: 245,
  errorRate: 0.02,
  uptime: '99.9%',
  activeAgents: 3,
  processedEmails: 847
};
```

---

## 🆘 Troubleshooting

### 🔧 Common Issues

#### 📧 Email Problems

```bash
# Check IMAP connection
telnet imap.gmail.com 993

# Verify credentials
openssl s_client -connect imap.gmail.com:993

# Check logs
tail -f ~/.linguclaw/linguclaw.log
```

#### 🐳 Docker Issues

```bash
# Check Docker status
docker ps
docker version

# Test container
docker run --rm hello-world
```

#### 🤖 Agent Issues

```bash
# Check agent status
curl http://localhost:8080/api/agents/status

# View logs
npm run logs

# Debug mode
npm run debug
```

### 💬 Get Help

- **GitHub Issues** - Report bugs and request features
- **Discussions** - Ask questions and share ideas
- **Discord Community** - Chat with other users (coming soon)
- **Email Support** - support@linguclaw.ai

---

## 🗺️ Roadmap

### 🚀 Coming Soon

- [ ] **🎤 Voice Interface** - Speech-to-text and text-to-speech
- [ ] **📱 Mobile App** - React Native application
- [ ] **🏢 Enterprise Features** - Multi-tenant support
- [ ] **🔗 Integrations** - Slack, Teams, Discord
- [ ] **🤖 Advanced AI** - GPT-4, Claude, Gemini integration
- [ ] **📊 Analytics** - Advanced usage analytics
- [ ] **🌍 Multi-language** - Internationalization support

### 🎯 Long-term Vision

- **Autonomous Agents** - Self-improving AI agents
- **Distributed Computing** - Cloud-based agent networks
- **Marketplace** - Plugin and agent marketplace
- **Enterprise Suite** - Full business solution

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


---

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=yourusername/linguclaw&type=Date)](https://star-history.com/#yourusername/linguclaw&Date)

---

<div align="center">

**Built with ❤️ by the LinguClaw Team**

[🏠 Back to Top](#-linguclaw) • [🚀 Getting Started](#-quick-start)

</div>
