/**
 * Task scheduler - cron jobs, reminders, background automation
 */

import { getLogger } from './logger';
import fs from 'fs';
import path from 'path';

const logger = getLogger();

export interface ScheduledJob {
  id: string;
  name: string;
  type: 'cron' | 'interval' | 'once' | 'reminder';
  schedule: string; // cron expression, ms interval, or ISO date
  command: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  createdAt: string;
  tags: string[];
}

export interface JobResult {
  jobId: string;
  success: boolean;
  output?: string;
  error?: string;
  timestamp: string;
}

export class TaskScheduler {
  private jobs: Map<string, ScheduledJob>;
  private timers: Map<string, NodeJS.Timeout>;
  private results: JobResult[];
  private dataPath: string;
  private running: boolean;
  private onJobExecute?: (job: ScheduledJob) => Promise<string>;

  constructor(dataDir?: string) {
    const dir = dataDir || path.join(process.env.HOME || '~', '.linguclaw');
    this.dataPath = path.join(dir, 'scheduler.json');
    this.jobs = new Map();
    this.timers = new Map();
    this.results = [];
    this.running = false;

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.load();
  }

  setExecutor(fn: (job: ScheduledJob) => Promise<string>): void {
    this.onJobExecute = fn;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
        if (data.jobs) {
          for (const job of data.jobs) {
            this.jobs.set(job.id, job);
          }
        }
        if (data.results) {
          this.results = data.results.slice(-100); // Keep last 100 results
        }
      }
    } catch (error) {
      logger.warn(`Failed to load scheduler data: ${error}`);
    }
  }

  private save(): void {
    try {
      const data = {
        jobs: Array.from(this.jobs.values()),
        results: this.results.slice(-100),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn(`Failed to save scheduler data: ${error}`);
    }
  }

  addJob(job: Omit<ScheduledJob, 'id' | 'runCount' | 'createdAt'>): ScheduledJob {
    const id = 'job-' + Date.now().toString(36);
    const newJob: ScheduledJob = {
      ...job,
      id,
      runCount: 0,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(id, newJob);
    this.save();

    if (this.running && newJob.enabled) {
      this.scheduleJob(newJob);
    }

    logger.info(`Job added: ${newJob.name} (${newJob.type})`);
    return newJob;
  }

  removeJob(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timers.delete(id);
    }
    const deleted = this.jobs.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  toggleJob(id: string): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.enabled = !job.enabled;
    if (!job.enabled) {
      const timer = this.timers.get(id);
      if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
        this.timers.delete(id);
      }
    } else if (this.running) {
      this.scheduleJob(job);
    }
    this.save();
    return job;
  }

  getJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  getResults(): JobResult[] {
    return this.results.slice(-50);
  }

  start(): void {
    this.running = true;
    for (const job of this.jobs.values()) {
      if (job.enabled) this.scheduleJob(job);
    }
    logger.info(`Scheduler started with ${this.jobs.size} jobs`);
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.clear();
    logger.info('Scheduler stopped');
  }

  private scheduleJob(job: ScheduledJob): void {
    switch (job.type) {
      case 'interval': {
        const ms = this.parseInterval(job.schedule);
        if (ms > 0) {
          const timer = setInterval(() => this.executeJob(job), ms);
          this.timers.set(job.id, timer);
          job.nextRun = new Date(Date.now() + ms).toISOString();
        }
        break;
      }
      case 'once':
      case 'reminder': {
        const targetTime = new Date(job.schedule).getTime();
        const delay = targetTime - Date.now();
        if (delay > 0) {
          const timer = setTimeout(() => {
            this.executeJob(job);
            job.enabled = false;
            this.save();
          }, delay);
          this.timers.set(job.id, timer);
          job.nextRun = job.schedule;
        }
        break;
      }
      case 'cron': {
        // Simple cron: parse "*/5 * * * *" style
        const ms = this.parseCronToInterval(job.schedule);
        if (ms > 0) {
          const timer = setInterval(() => this.executeJob(job), ms);
          this.timers.set(job.id, timer);
          job.nextRun = new Date(Date.now() + ms).toISOString();
        }
        break;
      }
    }
    this.save();
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    const now = new Date().toISOString();
    job.lastRun = now;
    job.runCount++;

    let output = '';
    let success = true;
    let error: string | undefined;

    try {
      if (this.onJobExecute) {
        output = await this.onJobExecute(job);
      } else {
        output = `Job "${job.name}" executed (no handler)`;
      }
    } catch (err: any) {
      success = false;
      error = err.message;
    }

    const result: JobResult = {
      jobId: job.id,
      success,
      output,
      error,
      timestamp: now,
    };
    this.results.push(result);
    this.save();

    logger.info(`Job executed: ${job.name} - ${success ? 'OK' : 'FAIL'}`);
  }

  private parseInterval(schedule: string): number {
    const match = schedule.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) return 0;
    const val = parseInt(match[1]);
    switch (match[2]) {
      case 'ms': return val;
      case 's': return val * 1000;
      case 'm': return val * 60 * 1000;
      case 'h': return val * 3600 * 1000;
      case 'd': return val * 86400 * 1000;
      default: return 0;
    }
  }

  private parseCronToInterval(cron: string): number {
    // Simplified: convert common cron patterns to intervals
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return 60000; // default: 1 minute

    // Check for */N minute pattern
    const minMatch = parts[0].match(/^\*\/(\d+)$/);
    if (minMatch) return parseInt(minMatch[1]) * 60 * 1000;

    // Check for */N hour pattern
    const hourMatch = parts[1].match(/^\*\/(\d+)$/);
    if (hourMatch) return parseInt(hourMatch[1]) * 3600 * 1000;

    // Default: run every hour
    return 3600 * 1000;
  }
}
