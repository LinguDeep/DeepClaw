# LinguClaw Plugin System (TypeScript)

LinguClaw uses an **OpenClaw-compatible plugin architecture** that allows you to extend the system with custom tools, agents, and workflows.

## Plugin Types

### 1. ToolPlugin
Adds custom shell commands and tools that can be called from the agent.

### 2. AgentPlugin  
Modifies agent behavior, prompts, and handles lifecycle events.

### 3. WorkflowPlugin
Hooks into workflow execution to modify parameters and results.

## Quick Start

### Creating a Plugin

1. Create a TypeScript file in `~/.linguclaw/plugins/`:

```typescript
// ~/.linguclaw/plugins/my-plugin.ts
import { ToolPlugin, PluginContext } from 'linguclaw';

class MyPlugin extends ToolPlugin {
  NAME = "my_plugin";
  VERSION = "1.0.0";
  DESCRIPTION = "My custom tool plugin";
  AUTHOR = "Your Name";
  DEPENDENCIES = [];

  async initialize(context: PluginContext): Promise<boolean> {
    this.context = context;
    return true;
  }

  async shutdown(): Promise<void> {
    // Cleanup
  }

  _defineTools(): Record<string, Function> {
    return {
      hello: (name: string) => `Hello, ${name}!`,
      calculate: (a: number, b: number) => a + b
    };
  }
}

export default MyPlugin;
```

2. Use in LinguClaw:

```bash
npm start -- dev "Run my_plugin.hello('World')"
```

## OpenClaw Compatibility

Plugins from OpenClaw systems can be installed by copying TypeScript plugin files to `~/.linguclaw/plugins/`. The plugin system supports the same base classes: `ToolPlugin`, `AgentPlugin`, and `WorkflowPlugin`.

## API Reference

### BasePlugin

All plugins extend `BasePlugin`:

```typescript
abstract class BasePlugin {
  NAME: string;
  VERSION: string;
  DESCRIPTION: string;
  AUTHOR: string;
  DEPENDENCIES: string[];

  abstract initialize(context: PluginContext): Promise<boolean>;
  abstract shutdown(): Promise<void>;
  getInfo(): PluginInfo;
}
```

### ToolPlugin

For adding shell commands:

```typescript
abstract class ToolPlugin extends BasePlugin {
  abstract _defineTools(): Record<string, (...args: any[]) => any>;
  getTools(): Record<string, Function>;
}
```

### AgentPlugin

For modifying agent behavior:

```typescript
abstract class AgentPlugin extends BasePlugin {
  _onInit(): void;
  _onStep(step: any): void;
  _onComplete(result: any): void;
  _modifySystemPromptSafe(basePrompt: string, context: any): string;
}
```

## Error Isolation

Each plugin runs in isolation. If a plugin crashes, it doesn't affect other plugins or core LinguClaw functionality.

