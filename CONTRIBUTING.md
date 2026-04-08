# Contributing to LinguClaw

First off, thank you for considering contributing to LinguClaw! It's people like you that make LinguClaw such a great tool.

## 🎯 Where to Start

### Good First Issues
Look for issues labeled:
- `good first issue` - Perfect for newcomers
- `help wanted` - We need community help
- `documentation` - Documentation improvements

### Areas of Contribution
- 🌐 **New Language Support** - Add parsers for additional languages
- 🤖 **AI Agents** - Improve agent capabilities or add new agent types
- 🔍 **Analysis** - Enhance static analysis capabilities
- 🛠️ **Refactoring** - Add new refactoring operations
- 📚 **Documentation** - Improve docs and examples
- 🐛 **Bug Fixes** - Fix reported issues
- ⚡ **Performance** - Optimize existing code

## 🚀 Development Setup

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Git

### Setup Steps

```bash
# 1. Fork and clone
git clone https://github.com/yourusername/linguclaw.git
cd linguclaw

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Run tests
npm test

# 5. Start development server (optional)
npm run dev
```

## 📋 Coding Standards

### TypeScript Guidelines
- Use strict TypeScript (`strict: true` in tsconfig)
- Prefer `interface` over `type` for object shapes
- Use explicit return types on public APIs
- Document all public methods with JSDoc

### Code Style
```bash
# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Format code
npm run format
```

### Naming Conventions
- **Files**: `kebab-case.ts`
- **Classes**: `PascalCase`
- **Interfaces**: `PascalCase` (prefix with `I` when ambiguous)
- **Functions/Variables**: `camelCase`
- **Constants**: `SCREAMING_SNAKE_CASE`
- **Private members**: `_camelCase` or `#camelCase`

## 🧪 Testing

### Test Structure
```
tests/
├── unit/           # Unit tests
├── integration/    # Integration tests
└── e2e/           # End-to-end tests
```

### Writing Tests
```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { MyClass } from '../src/my-class';

describe('MyClass', () => {
  let instance: MyClass;
  
  beforeEach(() => {
    instance = new MyClass();
  });
  
  it('should do something', () => {
    const result = instance.doSomething();
    expect(result).toBe(true);
  });
});
```

### Running Tests
```bash
# All tests
npm test

# With coverage
npm test -- --coverage

# Specific file
npm test -- tests/engine.test.ts

# Watch mode
npm test -- --watch

# Debug mode
npm test -- --debug
```

## 📝 Commit Guidelines

### Commit Message Format
```
type(scope): subject

body (optional)

footer (optional)
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, semicolons, etc)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding or correcting tests
- `chore`: Build process or auxiliary tool changes

### Examples
```
feat(parser): add Swift language support

Implement parser and analyzer for Swift language
including async/await pattern detection.

fix(security): resolve SQL injection vulnerability

Properly parameterize queries in Python analyzer.

docs(readme): update installation instructions

docs(api): add examples for AgentOrchestrator
```

## 🔄 Pull Request Process

1. **Before Submitting**
   - Ensure all tests pass
   - Update documentation if needed
   - Add tests for new functionality
   - Run linting and fix any issues

2. **PR Description**
   - Clear title following commit conventions
   - Description of changes
   - Related issue numbers (e.g., "Fixes #123")
   - Screenshots/GIFs for UI changes

3. **Review Process**
   - Maintainers will review within 48 hours
   - Address review comments promptly
   - Keep discussion focused and respectful

4. **After Merge**
   - Delete your feature branch
   - Update your local main branch

## 🌐 Adding Language Support

To add a new language:

1. Create files in `src/languages/`:
   - `{language}.ts` - Parser and analyzer

2. Implement required interfaces:
   ```typescript
   export class MyLanguageParser {
     parse(source: string, filePath: string): ParseResult { }
   }
   
   export class MyLanguageAnalyzer {
     analyze(ast: ASTNode, context: any): AnalysisResult { }
   }
   ```

3. Register in engine:
   ```typescript
   engine.registerLanguage({
     id: 'mylang',
     name: 'MyLanguage',
     extensions: ['.ext'],
     parser: new MyLanguageParser(),
     analyzer: new MyLanguageAnalyzer()
   });
   ```

4. Add tests in `tests/languages/{language}.test.ts`

## 🤖 Adding AI Agents

To create a new agent:

```typescript
export class MyAgent implements Agent {
  id = 'my-agent-' + Date.now().toString(36);
  name = 'My Specialized Agent';
  type: AgentType = 'specialist';
  
  async execute(task: Task): Promise<TaskResult> {
    // Implementation
  }
  
  async collaborate(message: AgentMessage): Promise<void> {
    // Handle messages from other agents
  }
}
```

## 🐛 Reporting Bugs

When filing an issue, please include:

- **Title**: Clear, descriptive title
- **Environment**: Node.js version, OS, LinguClaw version
- **Steps to Reproduce**: Minimal steps to reproduce
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Code Sample**: Minimal reproducible example
- **Logs**: Relevant error messages

### Example Bug Report
```markdown
**Bug**: Parser crashes on empty files

**Environment**:
- Node.js: 20.5.0
- OS: macOS 14.0
- LinguClaw: 1.2.3

**Steps**:
1. Create empty file `test.ts`
2. Run `npx linguclaw analyze test.ts`

**Expected**: Graceful handling with warning

**Actual**: `TypeError: Cannot read property 'children' of undefined`

**Stack Trace**:
```
TypeError: Cannot read property 'children' of undefined
    at TypeScriptParser.parse (...)
```
```

## 📜 Code of Conduct

This project adheres to a code of conduct:

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Respect differing viewpoints
- Gracefully accept constructive criticism

## 🎉 Recognition

Contributors will be:
- Listed in README.md
- Mentioned in release notes
- Added to CONTRIBUTORS.md

## 📞 Getting Help

- 💬 [Discord](https://discord.gg/linguclaw)
- 🐦 [Twitter](https://twitter.com/linguclaw)
- 📧 [Email](mailto:support@linguclaw.com)

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to LinguClaw! 🚀
