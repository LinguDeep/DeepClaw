<h1 align="center">🦾 LinguClaw</h1>

![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**LinguClaw** is an advanced, multi-language code analysis and AI-powered development platform. It provides intelligent code parsing, security analysis, refactoring tools, and multi-agent collaboration for modern software development.

## 🚀 Features

### Multi-Language Support
- **TypeScript/JavaScript** - Full AST parsing, React/Node.js analysis
- **Python** - SQL injection detection, complexity analysis, security scanning
- **Rust** - Ownership tracking, lifetime analysis, unsafe code detection
- **Go** - Goroutine and channel analysis, concurrency patterns
- **Java** - Spring framework analysis, annotation processing
- **C++** - Template analysis, memory management detection
- **C#** - LINQ analysis, async/await patterns, .NET ecosystem support

## 🌟 Star History

<a href="https://www.star-history.com/?repos=LinguDeep%2Flinguclaw&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=LinguDeep/linguclaw&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=LinguDeep/linguclaw&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=LinguDeep/linguclaw&type=date&legend=top-left" />
 </picture>
</a>

### Advanced Analysis
- **AST Parsing** - Complete abstract syntax tree generation
- **Security Scanning** - SQL injection, XSS, hardcoded secrets detection
- **Performance Analysis** - Complexity metrics, bottleneck identification
- **Code Quality** - Best practices, anti-pattern detection
- **Dependency Analysis** - Cross-file references, call graph generation

### AI-Powered Development
- **Multi-Agent System** - Specialized agents for different tasks:
  - Architect - System design and patterns
  - Coder - Code implementation
  - Reviewer - Code review and quality
  - Tester - Test generation
  - Debugger - Troubleshooting
  - Security - Vulnerability scanning
- **Workflow Orchestration** - Chain agents for complex tasks
- **Semantic Memory** - TF-IDF based code search with SQLite

### Git Integration
- **Blame Analysis** - Line-by-line author tracking
- **Diff Viewer** - Hunk-based comparison
- **Branch Management** - Create, merge, rebase operations
- **Commit History** - Detailed statistics and churn analysis
- **Stash Operations** - Save and restore work-in-progress

### Refactoring Engine
- 15+ automated refactoring operations
- Unused import cleanup
- Template literal conversion
- Optional chaining transformation
- Method extraction
- Batch refactoring support

### Real-Time Collaboration
- WebSocket-based sync
- Multi-cursor support
- Virtual scrolling editor
- Syntax highlighting

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/linguclaw.git
cd linguclaw

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your API keys
# Required: OPENROUTER_API_KEY or OPENAI_API_KEY

# Build the project
npm run build

# Start the development server
npm run dev
```

## 🎯 Quick Start

### CLI Mode
```bash
# Analyze a file
node dist/cli.js analyze src/example.ts

# Start interactive mode
node dist/cli.js interactive

# Run tests
npm test
```

### Web UI Mode
```bash
# Start web server
node dist/index.js --web

# Or with custom port
node dist/index.js --web --port 8080
```

Then open http://localhost:3000 in your browser.

## 🛠️ Configuration

Create a `.env` file in the project root:

```env
# LLM Provider (required)
OPENROUTER_API_KEY=sk-or-your-key-here
# Or
OPENAI_API_KEY=sk-your-key-here

# Optional: Messaging Integrations
TELEGRAM_BOT_TOKEN=your-bot-token
DISCORD_BOT_TOKEN=your-bot-token
SLACK_BOT_TOKEN=xoxb-your-token

# Optional: Email (SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USERNAME=you@gmail.com
EMAIL_PASSWORD=your-app-password
```

## 📚 Usage Examples

### Code Analysis
```typescript
import { LinguClawEngine } from './src/core/engine';
import { PythonLanguageSupport } from './src/languages/python';

const engine = new LinguClawEngine({ storage: {} });
await engine.registerLanguage(PythonLanguageSupport);

const analysis = await engine.analyzeFile(
  'example.py',
  fs.readFileSync('example.py', 'utf-8')
);

console.log(analysis.suggestions);
console.log(analysis.securityIssues);
```

### Git Operations
```typescript
import { GitIntegration } from './src/git-integration';

const git = new GitIntegration('./my-project');

// Get blame information
const blame = git.blame('src/index.ts');

// View diff
const diff = git.diff({ file: 'src/index.ts', staged: true });

// Get commit history
const history = git.getLog({ maxCount: 10, file: 'src/index.ts' });
```
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
import { GitIntegration } from './src/git-integration';

const git = new GitIntegration('./my-project');

// Get blame information
const blame = git.blame('src/index.ts');

// View diff
const diff = git.diff({ file: 'src/index.ts', staged: true });

// Get commit history
const history = git.getLog({ maxCount: 10, file: 'src/index.ts' });
```

### AI Agent Workflow
```typescript
import { AgentOrchestrator } from './src/agent-system';

const orchestrator = new AgentOrchestrator(
  './project',
  './memory.db'
);

await orchestrator.initialize();

// Create specialized agents
const architect = orchestrator.createAgent('architect', llmProvider);
orchestrator.registerAgent(architect);

// Submit task
const taskId = await orchestrator.submitTask({
  type: 'design',
  priority: 'high',
  description: 'Design authentication system',
  context: { requirements: ['JWT', 'OAuth2', 'RBAC'] },
  estimatedTime: 30,
});
```

### Refactoring
```typescript
import { RefactoringEngine } from './src/refactoring-engine';

const engine = new RefactoringEngine();

// Analyze for refactoring opportunities
const suggestions = engine.analyzeForRefactoring(
  ast,
  'typescript',
  sourceCode
);

// Apply refactoring
const result = await engine.applyRefactoring(
  'src/index.ts',
  'convert-to-template-literals',
  ast,
  false // dryRun = false
);
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- web.test.ts
```

## 📁 Project Structure

```
linguclaw/
├── src/
│   ├── core/           # Core engine and architecture
│   ├── languages/      # Language parsers (Python, Rust, Go, etc.)
│   ├── plugins/        # Plugin system and examples
│   ├── git-integration.ts
│   ├── agent-system.ts
│   ├── refactoring-engine.ts
│   └── ...
├── tests/              # Test suites
├── plugins/            # Built-in plugins
├── public/             # Web UI assets
└── package.json
```

## 🔒 Security

LinguClaw includes built-in security scanning for:
- SQL injection vulnerabilities
- Command injection
- Hardcoded credentials
- Path traversal
- Insecure deserialization
- Weak cryptography
- XSS vulnerabilities

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

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with TypeScript and Node.js
- Uses SQLite for semantic memory
- Integrates with OpenRouter, OpenAI, and Anthropic APIs
- Inspired by modern IDE features and code analysis tools

## 📞 Support

- GitHub Issues: [Report a bug or request a feature](https://github.com/yourusername/linguclaw/issues)
- Documentation: [Full API docs](https://github.com/yourusername/linguclaw/wiki)

---

<div align="center">

**Built with ❤️ by the LinguClaw Team**

[🏠 Back to Top](#-linguclaw) • [🚀 Getting Started](#-quick-start)

</div>
