/**
 * Main entry point for LinguClaw
 * TypeScript equivalent of Python run.py
 */

import dotenv from 'dotenv';
dotenv.config();

import { cliEntry } from './cli';
import { getLogger } from './logger';

const logger = getLogger();

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down...');
  process.exit(0);
});

// Run CLI
try {
  cliEntry();
} catch (error: any) {
  logger.error(`CLI error: ${error.message}`);
  process.exit(1);
}
