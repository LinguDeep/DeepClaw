# 🤖 LinguClaw

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI">
</p>

<p align="center">
  <a href="https://github.com/LinguDeep/linguclaw/actions"><img src="https://github.com/LinguDeep/linguclaw/workflows/CI%2FCD%20Pipeline/badge.svg" alt="CI/CD"></a>
  <a href="https://codecov.io/gh/LinguDeep/linguclaw"><img src="https://codecov.io/gh/LinguDeep/linguclaw/branch/main/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/linguclaw"><img src="https://img.shields.io/npm/v/linguclaw.svg" alt="NPM Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

**LinguClaw** is an advanced AI-powered code analysis and development platform that combines static analysis, multi-agent AI systems, and semantic memory to provide intelligent code assistance across multiple programming languages.

## ✨ Features

### 🌐 Multi-Language Support
- **TypeScript/JavaScript** - Full support with modern features
- **Python** - Advanced analysis with security focus
- **Rust** - Ownership, lifetime, and memory safety analysis
- **Go** - Goroutine, channel, and concurrency patterns
- **Java** - Enterprise patterns, Spring annotations, security
- **C++** - Template analysis, memory management, performance
- **C#** - LINQ, async/await, .NET patterns, nullable types

### 🤖 AI Agent System
- **Architect Agent** - System design and architecture planning
- **Coder Agent** - Intelligent code implementation
- **Reviewer Agent** - Automated code review with quality checks
- **Tester Agent** - Test generation and coverage analysis
- **Security Agent** - Security vulnerability detection
- **Optimizer Agent** - Performance optimization suggestions
- **Coordinator Agent** - Multi-agent orchestration

### 🔍 Advanced Analysis
- **Static Analysis** - AST-based code parsing and analysis
- **Security Scanning** - Detect SQL injection, XSS, hardcoded secrets
- **Performance Analysis** - Identify bottlenecks and optimization opportunities
- **Code Metrics** - Cyclomatic complexity, Halstead metrics, maintainability index
- **Semantic Search** - TF-IDF based code search with SQLite backend

### 🛠️ Refactoring Engine
- 15+ automated refactoring operations
- Dead code elimination
- Modern syntax conversion (async/await, optional chaining, template literals)
- LINQ/Stream optimization
- Batch refactoring support

### 📊 Git Integration
- Blame analysis with author statistics
- Diff viewing with syntax highlighting
- Branch management and merge assistance
- Commit history and code churn analysis
- Worktree support

### 💾 Persistent Memory
- **Semantic Memory** - TF-IDF based semantic search
- **Conversation History** - Chat context preservation
- **Task Scheduling** - Cron, interval, and one-time jobs
- **Plugin System** - Extensible architecture

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/linguclaw.git
cd linguclaw

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Configuration

Create a `.env` file:

```env
# LLM Provider (OpenAI or Ollama)
LLM_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4

# For local LLM
# LLM_PROVIDER=ollama
# OLLAMA_URL=http://localhost:11434

# Semantic Memory
MEMORY_PATH=./data/memory.db
```

### Usage

#### CLI Mode

```bash
# Analyze a file
npx linguclaw analyze src/example.ts

# Chat with AI about your code
npx linguclaw chat

# Run orchestrator for complex tasks
npx linguclaw run "Refactor authentication module"
```

#### Web Interface

```bash
npm run web
# Open http://localhost:3000
```

#### Programmatic API

```typescript
import { LinguClawEngine, AgentOrchestrator } from 'linguclaw';

// Initialize engine
const engine = new LinguClawEngine();
await engine.initialize();

// Analyze a file
const result = await engine.analyzeFile('src/example.ts');
console.log(result.metrics);
console.log(result.securityIssues);

// Use AI agents
const orchestrator = new AgentOrchestrator('./project', './memory.db');
await orchestrator.initialize();

const taskId = await orchestrator.submitTask({
  type: 'implement',
  priority: 'high',
  description: 'Add user authentication',
  context: { feature: 'AuthModule' }
});
```

## 📁 Project Structure

```
linguclaw/
├── src/
│   ├── core/
│   │   └── engine.ts          # Core engine interfaces
│   ├── languages/
│   │   ├── typescript.ts    # TS/JS parser & analyzer
│   │   ├── python.ts        # Python support
│   │   ├── rust.ts          # Rust support
│   │   ├── golang.ts        # Go support
│   │   ├── java.ts          # Java support
│   │   ├── cpp.ts           # C++ support
│   │   └── csharp.ts        # C# support
│   ├── agent-system.ts      # Multi-agent AI system
│   ├── git-integration.ts   # Git operations
│   ├── refactoring-engine.ts # Code refactoring
│   ├── semantic-memory.ts   # Vector memory storage
│   ├── scheduler.ts         # Task scheduling
│   ├── web-ui.ts           # Web interface
│   └── index.ts            # Main exports
├── tests/
│   └── *.test.ts           # Test suites
├── plugins/
│   └── *.js              # Plugin examples
├── .github/
│   └── workflows/         # CI/CD pipelines
├── docs/                  # Documentation
└── README.md             # This file
```

## 🔧 Advanced Configuration

### Custom Plugins

Create custom plugins in the `plugins/` directory:

```javascript
// plugins/my-plugin.js
module.exports = {
  name: 'MyPlugin',
  version: '1.0.0',
  
  async initialize(context) {
    // Setup code
  },
  
  async execute(action, params) {
    // Plugin logic
  }
};
```

### Language Registration

Add support for new languages:

```typescript
import { LinguClawEngine } from './core/engine';

engine.registerLanguage({
  id: 'mylang',
  name: 'MyLanguage',
  extensions: ['.mylang'],
  parser: new MyLanguageParser(),
  analyzer: new MyLanguageAnalyzer()
});
```

## 📈 GitHub Actions Workflows

| Workflow | Description | Trigger |
|----------|-------------|---------|
| `ci-cd.yml` | Build, test, lint, security scan | Push, PR |
| `docs.yml` | Generate & deploy API docs | Push to main |
| `automation.yml` | Issue/PR labeling, stale management | Issues, PRs |

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- tests/engine.test.ts

# Run in watch mode
npm test -- --watch
```

## 📚 Documentation

- [API Documentation](https://yourusername.github.io/linguclaw/)
- [Contributing Guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Architecture Decision Records](docs/adr/)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- OpenAI for GPT API
- SQLite team for the amazing database
- TypeScript team for the language
- All contributors and users

---

<p align="center">
  Made with ❤️ by the LinguClaw Team
</p>

<p align="center">
  <a href="https://github.com/yourusername/linguclaw">⭐ Star us on GitHub</a> |
  <a href="https://twitter.com/linguclaw">🐦 Twitter</a> |
  <a href="https://discord.gg/linguclaw">💬 Discord</a>
</p>
