/**
 * Centralized configuration management for LinguClaw
 * Handles settings persistence, CLI and Web UI settings
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getLogger } from './logger';

const logger = getLogger();

// Default config directory
const CONFIG_DIR = path.join(os.homedir(), '.linguclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface LLMSettings {
  provider: 'openrouter' | 'openai' | 'anthropic' | 'ollama' | 'lmstudio';
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  baseUrl?: string; // For local providers like Ollama/LM Studio
}

export interface SystemSettings {
  maxSteps: number;
  useDocker: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  autoIndex: boolean;
  safetyMode: 'strict' | 'balanced' | 'permissive';
}

export interface WebUISettings {
  port: number;
  host: string;
  authEnabled: boolean;
  authToken?: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  notifications: boolean;
}

export interface AppConfig {
  llm: LLMSettings;
  system: SystemSettings;
  webui: WebUISettings;
  user: UserSettings;
  version: string;
}

const DEFAULT_CONFIG: AppConfig = {
  llm: {
    provider: 'openrouter',
    model: 'openai/gpt-3.5-turbo',
    apiKey: '',
    maxTokens: 1000,
    temperature: 0.7,
    baseUrl: '',
  },
  system: {
    maxSteps: 15,
    useDocker: true,
    logLevel: 'info',
    autoIndex: true,
    safetyMode: 'balanced',
  },
  webui: {
    port: 3000,
    host: '127.0.0.1',
    authEnabled: false,
    authToken: '',
  },
  user: {
    theme: 'auto',
    language: 'en',
    notifications: true,
  },
  version: '0.3.0',
};

class ConfigManager {
  private config: AppConfig;
  private loaded: boolean = false;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.ensureConfigDir();
    this.load();
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      logger.info(`Created config directory: ${CONFIG_DIR}`);
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const loaded = JSON.parse(data);
        this.config = this.mergeConfig(DEFAULT_CONFIG, loaded);
        this.loaded = true;
        logger.info('Configuration loaded successfully');
      } else {
        this.save(); // Create default config file
      }
    } catch (error: any) {
      logger.error(`Failed to load config: ${error.message}`);
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  private mergeConfig(defaults: AppConfig, loaded: Partial<AppConfig>): AppConfig {
    return {
      llm: { ...defaults.llm, ...loaded.llm },
      system: { ...defaults.system, ...loaded.system },
      webui: { ...defaults.webui, ...loaded.webui },
      user: { ...defaults.user, ...loaded.user },
      version: loaded.version || defaults.version,
    };
  }

  public save(): void {
    try {
      this.ensureConfigDir();
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
      logger.info('Configuration saved');
    } catch (error: any) {
      logger.error(`Failed to save config: ${error.message}`);
    }
  }

  public get(): AppConfig {
    return { ...this.config };
  }

  public getLLM(): LLMSettings {
    return { ...this.config.llm };
  }

  public getSystem(): SystemSettings {
    return { ...this.config.system };
  }

  public getWebUI(): WebUISettings {
    return { ...this.config.webui };
  }

  public getUser(): UserSettings {
    return { ...this.config.user };
  }

  public updateLLM(settings: Partial<LLMSettings>): void {
    this.config.llm = { ...this.config.llm, ...settings };
    this.save();
  }

  public updateSystem(settings: Partial<SystemSettings>): void {
    this.config.system = { ...this.config.system, ...settings };
    this.save();
  }

  public updateWebUI(settings: Partial<WebUISettings>): void {
    this.config.webui = { ...this.config.webui, ...settings };
    this.save();
  }

  public updateUser(settings: Partial<UserSettings>): void {
    this.config.user = { ...this.config.user, ...settings };
    this.save();
  }

  public update(path: string, value: any): void {
    const parts = path.split('.');
    let current: any = this.config;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) {
        throw new Error(`Invalid config path: ${path}`);
      }
      current = current[parts[i]];
    }
    
    const lastKey = parts[parts.length - 1];
    if (!(lastKey in current)) {
      throw new Error(`Invalid config key: ${lastKey}`);
    }
    
    current[lastKey] = value;
    this.save();
  }

  public getValue(path: string): any {
    const parts = path.split('.');
    let current: any = this.config;
    
    for (const part of parts) {
      if (!(part in current)) {
        return undefined;
      }
      current = current[part];
    }
    
    return current;
  }

  public reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.save();
    logger.info('Configuration reset to defaults');
  }

  public getConfigPath(): string {
    return CONFIG_FILE;
  }

  public export(): string {
    return JSON.stringify(this.config, null, 2);
  }

  public import(json: string): void {
    try {
      const loaded = JSON.parse(json);
      this.config = this.mergeConfig(DEFAULT_CONFIG, loaded);
      this.save();
      logger.info('Configuration imported successfully');
    } catch (error: any) {
      logger.error(`Failed to import config: ${error.message}`);
      throw error;
    }
  }
}

// Singleton instance
let configManager: ConfigManager | null = null;

export function getConfig(): ConfigManager {
  if (!configManager) {
    configManager = new ConfigManager();
  }
  return configManager;
}

export function resetConfig(): void {
  configManager = null;
}

// Environment variable loader - merges env vars with config
export function loadEnvConfig(): void {
  const config = getConfig();
  
  // Override with environment variables if present
  if (process.env.OPENROUTER_API_KEY) {
    config.updateLLM({ 
      provider: 'openrouter', 
      apiKey: process.env.OPENROUTER_API_KEY 
    });
  }
  if (process.env.OPENAI_API_KEY) {
    config.updateLLM({ 
      provider: 'openai', 
      apiKey: process.env.OPENAI_API_KEY 
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    config.updateLLM({ 
      provider: 'anthropic', 
      apiKey: process.env.ANTHROPIC_API_KEY 
    });
  }
  if (process.env.LINGUCLAW_MODEL) {
    config.updateLLM({ model: process.env.LINGUCLAW_MODEL });
  }
  if (process.env.LINGUCLAW_MAX_TOKENS) {
    config.updateLLM({ maxTokens: parseInt(process.env.LINGUCLAW_MAX_TOKENS) });
  }
  if (process.env.LINGUCLAW_MAX_STEPS) {
    config.updateSystem({ maxSteps: parseInt(process.env.LINGUCLAW_MAX_STEPS) });
  }
  if (process.env.LINGUCLAW_LOG_LEVEL) {
    config.updateSystem({ logLevel: process.env.LINGUCLAW_LOG_LEVEL as any });
  }
  if (process.env.LINGUCLAW_WEB_PORT) {
    config.updateWebUI({ port: parseInt(process.env.LINGUCLAW_WEB_PORT) });
  }
}
