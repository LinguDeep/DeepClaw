#!/usr/bin/env node
/**
 * CLI entry point using Commander
 * TypeScript equivalent of Python cli.py
 */

import { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { BaseProvider, ProviderManager, ProviderType, createProvider } from './multi-provider';
import { ShellTool, FileSystemTool } from './tools';
import { SafetyMiddleware } from './safety';
import { RAGMemory } from './memory';
import { Orchestrator } from './orchestrator';
import { getLogger } from './logger';
import { getConfig, loadEnvConfig } from './config';
import { SkillManager } from './skills';
import { getPrivacyManager } from './privacy';
import { startDaemon, stopDaemon, daemonStatus, restartDaemon } from './daemon';
import { Message } from './types';

// Load environment variables
dotenv.config();

const logger = getLogger();
const program = new Command();

program
  .name('linguclaw')
  .description('LinguClaw — Codebase-Aware Multi-Agent System')
  .version('0.3.0');

// Dev command
program
  .command('dev')
  .description('Start LinguClaw in development mode')
  .option('-p, --path <path>', 'Project root path', '.')
  .option('-m, --model <model>', 'LLM model', 'anthropic/claude-3.5-sonnet')
  .option('-b, --max-budget <budget>', 'Maximum token budget', '128000')
  .option('-s, --max-steps <steps>', 'Maximum execution steps', '15')
  .option('--no-docker', 'Disable Docker sandbox')
  .option('--force-fallback', 'Force strict safety mode')
  .option('--no-tui', 'Disable TUI dashboard')
  .option('-l, --log-dir <dir>', 'Log directory', 'logs')
  .argument('[task]', 'Task description')
  .action(async (task, options) => {
    console.log(chalk.bold.cyan('🦀 LinguClaw') + chalk.dim(' — Multi-Agent Codebase Assistant\n'));

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.log(chalk.bold.red('Error:') + ' OPENROUTER_API_KEY environment variable not set');
      process.exit(1);
    }

    if (!task) {
      console.log(chalk.yellow('No task provided. Exiting.'));
      process.exit(0);
    }

    try {
      // Initialize components
      const provider = new (await import('./multi-provider')).OpenRouterProvider(apiKey, options.model);
      const useDocker = !options.noDocker && !options.forceFallback;
      const shell = new ShellTool(options.path, useDocker);
      await shell.init();
      const fs = new FileSystemTool(options.path);

      // Memory
      const memory = new RAGMemory(options.path);
      await memory.init();

      // Sandbox status
      if (shell.isSandboxed) {
        console.log(chalk.green('🔒 Docker sandbox active') + ' (512MB RAM, 0.5 CPU)');
      } else {
        console.log(chalk.yellow('⚠️  Strict safety mode') + ' (Docker unavailable or disabled)');
      }

      console.log();

      // Initialize orchestrator
      const orchestrator = new Orchestrator(provider, shell, fs, parseInt(options.maxSteps));

      // Run
      const result = await orchestrator.run(task);
      console.log('\n' + chalk.bold.green('Result:') + ' ' + result);

      // Cleanup
      await shell.stop();
    } catch (error: any) {
      console.error(chalk.bold.red('Fatal error:') + ' ' + error.message);
      process.exit(1);
    }
  });

// Index command
program
  .command('index')
  .description('Index the codebase for RAG memory')
  .option('-p, --path <path>', 'Project path', '.')
  .option('-f, --force', 'Force re-index', false)
  .action(async (options) => {
    console.log(chalk.bold('🧠 Indexing codebase...'));
    
    const memory = new RAGMemory(options.path);
    const initialized = await memory.init();
    
    if (!initialized) {
      console.log(chalk.red('Error: RAG memory unavailable'));
      console.log(chalk.dim('Install dependencies: npm install vectordb'));
      process.exit(1);
    }

    const indexed = await memory.indexProject(options.force);
    console.log(chalk.green(`✓ Indexed ${indexed} new chunks`));
  });

// Status command
program
  .command('status')
  .description('Check LinguClaw status')
  .option('-p, --path <path>', 'Project path', '.')
  .action(async (options) => {
    console.log(chalk.bold.cyan('LinguClaw Status\n'));
    
    // Docker
    try {
      const { default: Docker } = await import('dockerode');
      const docker = new Docker();
      await docker.ping();
      console.log(chalk.green('🔒 Docker: Available'));
    } catch {
      console.log(chalk.red('🔒 Docker: Unavailable'));
    }

    // Memory
    const memory = new RAGMemory(options.path);
    const initialized = await memory.init();
    if (initialized) {
      const stats = memory.getStats();
      console.log(chalk.green(`🧠 Memory: Ready (${stats.count} chunks)`));
    } else {
      console.log(chalk.red('🧠 Memory: Unavailable'));
    }

    // API Key
    const key = process.env.OPENROUTER_API_KEY;
    if (key) {
      const masked = key.slice(0, 8) + '...' + key.slice(-4);
      console.log(chalk.green(`🔑 API Key: ${masked}`));
    } else {
      console.log(chalk.red('🔑 API Key: Not set'));
    }
  });

// Web command
program
  .command('web')
  .description('Start LinguClaw Web UI server')
  .option('-p, --path <path>', 'Project root', '.')
  .option('-H, --host <host>', 'Host to bind', '127.0.0.1')
  .option('--port <port>', 'Port to listen on', '8080')
  .action(async (options) => {
    console.log(chalk.bold.cyan('🌐 Starting LinguClaw Web UI...\n'));
    
    if (!process.env.OPENROUTER_API_KEY) {
      console.log(chalk.red('Error: OPENROUTER_API_KEY not set'));
      process.exit(1);
    }

    try {
      const { runWebUI } = await import('./web');
      console.log(`Server will start at: ${chalk.bold.blue(`http://${options.host}:${options.port}`)}\n`);
      await runWebUI(options.path, options.host, parseInt(options.port));
    } catch (error: any) {
      console.log(chalk.red('Error: Missing web dependencies'));
      console.log(chalk.dim('Install with: npm install express'));
      process.exit(1);
    }
  });

// Daemon command
program
  .command('daemon <action>')
  .description('Control the LinguClaw 24/7 daemon')
  .option('-s, --services <services>', 'Comma-separated services')
  .action(async (action, options) => {
    const services = options.services?.split(',');
    
    switch (action) {
      case 'start':
        console.log(chalk.bold.cyan('🔄 Starting LinguClaw Daemon...'));
        if (await startDaemon(services)) {
          console.log(chalk.green('✓ Daemon started successfully'));
        } else {
          console.log(chalk.red('✗ Failed to start daemon'));
          process.exit(1);
        }
        break;
      case 'stop':
        console.log(chalk.bold.cyan('🛑 Stopping LinguClaw Daemon...'));
        if (await stopDaemon()) {
          console.log(chalk.green('✓ Daemon stopped'));
        } else {
          console.log(chalk.yellow('Daemon was not running'));
        }
        break;
      case 'restart':
        console.log(chalk.bold.cyan('🔄 Restarting LinguClaw Daemon...'));
        if (await restartDaemon()) {
          console.log(chalk.green('✓ Daemon restarted successfully'));
        } else {
          console.log(chalk.red('✗ Failed to restart daemon'));
          process.exit(1);
        }
        break;
      case 'status':
        const status = daemonStatus();
        if (status.running) {
          console.log(chalk.bold.green('● Daemon is running'));
          console.log(`  Started: ${status.started_at || 'N/A'}`);
          console.log(`  Uptime: ${status.uptime_seconds} seconds`);
          console.log(`  Tasks: ${status.tasks_processed} processed`);
          console.log(`  Services: ${status.active_services?.join(', ') || 'none'}`);
        } else {
          console.log(chalk.bold.red('○ Daemon is not running'));
        }
        break;
      default:
        console.log(chalk.red(`Unknown action: ${action}`));
        process.exit(1);
    }
  });

// Skills command
program
  .command('skills <action>')
  .description('Manage and execute skills')
  .argument('[skillName]', 'Skill name for execute')
  .option('-p, --params <params>', 'JSON params for skill')
  .action(async (action, skillName, options) => {
    const manager = new SkillManager();
    manager.loadBuiltinSkills();

    if (action === 'list') {
      const skills = manager.listSkills();
      console.log(chalk.bold.cyan('Available Skills:'));
      for (const skill of skills) {
        console.log(`  • ${chalk.bold(skill.name)} (${skill.type})`);
        console.log(`    ${skill.description}`);
      }
    } else if (action === 'execute') {
      if (!skillName) {
        console.log(chalk.red('Skill name required'));
        process.exit(1);
      }
      const params = options.params ? JSON.parse(options.params) : {};
      const result = await manager.execute(skillName, params);
      if (result.success) {
        console.log(chalk.green('✓ Success:') + ' ' + result.output);
      } else {
        console.log(chalk.red('✗ Error:') + ' ' + result.error);
      }
    }
  });

// Settings command
program
  .command('settings <action>')
  .description('Manage application settings')
  .argument('[key]', 'Setting key (e.g., llm.provider)')
  .argument('[value]', 'Setting value')
  .action(async (action, key, value) => {
    const config = getConfig();

    switch (action) {
      case 'list':
        const cfg = config.get();
        console.log(chalk.bold.cyan('📋 Application Settings\n'));
        
        console.log(chalk.bold.yellow('LLM Settings:'));
        console.log(`  Provider: ${chalk.green(cfg.llm.provider)}`);
        console.log(`  Model: ${chalk.green(cfg.llm.model)}`);
        console.log(`  API Key: ${cfg.llm.apiKey ? chalk.green('✓ Set') : chalk.red('✗ Not set')}`);
        console.log(`  Max Tokens: ${chalk.green(cfg.llm.maxTokens)}`);
        console.log(`  Temperature: ${chalk.green(cfg.llm.temperature)}`);
        if (cfg.llm.baseUrl) {
          console.log(`  Base URL: ${chalk.green(cfg.llm.baseUrl)}`);
        }
        
        console.log(chalk.bold.yellow('\nSystem Settings:'));
        console.log(`  Max Steps: ${chalk.green(cfg.system.maxSteps)}`);
        console.log(`  Use Docker: ${chalk.green(cfg.system.useDocker)}`);
        console.log(`  Log Level: ${chalk.green(cfg.system.logLevel)}`);
        console.log(`  Auto Index: ${chalk.green(cfg.system.autoIndex)}`);
        console.log(`  Safety Mode: ${chalk.green(cfg.system.safetyMode)}`);
        
        console.log(chalk.bold.yellow('\nWeb UI Settings:'));
        console.log(`  Port: ${chalk.green(cfg.webui.port)}`);
        console.log(`  Host: ${chalk.green(cfg.webui.host)}`);
        console.log(`  Auth Enabled: ${chalk.green(cfg.webui.authEnabled)}`);
        
        console.log(chalk.dim(`\nConfig file: ${config.getConfigPath()}`));
        break;
        
      case 'get':
        if (!key) {
          console.log(chalk.red('Key required'));
          process.exit(1);
        }
        const val = config.getValue(key);
        if (val !== undefined) {
          console.log(chalk.bold(`${key}:`) + ' ' + chalk.green(val));
        } else {
          console.log(chalk.red(`Unknown setting: ${key}`));
        }
        break;
        
      case 'set':
        if (!key || !value) {
          console.log(chalk.red('Key and value required'));
          process.exit(1);
        }
        try {
          // Try to parse as number or boolean
          let parsedValue: any = value;
          if (value === 'true') parsedValue = true;
          else if (value === 'false') parsedValue = false;
          else if (!isNaN(Number(value))) parsedValue = Number(value);
          
          config.update(key, parsedValue);
          console.log(chalk.green(`✓ Set ${key} = ${parsedValue}`));
        } catch (error: any) {
          console.log(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
        break;
        
      case 'reset':
        console.log(chalk.yellow('Resetting to defaults...'));
        config.reset();
        console.log(chalk.green('✓ Settings reset'));
        break;
        
      case 'export':
        console.log(config.export());
        break;
        
      case 'path':
        console.log(chalk.green(config.getConfigPath()));
        break;
        
      default:
        console.log(chalk.red(`Unknown action: ${action}`));
        console.log('Available: list, get, set, reset, export, path');
    }
  });

// Privacy command
program
  .command('privacy <action>')
  .description('Privacy and data control')
  .action(async (action) => {
    const manager = getPrivacyManager();

    switch (action) {
      case 'settings':
        const settings = manager.getSettings();
        console.log(chalk.bold.cyan('Privacy Settings:'));
        console.log(`  Offline Mode: ${settings.offline_mode}`);
        console.log(`  Prefer Local Models: ${settings.prefer_local_models}`);
        console.log(`  Encrypt Memory: ${settings.encrypt_memory}`);
        break;
      case 'report':
        const report = manager.getPrivacyReport();
        console.log(chalk.bold.cyan('Privacy Report:'));
        console.log(`  Data Stored Locally: ${report.settings_summary.data_stored_locally}`);
        console.log(`  Offline Capable: ${report.settings_summary.offline_capable}`);
        console.log('\nRecommendations:');
        for (const rec of report.recommendations) {
          console.log(`  • ${rec}`);
        }
        break;
      case 'export':
        const output = path.join(process.env.HOME || '~', '.linguclaw', 'data_export.json');
        if (manager.exportData(output)) {
          console.log(chalk.green(`✓ Data exported to ${output}`));
        }
        break;
      default:
        console.log(chalk.red(`Unknown action: ${action}`));
    }
  });

// Agent command
program
  .command('agent')
  .description('Start LinguClaw AI Agent')
  .option('-m, --mode <mode>', 'Mode: interactive, headless', 'interactive')
  .option('-p, --provider <provider>', 'LLM provider: auto, openrouter, openai, ollama', 'auto')
  .action(async (options) => {
    console.log(chalk.bold.cyan(`🤖 Starting LinguClaw Agent (${options.mode} mode)...\n`));

    const manager = new ProviderManager();
    let provider: BaseProvider | null;

    if (options.provider === 'auto') {
      provider = manager.createFromEnv();
    } else {
      const providerMap: Record<string, [ProviderType, Record<string, any>]> = {
        openrouter: [ProviderType.OPENROUTER, { api_key: process.env.OPENROUTER_API_KEY }],
        openai: [ProviderType.OPENAI, { api_key: process.env.OPENAI_API_KEY }],
        ollama: [ProviderType.OLLAMA, {}],
      };
      const [type, kwargs] = providerMap[options.provider] || providerMap.openrouter;
      provider = createProvider(type, kwargs);
    }

    if (!provider) {
      console.log(chalk.red('No LLM provider available'));
      process.exit(1);
    }

    console.log(chalk.green(`✓ Using provider: ${provider.model}`));

    if (options.mode === 'interactive') {
      console.log('\n' + chalk.dim("Type 'exit' to quit\n"));
      
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const messages: Message[] = [];

      const askQuestion = () => {
        rl.question(chalk.bold('You: '), async (input) => {
          if (input.toLowerCase() === 'exit') {
            rl.close();
            console.log('\n' + chalk.yellow('Goodbye!'));
            return;
          }

          messages.push({ role: 'user', content: input });
          const response = await provider!.complete(messages);

          if (response.error) {
            console.log(chalk.red('Error:') + ' ' + response.error);
          } else {
            console.log(chalk.bold('Agent:') + ' ' + response.content + '\n');
            messages.push({ role: 'assistant', content: response.content });
          }

          askQuestion();
        });
      };

      askQuestion();
    }
  });

// Hub install command
program
  .command('hub')
  .description('Install community skills from ClawLing Hub')
  .argument('<action>', 'Action: install, list, remove')
  .argument('[name]', 'Skill name')
  .action(async (action, name) => {
    const fs = require('fs');
    const https = require('https');
    const pluginDir = path.join(process.env.HOME || '~', '.linguclaw', 'plugins');

    if (action === 'install') {
      if (!name) { console.log(chalk.red('Skill name required: linguclaw hub install <name>')); process.exit(1); }
      console.log(chalk.cyan('🔍 Searching ClawLing Hub for "' + name + '"...'));

      // Fetch skill from Firestore REST API
      const projectId = 'linguclaw';
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/skills`;
      const data: any = await new Promise((resolve, reject) => {
        https.get(url, (res: any) => {
          let d = ''; res.on('data', (c: any) => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse error')); } });
        }).on('error', reject);
      });

      if (!data.documents) { console.log(chalk.red('No skills found on hub')); return; }
      const doc = data.documents.find((d: any) => {
        const fields = d.fields;
        return fields.name?.stringValue?.toLowerCase() === name.toLowerCase();
      });
      if (!doc) { console.log(chalk.red('Skill "' + name + '" not found')); return; }

      const fields = doc.fields;
      const downloadUrl = fields.downloadUrl?.stringValue;
      const fileName = fields.fileName?.stringValue || name + '.js';

      if (!downloadUrl) { console.log(chalk.red('No download file for this skill')); return; }

      // Download file
      if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
      const dest = path.join(pluginDir, fileName);
      console.log(chalk.dim('Downloading to ' + dest + '...'));

      await new Promise<void>((resolve, reject) => {
        const download = (urlStr: string) => {
          https.get(urlStr, (res: any) => {
            if (res.statusCode === 302 || res.statusCode === 301) { download(res.headers.location); return; }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', reject);
        };
        download(downloadUrl);
      });

      console.log(chalk.green('✓ Installed "' + fields.name.stringValue + '" → ' + dest));
      console.log(chalk.dim('  Auto-loaded on next linguclaw start'));

    } else if (action === 'list') {
      if (!fs.existsSync(pluginDir)) { console.log(chalk.dim('No community skills installed')); return; }
      const files = fs.readdirSync(pluginDir).filter((f: string) => f.endsWith('.js') || f.endsWith('.ts'));
      if (files.length === 0) { console.log(chalk.dim('No community skills installed')); return; }
      console.log(chalk.bold.cyan('Installed community skills:'));
      files.forEach((f: string) => console.log('  • ' + f));

    } else if (action === 'remove') {
      if (!name) { console.log(chalk.red('Skill name required')); process.exit(1); }
      const files = fs.existsSync(pluginDir) ? fs.readdirSync(pluginDir) : [];
      const match = files.find((f: string) => f.toLowerCase().includes(name.toLowerCase()));
      if (!match) { console.log(chalk.red('Skill "' + name + '" not found locally')); return; }
      fs.unlinkSync(path.join(pluginDir, match));
      console.log(chalk.green('✓ Removed ' + match));
    }
  });

export function cliEntry(): void {
  program.parse();
}

cliEntry();
