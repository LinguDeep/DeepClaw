"""Example OpenClaw plugin - demonstrates plugin development."""
from typing import Dict, Callable, Any, List

from linguclaw.plugins import ToolPlugin, AgentPlugin, PluginContext


class GitToolPlugin(ToolPlugin):
    """Example plugin that adds Git helper tools."""
    
    NAME = "git_tools"
    VERSION = "1.0.0"
    DESCRIPTION = "Git helper tools for LinguClaw"
    AUTHOR = "LinguClaw Team"
    DEPENDENCIES = []
    
    def __init__(self, context: PluginContext):
        super().__init__(context)
        self.git_available = False
    
    async def initialize(self) -> bool:
        """Check if git is available."""
        import shutil
        self.git_available = shutil.which("git") is not None
        if self.git_available:
            self.logger.info("Git tools initialized")
        else:
            self.logger.warning("Git not found in PATH")
        return True
    
    async def shutdown(self) -> None:
        """Cleanup resources."""
        self.logger.info("Git tools shutdown")
    
    def _define_tools(self) -> Dict[str, Callable]:
        """Return git tool functions."""
        return {
            "git_status": self.git_status,
            "git_log": self.git_log,
            "git_branch": self.git_branch,
        }
    
    def git_status(self, path: str = ".") -> str:
        """Get git status for a repository."""
        if not self.git_available:
            return "Git not available"
        
        import subprocess
        try:
            result = subprocess.run(
                ["git", "-C", path, "status", "--short"],
                capture_output=True,
                text=True,
                timeout=10
            )
            return result.stdout or "Working tree clean"
        except Exception as e:
            return f"Error: {e}"
    
    def git_log(self, path: str = ".", n: int = 5) -> str:
        """Get recent git commits."""
        if not self.git_available:
            return "Git not available"
        
        import subprocess
        try:
            result = subprocess.run(
                ["git", "-C", path, "log", f"-{n}", "--oneline"],
                capture_output=True,
                text=True,
                timeout=10
            )
            return result.stdout
        except Exception as e:
            return f"Error: {e}"
    
    def git_branch(self, path: str = ".") -> str:
        """Get current git branch."""
        if not self.git_available:
            return "Git not available"
        
        import subprocess
        try:
            result = subprocess.run(
                ["git", "-C", path, "branch", "--show-current"],
                capture_output=True,
                text=True,
                timeout=10
            )
            return result.stdout.strip()
        except Exception as e:
            return f"Error: {e}"


class CodeStylePlugin(AgentPlugin):
    """Example plugin that enforces code style guidelines."""
    
    NAME = "code_style"
    VERSION = "1.0.0"
    DESCRIPTION = "Enforces Python code style guidelines (PEP 8)"
    AUTHOR = "LinguClaw Team"
    DEPENDENCIES = []
    
    STYLE_GUIDELINES = """
    Code Style Guidelines:
    - Follow PEP 8 for Python code
    - Use 4 spaces for indentation
    - Maximum line length: 100 characters
    - Use snake_case for functions and variables
    - Use PascalCase for classes
    - Add docstrings for all public functions
    - Type hints are encouraged
    """
    
    async def initialize(self) -> bool:
        """Initialize the plugin."""
        self.logger.info("Code style plugin initialized")
        return True
    
    async def shutdown(self) -> None:
        """Cleanup resources."""
        pass
    
    def _modify_prompt_safe(self, base_prompt: str, context: Dict) -> str:
        """Append style guidelines to system prompt."""
        return base_prompt + "\n\n" + self.STYLE_GUIDELINES
    
    def _on_step(self, step_result: Any) -> None:
        """Called after each agent step."""
        # Could analyze generated code here
        self.logger.debug("Step completed, result type: %s", type(step_result))


# Plugin export
PLUGINS = [GitToolPlugin, CodeStylePlugin]
