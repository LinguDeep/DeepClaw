/**
 * Logger implementation
 * Equivalent to Python logger.py with Winston
 */

import winston from 'winston';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';

// Theme colors matching Python Rich theme
const theme = {
  thought: chalk.cyan,
  command: chalk.bold.white,
  observation: chalk.green,
  error: chalk.bold.red,
  warning: chalk.yellow,
  info: chalk.dim.white,
  step: chalk.bold.magenta,
  header: chalk.bold.blue,
  success: chalk.bold.green,
  blocked: chalk.bold.yellow,
};

export interface LogFunctions {
  logThought: (step: number, thought: string, logger?: winston.Logger) => void;
  logCommand: (step: number, command: string, logger?: winston.Logger) => void;
  logObservation: (step: number, tag: string, status: string, data: string, logger?: winston.Logger) => void;
  logError: (message: string, logger?: winston.Logger) => void;
  logWarning: (message: string, logger?: winston.Logger) => void;
  logHeader: (title: string, subtitle?: string, logger?: winston.Logger) => void;
  logFinal: (answer: string, logger?: winston.Logger) => void;
  logStats: (stats: Record<string, any>, logger?: winston.Logger) => void;
}

export function setupLogger(
  name: string = 'linguclaw',
  logDir: string = 'logs',
  level: string = 'debug'
): winston.Logger {
  const logger = winston.createLogger({
    level,
    defaultMeta: { service: name },
    transports: [],
  });

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  
  // File handler
  logger.add(new winston.transports.File({
    filename: path.join(logDir, `session_${timestamp}.log`),
    level: 'debug',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        return `${timestamp} | ${level.padEnd(8)} | ${name} | ${message}`;
      })
    ),
  }));

  // Console handler (warnings and above only, to avoid cluttering TUI)
  logger.add(new winston.transports.Console({
    level: 'warning',
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));

  return logger;
}

// Console output functions matching Python Rich behavior
export const logFunctions: LogFunctions = {
  logThought: (step: number, thought: string, logger?: winston.Logger) => {
    console.log(`\n${theme.step(`[Step ${step}]`)} ${theme.thought(`💭 ${thought}`)}`);
    logger?.info(`Step ${step} THOUGHT: ${thought}`);
  },

  logCommand: (step: number, command: string, logger?: winston.Logger) => {
    console.log(`${theme.step(`[Step ${step}]`)} ${theme.command(`⚡ RUN: ${command}`)}`);
    logger?.info(`Step ${step} RUN: ${command}`);
  },

  logObservation: (step: number, tag: string, status: string, data: string, logger?: winston.Logger) => {
    const icons: Record<string, string> = {
      success: theme.success('✓'),
      error: theme.error('✗'),
      blocked: theme.blocked('🚫'),
    };
    const icon = icons[status] || '?';
    console.log(`         ${icon} ${tag}  ${data.slice(0, 120)}`);
    logger?.info(`Step ${step} OBS (${tag}) [${status}]: ${data.slice(0, 200)}`);
  },

  logError: (message: string, logger?: winston.Logger) => {
    console.log(theme.error(`❌ ${message}`));
    logger?.error(message);
  },

  logWarning: (message: string, logger?: winston.Logger) => {
    console.log(theme.warning(`⚠️  ${message}`));
    logger?.warn(message);
  },

  logHeader: (title: string, subtitle: string = '', logger?: winston.Logger) => {
    console.log(theme.header('='.repeat(60)));
    console.log(theme.header(`🤖 ${title}`));
    if (subtitle) {
      console.log(theme.info(subtitle));
    }
    logger?.info(`=== ${title} === ${subtitle}`);
  },

  logFinal: (answer: string, logger?: winston.Logger) => {
    console.log(theme.header('='.repeat(60)));
    console.log(theme.success('FINAL ANSWER'));
    console.log(theme.success('='.repeat(60)));
    console.log(answer);
    console.log(theme.success('='.repeat(60)));
    logger?.info(`FINAL: ${answer}`);
  },

  logStats: (stats: Record<string, any>, logger?: winston.Logger) => {
    console.log(`\n${theme.header('📊 Stats')}`);
    for (const [key, value] of Object.entries(stats)) {
      console.log(`   ${theme.info(`${key}:`)}  ${value}`);
    }
    logger?.info(`Stats: ${JSON.stringify(stats)}`);
  },
};

// Export default logger instance
let defaultLogger: winston.Logger | null = null;

export function getLogger(): winston.Logger {
  if (!defaultLogger) {
    defaultLogger = setupLogger();
  }
  return defaultLogger;
}

export function setDefaultLogger(logger: winston.Logger): void {
  defaultLogger = logger;
}
