<div align="center">

# 🦾 LinguClaw

<img width="2038" height="512" alt="LinguClaw Banner" src="https://github.com/user-attachments/assets/ca6404ef-fa21-4b79-ae99-108f6463a33c" />

### ⚡ Codebase-Aware Multi-Agent AI Platform

<p>
  <b>Analyze · Orchestrate · Automate · Optimize</b>
</p>

<p>
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript&logoColor=white"/>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-green?logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg"/>
</p>

<p>
  <a href="#-features">Features</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-documentation">Docs</a>
</p>

---

### 🚀 What is LinguClaw?

**LinguClaw** is an advanced AI engineering system that combines:

✨ Multi-agent intelligence
🧠 Deep static code analysis
🔄 Visual workflow automation
📡 Real-time integrations
🖥️ Professional developer dashboard

All in one unified platform.

---

## ✨ Features

### 🤖 Multi-Agent Intelligence

Seven specialized agents collaborate autonomously:

* **Architect** → System design
* **Coder** → Code generation
* **Reviewer** → Code quality analysis
* **Tester** → Test creation & coverage
* **Security** → Vulnerability detection
* **Optimizer** → Performance tuning
* **Coordinator** → Task orchestration

> Supports: OpenAI · Anthropic · OpenRouter · Ollama · LM Studio

---

### 🔍 Multi-Language Code Analysis

Supports **7 languages** with deep AST parsing:

`TypeScript` · `Python` · `Rust` · `Go` · `Java` · `C++` · `C#`

✔ Security detection (SQLi, XSS, secrets)
✔ Complexity metrics (Cyclomatic, Halstead)
✔ Maintainability scoring
✔ Pattern & anti-pattern recognition

---

### 🔄 Visual Workflow Engine

n8n-style drag & drop system:

* 22 built-in nodes
* Trigger → Logic → Action → Output pipeline
* Real-time execution feedback
* Topological execution engine

---

### 💬 Messaging Integrations

* Telegram
* Discord
* Slack
* WhatsApp (Twilio)
* Email (IMAP/SMTP)

📥 Unified inbox across all platforms

---

### 🖥️ Web Dashboard

Modern SPA with:

* AI Chat (streaming)
* Task pipeline (Planner → Executor → Reviewer)
* Workflow builder
* Memory system
* Scheduler
* Web automation tools

---

### ⚙️ Advanced Capabilities

* 🔧 Refactoring Engine (15+ ops)
* 🌿 Git Intelligence (diff, blame, churn)
* 🧠 Semantic Memory (TF-IDF + SQLite)
* 🐳 Sandbox Execution (Docker)
* 🔌 Plugin System
* ⏱️ Scheduler (cron, interval)
* 🔁 Resilience (retry, circuit breaker)

---

## 🚀 Getting Started

### Requirements

* Node.js ≥ 20
* npm ≥ 10

### Install

```bash
git clone https://github.com/LinguDeep/LinguClaw.git
cd LinguClaw
npm install
npm run build
```

### Configure

```env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4o
```

### Run

```bash
npm start
```

🌐 Open: http://localhost:3000

---

## 🧠 CLI Usage

```bash
npx linguclaw agent
npx linguclaw index ./project
npx linguclaw daemon start
npx linguclaw status
```

---

## 🏗 Architecture

```
Agents → Orchestrator → Workflow Engine → Execution Layer
        ↓
   Memory + Git + Messaging + Plugins
```

---

## 🧪 Testing

```bash
npm test
npm test -- --coverage
```

---

## 🔌 Plugin Example

```js
module.exports = {
  name: 'ExamplePlugin',
  async execute(action, params) {
    return { result: 'ok' };
  }
};
```

---

## 🤝 Contributing

1. Fork
2. Branch
3. Commit
4. PR 🚀

---

## 📄 License

MIT License

---

<div align="center">

### ⭐ If you like this project, give it a star!

</div>

</div>
