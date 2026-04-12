/**
 * 24/7 Daemon mode for continuous operation
 * TypeScript equivalent of Python daemon.py
 */

import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { DaemonStatus } from './types';
import { getLogger } from './logger';

const logger = getLogger();

export class LinguClawDaemon extends EventEmitter {
  pidFile: string;
  statusFile: string;
  status: DaemonStatus;
  private running: boolean;
  private services: Map<string, { handler: Function; interval?: number; lastRun?: Date }>;
  private intervals: NodeJS.Timeout[];

  constructor(pidFile?: string, statusFile?: string) {
    super();
    this.pidFile = pidFile || path.join(process.env.HOME || '~', '.linguclaw', 'daemon.pid');
    this.statusFile = statusFile || path.join(process.env.HOME || '~', '.linguclaw', 'daemon.status');
    this.status = {
      running: false,
      started_at: null,
      uptime_seconds: 0,
      tasks_processed: 0,
      errors_count: 0,
      active_services: [],
    };
    this.running = false;
    this.services = new Map();
    this.intervals = [];
  }

  registerService(name: string, handler: Function, interval?: number): void {
    this.services.set(name, { handler, interval });
    logger.info(`Registered service: ${name}`);
  }

  private writePid(): void {
    fs.writeFileSync(this.pidFile, process.pid.toString());
  }

  private removePid(): void {
    if (fs.existsSync(this.pidFile)) {
      fs.unlinkSync(this.pidFile);
    }
  }

  private writeStatus(): void {
    const statusData = {
      ...this.status,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(this.statusFile, JSON.stringify(statusData, null, 2));
  }

  async start(): Promise<boolean> {
    if (this.isRunning()) {
      logger.error('Daemon already running');
      return false;
    }

    logger.info('Starting LinguClaw Daemon...');
    this.writePid();

    this.status.running = true;
    this.status.started_at = new Date();
    this.status.active_services = Array.from(this.services.keys());
    this.writeStatus();

    // Start services
    for (const [name, service] of this.services) {
      if (service.interval) {
        // Periodic service
        const interval = setInterval(async () => {
          try {
            await service.handler();
            this.status.tasks_processed++;
          } catch (error) {
            this.status.errors_count++;
            logger.error(`Service ${name} error: ${error}`);
          }
        }, service.interval * 1000);
        this.intervals.push(interval);
      } else {
        // One-shot service
        try {
          await service.handler();
        } catch (error) {
          logger.error(`Service ${name} error: ${error}`);
        }
      }
    }

    // Status updater
    const statusInterval = setInterval(() => {
      if (this.status.started_at) {
        this.status.uptime_seconds = Math.floor(
          (Date.now() - this.status.started_at.getTime()) / 1000
        );
      }
      this.writeStatus();
    }, 10000);
    this.intervals.push(statusInterval);

    this.running = true;
    logger.info(`Daemon started with ${this.services.size} services`);
    return true;
  }

  stop(): void {
    logger.info('Stopping daemon...');
    this.running = false;
    this.status.running = false;

    // Clear all intervals
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];

    this.removePid();
    this.writeStatus();
    logger.info('Daemon stopped');
  }

  isRunning(): boolean {
    if (fs.existsSync(this.pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(this.pidFile, 'utf-8').trim());
        if (isNaN(pid)) {
          this.removePid();
          return false;
        }
        // Check if process actually exists
        try {
          process.kill(pid, 0); // signal 0 = check existence
          return true;
        } catch {
          // Process doesn't exist, stale PID file
          this.removePid();
          return false;
        }
      } catch (err: any) {
        logger.debug(`PID check failed: ${err.message}`);
        this.removePid();
      }
    }
    return false;
  }

  getStatus(): DaemonStatus {
    if (fs.existsSync(this.statusFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.statusFile, 'utf-8'));
        return {
          running: data.running || false,
          started_at: data.started_at ? new Date(data.started_at) : null,
          uptime_seconds: data.uptime_seconds || 0,
          tasks_processed: data.tasks_processed || 0,
          errors_count: data.errors_count || 0,
          active_services: data.active_services || [],
        };
      } catch (err: any) {
        logger.debug(`Status read failed: ${err.message}`);
        return this.status;
      }
    }
    return this.status;
  }
}

// Global daemon instance
let daemonInstance: LinguClawDaemon | null = null;

export function getDaemon(): LinguClawDaemon {
  if (!daemonInstance) {
    daemonInstance = new LinguClawDaemon();
  }
  return daemonInstance;
}

export async function startDaemon(services?: string[]): Promise<boolean> {
  const daemon = getDaemon();

  // Register default services if not specified
  if (!services || services.includes('health')) {
    daemon.registerService('health', async () => {
      // Health check service
      logger.debug('Health check running');
    }, 60); // Every 60 seconds
  }

  if (!services || services.includes('proactive')) {
    daemon.registerService('proactive', async () => {
      // Proactive tasks service
      logger.debug('Proactive tasks running');
    }, 300); // Every 5 minutes
  }

  return await daemon.start();
}

export async function stopDaemon(): Promise<boolean> {
  const daemon = getDaemon();
  daemon.stop();
  return true;
}

export function daemonStatus(): DaemonStatus {
  const daemon = getDaemon();
  return daemon.getStatus();
}

export async function restartDaemon(): Promise<boolean> {
  await stopDaemon();
  await new Promise(resolve => setTimeout(resolve, 2000));
  return await startDaemon();
}
