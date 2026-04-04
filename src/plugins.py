"""Production-ready OpenClaw Plugin System with full integration."""
import abc
import importlib
import importlib.util
import logging
import os
import sys
import traceback
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Type, Union
from datetime import datetime

logger = logging.getLogger("linguclaw.plugins")


@dataclass
class PluginInfo:
    """Plugin metadata."""
    name: str
    version: str
    description: str
    author: str
    entry_point: str
    dependencies: List[str]
    enabled: bool = True
    loaded: bool = False
    error: Optional[str] = None


class PluginContext:
    """Context passed to plugins with isolated error handling."""
    
    def __init__(self, orchestrator=None, memory=None, tools=None, config=None):
        self.orchestrator = orchestrator
        self.memory = memory
        self.tools = tools
        self.config = config or {}
        self._hooks: Dict[str, List[Callable]] = {}
        self._sandbox: Dict[str, Any] = {}
    
    def register_hook(self, event: str, callback: Callable, plugin_name: str = "unknown"):
        """Register a callback with automatic error wrapping."""
        wrapped = self._wrap_with_error_handling(callback, plugin_name)
        if event not in self._hooks:
            self._hooks[event] = []
        self._hooks[event].append(wrapped)
    
    def _wrap_with_error_handling(self, callback: Callable, plugin_name: str) -> Callable:
        """Wrap callback to catch and log errors without crashing."""
        import functools
        @functools.wraps(callback)
        def wrapper(*args, **kwargs):
            try:
                return callback(*args, **kwargs)
            except Exception as e:
                logger.error(f"Hook error in {plugin_name}: {e}")
                logger.debug(traceback.format_exc())
                return None
        return wrapper
    
    async def emit(self, event: str, *args, **kwargs) -> List[Any]:
        """Emit event to all hooks with isolation."""
        results = []
        if event in self._hooks:
            for callback in self._hooks[event]:
                try:
                    import asyncio
                    if asyncio.iscoroutinefunction(callback):
                        result = await callback(*args, **kwargs)
                    else:
                        result = callback(*args, **kwargs)
                    results.append(result)
                except Exception as e:
                    logger.error(f"Hook execution failed for {event}: {e}")
        return results
    
    def get_storage(self, plugin_name: str) -> Dict:
        """Get plugin-local storage."""
        if plugin_name not in self._sandbox:
            self._sandbox[plugin_name] = {}
        return self._sandbox[plugin_name]


class BasePlugin(abc.ABC):
    """Base class for all OpenClaw plugins."""
    
    # Plugin metadata - override in subclasses
    NAME: str = "base_plugin"
    VERSION: str = "1.0.0"
    DESCRIPTION: str = "Base plugin class"
    AUTHOR: str = "Unknown"
    DEPENDENCIES: List[str] = []
    
    def __init__(self, context: PluginContext):
        self.context = context
        self._enabled = True
        self.logger = logging.getLogger(f"linguclaw.plugins.{self.NAME}")
        self._initialized = False
        self._error: Optional[str] = None
    
    @property
    def info(self) -> PluginInfo:
        return PluginInfo(
            name=self.NAME,
            version=self.VERSION,
            description=self.DESCRIPTION,
            author=self.AUTHOR,
            entry_point=self.__class__.__module__ + ":" + self.__class__.__name__,
            dependencies=self.DEPENDENCIES,
            enabled=self._enabled,
            loaded=self._initialized,
            error=self._error
        )
    
    def safe_execute(self, method: Callable, *args, **kwargs) -> Any:
        """Execute method with error isolation."""
        try:
            return method(*args, **kwargs)
        except Exception as e:
            self._error = str(e)
            self.logger.error(f"Safe execute failed: {e}")
            self.logger.debug(traceback.format_exc())
            return None
    
    @abc.abstractmethod
    async def initialize(self) -> bool:
        """Called when plugin is loaded. Return True if successful."""
        pass
    
    @abc.abstractmethod
    async def shutdown(self) -> None:
        """Called when plugin is unloaded."""
        pass
    
    def enable(self):
        self._enabled = True
        self.logger.info(f"Plugin {self.NAME} enabled")
    
    def disable(self):
        self._enabled = False
        self.logger.info(f"Plugin {self.NAME} disabled")


class ToolPlugin(BasePlugin):
    """Plugin that adds tools - production ready with error isolation."""
    
    def get_tools(self) -> Dict[str, Callable]:
        """Return tools with automatic error wrapping."""
        tools = {}
        try:
            raw_tools = self._define_tools()
            for name, tool in raw_tools.items():
                tools[name] = self._wrap_tool(name, tool)
        except Exception as e:
            self.logger.error(f"Failed to define tools: {e}")
            self._error = str(e)
        return tools
    
    @abc.abstractmethod
    def _define_tools(self) -> Dict[str, Callable]:
        """Override to define tools."""
        pass
    
    def _wrap_tool(self, name: str, tool: Callable) -> Callable:
        """Wrap tool for error isolation."""
        def wrapper(*args, **kwargs):
            try:
                return tool(*args, **kwargs)
            except Exception as e:
                self.logger.error(f"Tool {name} failed: {e}")
                return f"ERROR: {e}"
        return wrapper


class AgentPlugin(BasePlugin):
    """Plugin that modifies agent behavior - production ready with error isolation."""
    
    def modify_prompt(self, base_prompt: str, context: Optional[Dict] = None) -> str:
        """Modify prompt with error isolation."""
        try:
            return self._modify_prompt_safe(base_prompt, context or {})
        except Exception as e:
            self.logger.error(f"Prompt modification failed: {e}")
            return base_prompt
    
    @abc.abstractmethod
    def _modify_prompt_safe(self, base_prompt: str, context: Dict) -> str:
        """Override to modify prompts."""
        pass
    
    def on_step_complete(self, step_result: Any) -> None:
        """Called after step - isolated."""
        try:
            self._on_step(step_result)
        except Exception as e:
            self.logger.error(f"Step callback failed: {e}")
    
    def _on_step(self, step_result: Any) -> None:
        """Override to handle step completion."""
        pass


class MemoryPlugin(BasePlugin):
    """Plugin that extends RAG memory functionality."""
    
    @abc.abstractmethod
    def pre_process_query(self, query: str) -> str:
        """Modify query before searching memory."""
        return query
    
    @abc.abstractmethod
    def post_process_results(self, results: List[Any]) -> List[Any]:
        """Modify search results before returning."""
        return results


class PluginManager:
    """Production-ready plugin manager with full integration."""
    
    def __init__(self, plugins_dir: Optional[str] = None, config_file: Optional[str] = None):
        self.plugins_dir = plugins_dir or self._default_plugins_dir()
        self.config_file = config_file or self._default_config_file()
        self.context = PluginContext()
        
        self._plugins: Dict[str, BasePlugin] = {}
        self._plugin_classes: Dict[str, Type[BasePlugin]] = {}
        self._tool_plugins: Dict[str, ToolPlugin] = {}
        self._agent_plugins: Dict[str, AgentPlugin] = {}
        self._memory_plugins: Dict[str, MemoryPlugin] = {}
        
        self._configs: Dict[str, Dict] = {}
        self._builtin_plugins: List[Type[BasePlugin]] = []
        
        self.logger = logging.getLogger("linguclaw.plugins.manager")
        
        # Ensure directories exist
        self._ensure_directories()
    
    def _default_plugins_dir(self) -> str:
        """Get default plugins directory."""
        home = Path.home()
        return str(home / ".linguclaw" / "plugins")
    
    def _default_config_file(self) -> str:
        """Get default config file."""
        home = Path.home()
        return str(home / ".linguclaw" / "plugins.yaml")
    
    def _ensure_directories(self):
        """Create plugin directories if they don't exist."""
        try:
            Path(self.plugins_dir).mkdir(parents=True, exist_ok=True)
            self.logger.info(f"Plugin directory ready: {self.plugins_dir}")
        except Exception as e:
            self.logger.error(f"Failed to create plugin directory: {e}")
        
        # Create example config if not exists
        if not Path(self.config_file).exists():
            self._create_default_config()
    
    def _create_default_config(self):
        """Create default plugins config file."""
        default_config = {
            "plugins": {},
            "global": {
                "auto_load_builtin": True,
                "isolate_errors": True,
                "max_plugins": 10
            }
        }
        try:
            with open(self.config_file, 'w') as f:
                import yaml
                yaml.dump(default_config, f, default_flow_style=False)
            self.logger.info(f"Created default plugin config: {self.config_file}")
        except Exception as e:
            self.logger.error(f"Failed to create config: {e}")
    
    def load_config(self) -> Dict[str, Dict]:
        """Load plugin configurations."""
        configs = {}
        try:
            if Path(self.config_file).exists():
                with open(self.config_file, 'r') as f:
                    import yaml
                    data = yaml.safe_load(f) or {}
                configs = data.get("plugins", {})
        except Exception as e:
            self.logger.error(f"Failed to load config: {e}")
        return configs
    
    def register_builtin(self, plugin_class: Type[BasePlugin]):
        """Register a built-in plugin class."""
        self._builtin_plugins.append(plugin_class)
        logger.info(f"Registered built-in plugin: {plugin_class.NAME}")
    
    async def load_all(self) -> Dict[str, bool]:
        """Load all plugins from directory and built-ins."""
        results = {}
        
        # Load built-in plugins first
        for plugin_class in self._builtin_plugins:
            success = await self._load_plugin_class(plugin_class)
            results[f"builtin:{plugin_class.NAME}"] = success
        
        # Load external plugins from directory
        if os.path.exists(self.plugins_dir):
            for item in os.listdir(self.plugins_dir):
                if item.endswith(".py") and not item.startswith("_"):
                    plugin_file = os.path.join(self.plugins_dir, item)
                    success = await self._load_from_file(plugin_file)
                    results[f"external:{item}"] = success
        
        return results
    
    async def _load_plugin_class(self, plugin_class: Type[BasePlugin]) -> bool:
        """Load plugin with full isolation."""
        try:
            for dep in plugin_class.DEPENDENCIES:
                if dep not in self._plugins:
                    self.logger.warning(f"{plugin_class.NAME} missing dependency: {dep}")
                    return False
            
            instance = plugin_class(self.context)
            
            # Initialize with timeout
            import asyncio
            try:
                success = await asyncio.wait_for(instance.initialize(), timeout=30.0)
            except asyncio.TimeoutError:
                self.logger.error(f"{plugin_class.NAME} initialization timeout")
                return False
            
            if success:
                instance._initialized = True
                self._plugins[instance.NAME] = instance
                
                # Categorize
                if isinstance(instance, ToolPlugin):
                    self._tool_plugins[instance.NAME] = instance
                if isinstance(instance, AgentPlugin):
                    self._agent_plugins[instance.NAME] = instance
                if isinstance(instance, MemoryPlugin):
                    self._memory_plugins[instance.NAME] = instance
                
                self.logger.info(f"Loaded: {instance.NAME} v{instance.VERSION}")
                return True
            return False
                
        except Exception as e:
            self.logger.error(f"Failed to load {plugin_class.NAME}: {e}")
            logger.debug(traceback.format_exc())
            return False
    
    async def _load_from_file(self, filepath: str) -> bool:
        """Load from file with isolation."""
        try:
            module_name = Path(filepath).stem
            spec = importlib.util.spec_from_file_location(module_name, filepath)
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
            
            import inspect
            found = False
            for name, obj in inspect.getmembers(module, inspect.isclass):
                if (issubclass(obj, BasePlugin) and 
                    obj not in (BasePlugin, ToolPlugin, AgentPlugin, MemoryPlugin) and
                    hasattr(obj, 'NAME')):
                    success = await self._load_plugin_class(obj)
                    if success:
                        found = True
            return found
        except Exception as e:
            self.logger.error(f"Failed to load {filepath}: {e}")
            return False
    
    def get_plugin(self, name: str) -> Optional[BasePlugin]:
        """Get a loaded plugin by name."""
        return self._plugins.get(name)
    
    def list_plugins(self) -> List[PluginInfo]:
        """List all loaded plugins with their info."""
        return [p.info for p in self._plugins.values()]
    
    def get_tools(self) -> Dict[str, Callable]:
        """Collect all tools from ToolPlugin instances."""
        tools = {}
        for plugin in self._plugins.values():
            if isinstance(plugin, ToolPlugin):
                tools.update(plugin.get_tools())
        return tools
    
    # Production integration methods
    def get_all_tools(self) -> Dict[str, Callable]:
        """Get all tools from ToolPlugins with error isolation."""
        tools = {}
        for name, plugin in self._tool_plugins.items():
            if plugin._enabled and plugin._initialized:
                try:
                    plugin_tools = plugin.get_tools()
                    for tool_name, tool_func in plugin_tools.items():
                        full_name = f"{name}.{tool_name}"
                        tools[full_name] = tool_func
                except Exception as e:
                    self.logger.error(f"Failed to get tools from {name}: {e}")
        return tools
    
    def modify_agent_prompt(self, base_prompt: str, context: Optional[Dict] = None) -> str:
        """Apply all AgentPlugin prompt modifications."""
        modified = base_prompt
        for name, plugin in self._agent_plugins.items():
            if plugin._enabled and plugin._initialized:
                try:
                    modified = plugin.modify_prompt(modified, context)
                except Exception as e:
                    self.logger.error(f"Prompt mod from {name} failed: {e}")
        return modified
    
    def on_agent_step(self, step_result: Any):
        """Notify all AgentPlugins of step completion."""
        for name, plugin in self._agent_plugins.items():
            if plugin._enabled and plugin._initialized:
                try:
                    plugin.on_step_complete(step_result)
                except Exception as e:
                    self.logger.error(f"Step callback from {name} failed: {e}")
    
    # Runtime management
    async def unload_plugin(self, name: str) -> bool:
        """Unload a plugin at runtime."""
        if name not in self._plugins:
            return False
        
        try:
            plugin = self._plugins[name]
            await plugin.shutdown()
            del self._plugins[name]
            self._tool_plugins.pop(name, None)
            self._agent_plugins.pop(name, None)
            self._memory_plugins.pop(name, None)
            self.logger.info(f"Unloaded: {name}")
            return True
        except Exception as e:
            self.logger.error(f"Failed to unload {name}: {e}")
            return False
    
    async def reload_plugin(self, name: str) -> bool:
        """Reload a plugin at runtime."""
        await self.unload_plugin(name)
        
        plugin_file = Path(self.plugins_dir) / f"{name}.py"
        if plugin_file.exists():
            return await self._load_from_file(str(plugin_file))
        
        # Try built-in
        for plugin_class in self._builtin_plugins:
            if plugin_class.NAME == name:
                return await self._load_plugin_class(plugin_class)
        
        return False
    
    async def shutdown_all(self):
        """Shutdown all plugins."""
        for name, plugin in self._plugins.items():
            try:
                await plugin.shutdown()
                self.logger.info(f"Shutdown plugin: {name}")
            except Exception as e:
                self.logger.error(f"Error shutting down {name}: {e}")
        self._plugins.clear()


# Import asyncio for type checking
import asyncio
import inspect
