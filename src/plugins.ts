/**
 * Plugin System - OpenClaw Architecture
 * TypeScript equivalent of Python plugins.py
 */

import { getLogger } from './logger';
import { PluginInfo, PluginConfig, PluginContext, Logger } from './types';
import path from 'path';

const logger = getLogger();

// Plugin base class
export abstract class BasePlugin {
  NAME: string;
  VERSION: string;
  DESCRIPTION: string;
  AUTHOR: string;
  DEPENDENCIES: string[];

  protected context!: PluginContext;
  protected initialized: boolean;

  constructor() {
    this.NAME = 'base_plugin';
    this.VERSION = '1.0.0';
    this.DESCRIPTION = 'Base plugin class';
    this.AUTHOR = 'Unknown';
    this.DEPENDENCIES = [];
    this.initialized = false;
  }

  async initialize(context: PluginContext): Promise<boolean> {
    this.context = context;
    
    // Check dependencies
    for (const dep of this.DEPENDENCIES) {
      if (!this.context.config.settings.allowed_plugins?.includes(dep)) {
        logger.warn(`${this.NAME} requires plugin: ${dep}`);
      }
    }

    this.initialized = true;
    logger.info(`Plugin ${this.NAME} v${this.VERSION} initialized`);
    return true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    logger.info(`Plugin ${this.NAME} shutdown`);
  }

  getInfo(): PluginInfo {
    return {
      name: this.NAME,
      version: this.VERSION,
      description: this.DESCRIPTION,
      author: this.AUTHOR,
      dependencies: this.DEPENDENCIES
    };
  }
}

// Tool plugin - adds shell commands
export abstract class ToolPlugin extends BasePlugin {
  abstract _defineTools(): Record<string, (...args: any[]) => any>;

  getTools(): Record<string, (...args: any[]) => any> {
    if (!this.initialized) {
      logger.warn(`Plugin ${this.NAME} not initialized`);
      return {};
    }
    return this._defineTools();
  }
}

// Agent plugin - modifies agent behavior
export abstract class AgentPlugin extends BasePlugin {
  _onInit(): void {}
  _onStep(step: any): void {}
  _onComplete(result: any): void {}

  _modifySystemPromptSafe(basePrompt: string, context: any): string {
    return basePrompt;
  }
}

// Workflow plugin - modifies workflow execution
export abstract class WorkflowPlugin extends BasePlugin {
  _beforeWorkflow(workflowId: string, params: any): any {
    return params;
  }

  _afterWorkflow(workflowId: string, result: any): any {
    return result;
  }

  _onError(workflowId: string, error: Error): void {
    logger.error(`Workflow ${workflowId} error: ${error.message}`);
  }
}

// Plugin manager
export class PluginManager {
  plugins: Map<string, BasePlugin>;
  toolPlugins: Map<string, ToolPlugin>;
  agentPlugins: Map<string, AgentPlugin>;
  workflowPlugins: Map<string, WorkflowPlugin>;
  private pluginDir: string;

  constructor(pluginDir: string = '~/.linguclaw/plugins') {
    this.plugins = new Map();
    this.toolPlugins = new Map();
    this.agentPlugins = new Map();
    this.workflowPlugins = new Map();
    this.pluginDir = pluginDir.replace('~', process.env.HOME || '~');
  }

  async discoverPlugins(): Promise<string[]> {
    const path = require('path');
    const fs = require('fs');
    const discovered: string[] = [];

    try {
      if (!fs.existsSync(this.pluginDir)) {
        fs.mkdirSync(this.pluginDir, { recursive: true });
        return discovered;
      }

      const files = fs.readdirSync(this.pluginDir);
      for (const file of files) {
        if (file.endsWith('.js') || file.endsWith('.ts')) {
          discovered.push(path.join(this.pluginDir, file));
        }
      }
    } catch (error) {
      logger.error(`Failed to discover plugins: ${error}`);
    }

    return discovered;
  }

  async loadPlugin(pluginPath: string, context: PluginContext): Promise<boolean> {
    try {
      // Validate plugin path is within plugin directory
      const resolvedPath = path.resolve(pluginPath);
      const resolvedPluginDir = path.resolve(this.pluginDir);
      if (!resolvedPath.startsWith(resolvedPluginDir)) {
        logger.error(`Plugin path ${pluginPath} is outside plugin directory ${this.pluginDir}`);
        return false;
      }

      const pluginModule = require(resolvedPath);
      const PluginClass = pluginModule.default || Object.values(pluginModule)[0];

      if (!PluginClass || typeof PluginClass !== 'function') {
        logger.error(`No plugin class found in ${pluginPath}`);
        return false;
      }

      const plugin = new PluginClass();

      if (plugin instanceof ToolPlugin) {
        this.toolPlugins.set(plugin.NAME, plugin);
      } else if (plugin instanceof AgentPlugin) {
        this.agentPlugins.set(plugin.NAME, plugin);
      } else if (plugin instanceof WorkflowPlugin) {
        this.workflowPlugins.set(plugin.NAME, plugin);
      }

      this.plugins.set(plugin.NAME, plugin);
      await plugin.initialize(context);

      logger.info(`Loaded plugin: ${plugin.NAME} v${plugin.VERSION}`);
      return true;
    } catch (error) {
      logger.error(`Failed to load plugin ${pluginPath}: ${error}`);
      return false;
    }
  }

  async loadAllPlugins(context: PluginContext): Promise<number> {
    const pluginPaths = await this.discoverPlugins();
    let loaded = 0;

    for (const path of pluginPaths) {
      if (await this.loadPlugin(path, context)) {
        loaded++;
      }
    }

    logger.info(`Loaded ${loaded}/${pluginPaths.length} plugins`);
    return loaded;
  }

  getPlugin(name: string): BasePlugin | undefined {
    return this.plugins.get(name);
  }

  getToolPlugins(): Map<string, ToolPlugin> {
    return this.toolPlugins;
  }

  getAgentPlugins(): Map<string, AgentPlugin> {
    return this.agentPlugins;
  }

  getWorkflowPlugins(): Map<string, WorkflowPlugin> {
    return this.workflowPlugins;
  }

  getAllTools(): Record<string, (...args: any[]) => any> {
    const tools: Record<string, (...args: any[]) => any> = {};
    for (const [name, plugin] of this.toolPlugins) {
      const pluginTools = plugin.getTools();
      for (const [toolName, toolFn] of Object.entries(pluginTools)) {
        tools[`${name}.${toolName}`] = toolFn;
      }
    }
    return tools;
  }

  async shutdown(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.shutdown();
    }
    this.plugins.clear();
    this.toolPlugins.clear();
    this.agentPlugins.clear();
    this.workflowPlugins.clear();
  }
}

// Global instance
let pluginManagerInstance: PluginManager | null = null;

export function getPluginManager(pluginDir?: string): PluginManager {
  if (!pluginManagerInstance) {
    pluginManagerInstance = new PluginManager(pluginDir);
  }
  return pluginManagerInstance;
}
