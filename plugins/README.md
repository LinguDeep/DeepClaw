# LinguClaw Example Plugins

Example OpenClaw plugins demonstrating the plugin system.

## Included Plugins

### GitToolPlugin

Adds Git helper tools to LinguClaw:
- `git_status(path)` - Check repository status
- `git_log(path, n)` - Get recent commits
- `git_branch(path)` - Get current branch

### CodeStylePlugin

Agent plugin that modifies prompts to enforce PEP 8 style guidelines.

## Creating Your Own Plugin

1. Create a Python file in the `~/.linguclaw/plugins/` directory
2. Inherit from `BasePlugin`, `ToolPlugin`, `AgentPlugin`, or `MemoryPlugin`
3. Define required metadata: `NAME`, `VERSION`, `DESCRIPTION`, `AUTHOR`
4. Implement `initialize()` and `shutdown()` methods

Example:

```python
from linguclaw.plugins import ToolPlugin, PluginContext

class MyPlugin(ToolPlugin):
    NAME = "my_plugin"
    VERSION = "1.0.0"
    DESCRIPTION = "My custom plugin"
    AUTHOR = "Your Name"
    
    def __init__(self, context: PluginContext):
        super().__init__(context)
    
    async def initialize(self) -> bool:
        return True
    
    async def shutdown(self) -> None:
        pass
    
    def get_tools(self):
        return {"my_tool": self.my_tool}
    
    def my_tool(self, arg: str) -> str:
        return f"Result: {arg}"
```
