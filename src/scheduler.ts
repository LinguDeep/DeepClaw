/**
 * Task scheduler - cron jobs, reminders, background automation
 * Production-ready with proper cron parsing, retry logic, and error recovery
 */

import { getLogger } from './logger';
import fs from 'fs';
import path from 'path';

const logger = getLogger();

export interface ScheduledJob {
  id: string;
  name: string;
  type: 'cron' | 'interval' | 'once' | 'reminder';
  schedule: string; // cron expression, interval string, or ISO date
  command: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  maxRuns?: number; // 0 = unlimited
  retryOnFail: boolean;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  tags: string[];
  description?: string;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  output?: string;
  error?: string;
  timestamp: string;
  duration?: number;
}

export class TaskScheduler {
  private jobs: Map<string, ScheduledJob>;
  private timers: Map<string, NodeJS.Timeout>;
  private cronTimers: Map<string, NodeJS.Timeout>;
  private results: JobResult[];
  private dataPath: string;
  private running: boolean;
  private onJobExecute?: (job: ScheduledJob) => Promise<string>;

  constructor(dataDir?: string) {
    const dir = dataDir || path.join(process.env.HOME || '~', '.linguclaw');
    this.dataPath = path.join(dir, 'scheduler.json');
    this.jobs = new Map();
    this.timers = new Map();
    this.cronTimers = new Map();
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
            // Ensure new fields have defaults for old data
            job.retryOnFail = job.retryOnFail ?? false;
            job.retryCount = job.retryCount ?? 0;
            job.maxRetries = job.maxRetries ?? 3;
            job.maxRuns = job.maxRuns ?? 0;
            this.jobs.set(job.id, job);
          }
        }
        if (data.results) {
          this.results = data.results.slice(-200);
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
        results: this.results.slice(-200),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn(`Failed to save scheduler data: ${error}`);
    }
  }

  addJob(job: Partial<ScheduledJob> & { name: string; type: ScheduledJob['type']; schedule: string; command: string }): ScheduledJob {
    const id = 'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const newJob: ScheduledJob = {
      enabled: true,
      tags: [],
      retryOnFail: false,
      retryCount: 0,
      maxRetries: 3,
      maxRuns: 0,
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

    logger.info(`Job added: ${newJob.name} (${newJob.type}: ${newJob.schedule})`);
    return newJob;
  }

  updateJob(id: string, updates: Partial<ScheduledJob>): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    // Stop existing timer
    this.clearJobTimer(id);

    // Apply updates (don't allow changing id or createdAt)
    const { id: _id, createdAt: _ca, ...safeUpdates } = updates;
    Object.assign(job, safeUpdates);

    // Reschedule if running and enabled
    if (this.running && job.enabled) {
      this.scheduleJob(job);
    }

    this.save();
    return job;
  }

  removeJob(id: string): boolean {
    this.clearJobTimer(id);
    const deleted = this.jobs.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  toggleJob(id: string): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.enabled = !job.enabled;
    if (!job.enabled) {
      this.clearJobTimer(id);
    } else if (this.running) {
      this.scheduleJob(job);
    }
    this.save();
    return job;
  }

  getJob(id: string): ScheduledJob | undefined {
    return this.jobs.get(id);
  }

  getJobs(tag?: string): ScheduledJob[] {
    const all = Array.from(this.jobs.values());
    if (!tag) return all;
    return all.filter(j => j.tags.includes(tag));
  }

  getResults(jobId?: string): JobResult[] {
    const all = this.results.slice(-100);
    if (!jobId) return all;
    return all.filter(r => r.jobId === jobId);
  }

  getStats(): { total: number; enabled: number; running: boolean; totalRuns: number; successRate: number } {
    const jobs = Array.from(this.jobs.values());
    const totalRuns = this.results.length;
    const successRuns = this.results.filter(r => r.success).length;
    return {
      total: jobs.length,
      enabled: jobs.filter(j => j.enabled).length,
      running: this.running,
      totalRuns,
      successRate: totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 100,
    };
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
    for (const [id] of this.timers) {
      this.clearJobTimer(id);
    }
    for (const [id] of this.cronTimers) {
      this.clearJobTimer(id);
    }
    logger.info('Scheduler stopped');
  }

  private clearJobTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); clearInterval(timer); this.timers.delete(id); }
    const cronTimer = this.cronTimers.get(id);
    if (cronTimer) { clearTimeout(cronTimer); this.cronTimers.delete(id); }
  }

  private scheduleJob(job: ScheduledJob): void {
    this.clearJobTimer(job.id);

    switch (job.type) {
      case 'interval': {
        const ms = this.parseInterval(job.schedule);
        if (ms > 0) {
          const timer = setInterval(() => this.executeJob(job), ms);
          this.timers.set(job.id, timer);
          job.nextRun = new Date(Date.now() + ms).toISOString();
        } else {
          logger.warn(`Invalid interval: ${job.schedule} for job ${job.name}`);
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
        } else {
          logger.warn(`Job ${job.name}: scheduled time already passed (${job.schedule})`);
          job.enabled = false;
        }
        break;
      }
      case 'cron': {
        this.scheduleCron(job);
        break;
      }
    }
    this.save();
  }

  private scheduleCron(job: ScheduledJob): void {
    const nextMs = this.getNextCronRun(job.schedule);
    if (nextMs <= 0) {
      logger.warn(`Invalid cron expression: ${job.schedule}`);
      return;
    }

    job.nextRun = new Date(Date.now() + nextMs).toISOString();

    const timer = setTimeout(() => {
      this.executeJob(job);
      // Reschedule for next cron run
      if (this.running && job.enabled) {
        this.scheduleCron(job);
      }
    }, nextMs);
    this.cronTimers.set(job.id, timer);
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    // Check max runs
    if (job.maxRuns && job.maxRuns > 0 && job.runCount >= job.maxRuns) {
      logger.info(`Job ${job.name} reached max runs (${job.maxRuns}), disabling`);
      job.enabled = false;
      this.clearJobTimer(job.id);
      this.save();
      return;
    }

    const startTime = Date.now();
    const now = new Date().toISOString();
    job.lastRun = now;
    job.runCount++;

    let output = '';
    let success = true;
    let error: string | undefined;

    try {
      if (this.onJobExecute) {
        output = await Promise.race([
          this.onJobExecute(job),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Job timeout (60s)')), 60000)),
        ]);
      } else {
        output = `Job "${job.name}" executed (no handler registered)`;
      }
      job.retryCount = 0; // Reset retry count on success
    } catch (err: any) {
      success = false;
      error = err.message;

      // Retry logic
      if (job.retryOnFail && job.retryCount < job.maxRetries) {
        job.retryCount++;
        const retryDelay = Math.min(1000 * Math.pow(2, job.retryCount), 60000); // Exponential backoff, max 60s
        logger.warn(`Job ${job.name} failed, retrying in ${retryDelay}ms (attempt ${job.retryCount}/${job.maxRetries})`);
        setTimeout(() => this.executeJob(job), retryDelay);
      }
    }

    const duration = Date.now() - startTime;
    const result: JobResult = { jobId: job.id, success, output, error, timestamp: now, duration };
    this.results.push(result);

    // Keep results bounded
    if (this.results.length > 200) {
      this.results = this.results.slice(-200);
    }

    this.save();
    logger.info(`Job executed: ${job.name} - ${success ? 'OK' : 'FAIL'} (${duration}ms)`);
  }

  parseInterval(schedule: string): number {
    const match = schedule.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    switch (match[2].toLowerCase()) {
      case 'ms': return Math.round(val);
      case 's': return Math.round(val * 1000);
      case 'm': return Math.round(val * 60 * 1000);
      case 'h': return Math.round(val * 3600 * 1000);
      case 'd': return Math.round(val * 86400 * 1000);
      case 'w': return Math.round(val * 7 * 86400 * 1000);
      default: return 0;
    }
  }

  // Real cron parser: supports standard 5-field cron expressions
  // minute hour day-of-month month day-of-week
  // Supports: *, step (*/N), exact (N), range (N-M), list (N,M,O)
  private getNextCronRun(cron: string): number {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return 60000; // Fallback: 1 minute

    const now = new Date();
    const check = new Date(now);
    check.setSeconds(0, 0);
    check.setMinutes(check.getMinutes() + 1); // Start from next minute

    // Check up to 1 year ahead
    const maxIterations = 525600; // minutes in a year
    for (let i = 0; i < maxIterations; i++) {
      if (
        this.cronFieldMatches(parts[0], check.getMinutes()) &&
        this.cronFieldMatches(parts[1], check.getHours()) &&
        this.cronFieldMatches(parts[2], check.getDate()) &&
        this.cronFieldMatches(parts[3], check.getMonth() + 1) &&
        this.cronFieldMatches(parts[4], check.getDay())
      ) {
        return check.getTime() - now.getTime();
      }
      check.setMinutes(check.getMinutes() + 1);
    }

    return 3600000; // Fallback: 1 hour
  }

  private cronFieldMatches(field: string, value: number): boolean {
    if (field === '*') return true;

    // */N - step
    const stepMatch = field.match(/^\*\/(\d+)$/);
    if (stepMatch) return value % parseInt(stepMatch[1]) === 0;

    // Comma-separated values: 1,5,10
    const values = field.split(',');
    for (const v of values) {
      // Range: 1-5
      const rangeMatch = v.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const min = parseInt(rangeMatch[1]);
        const max = parseInt(rangeMatch[2]);
        if (value >= min && value <= max) return true;
        continue;
      }

      // Range with step: 1-30/5
      const rangeStepMatch = v.match(/^(\d+)-(\d+)\/(\d+)$/);
      if (rangeStepMatch) {
        const min = parseInt(rangeStepMatch[1]);
        const max = parseInt(rangeStepMatch[2]);
        const step = parseInt(rangeStepMatch[3]);
        if (value >= min && value <= max && (value - min) % step === 0) return true;
        continue;
      }

      // Exact value
      if (parseInt(v) === value) return true;
    }

    return false;
  }
}
