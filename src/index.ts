/**
 * Main entry point for LinguClaw
 * TypeScript equivalent of Python run.py
 */

import dotenv from 'dotenv';
dotenv.config();

import { cliEntry } from './cli';

// Run CLI
cliEntry();
