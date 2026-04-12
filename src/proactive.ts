/**
 * Proactive behavior system - reminders, alerts, briefings
 * TypeScript equivalent of Python proactive.py
 */

import Database from 'better-sqlite3';
import path from 'path';
import { ProactiveTask, TriggerType, ActionType } from './types';
import { getLogger } from './logger';

const logger = getLogger();

export class ProactiveEngine {
  dbPath: string;
  private db: Database.Database | null;
  private tasks: Map<string, ProactiveTask>;
  private running: boolean;
  private checkInterval: NodeJS.Timeout | null;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.env.HOME || '~', '.linguclaw', 'proactive.db');
    this.db = null;
    this.tasks = new Map();
    this.running = false;
    this.checkInterval = null;
  }

  async init(): Promise<boolean> {
    try {
      this.db = new Database(this.dbPath);
      this.createTable();
      this.loadTasks();
      return true;
    } catch (error) {
      logger.error(`Failed to initialize proactive engine: ${error}`);
      return false;
    }
  }

  private createTable(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proactive_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        trigger_type TEXT NOT NULL,
        trigger_config TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_config TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        last_run TEXT,
        run_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        tags TEXT DEFAULT '[]'
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tags ON proactive_tasks(tags)`);
  }

  private loadTasks(): void {
    if (!this.db) return;

    const rows: any[] = this.db.prepare('SELECT * FROM proactive_tasks').all();
    for (const row of rows) {
      const task: ProactiveTask = {
        id: row.id,
        name: row.name,
        description: row.description || '',
        trigger_type: row.trigger_type as TriggerType,
        trigger_config: JSON.parse(row.trigger_config),
        action_type: row.action_type as ActionType,
        action_config: JSON.parse(row.action_config),
        enabled: Boolean(row.enabled),
        last_run: row.last_run ? new Date(row.last_run) : null,
        run_count: row.run_count,
        created_at: new Date(row.created_at),
        tags: JSON.parse(row.tags),
      };
      this.tasks.set(task.id, task);
    }
  }

  private saveTask(task: ProactiveTask): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO proactive_tasks 
      (id, name, description, trigger_type, trigger_config, action_type, 
       action_config, enabled, last_run, run_count, created_at, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.name,
      task.description,
      task.trigger_type,
      JSON.stringify(task.trigger_config),
      task.action_type,
      JSON.stringify(task.action_config),
      task.enabled ? 1 : 0,
      task.last_run?.toISOString() || null,
      task.run_count,
      task.created_at.toISOString(),
      JSON.stringify(task.tags)
    );
  }

  addTask(task: ProactiveTask): string {
    this.tasks.set(task.id, task);
    this.saveTask(task);
    logger.info(`Added proactive task: ${task.name} (${task.id})`);
    return task.id;
  }

  removeTask(taskId: string): boolean {
    if (this.tasks.has(taskId)) {
      this.tasks.delete(taskId);
      if (this.db) {
        this.db.prepare('DELETE FROM proactive_tasks WHERE id = ?').run(taskId);
      }
      return true;
    }
    return false;
  }

  enableTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = true;
      this.saveTask(task);
      return true;
    }
    return false;
  }

  disableTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = false;
      this.saveTask(task);
      return true;
    }
    return false;
  }

  private checkTriggers(): ProactiveTask[] {
    const triggered: ProactiveTask[] = [];
    const now = new Date();

    for (const task of this.tasks.values()) {
      if (!task.enabled) continue;

      if (task.trigger_type === TriggerType.TIME) {
        const targetTime = task.trigger_config.time;
        if (targetTime) {
          const target = new Date(targetTime);
          const diff = (now.getTime() - target.getTime()) / 1000;
          if (diff >= 0 && diff <= 60) {
            if (!task.last_run || task.last_run < target) {
              triggered.push(task);
            }
          }
        }
      } else if (task.trigger_type === TriggerType.INTERVAL) {
        const intervalMinutes = task.trigger_config.minutes || 60;
        if (task.last_run) {
          const diff = (now.getTime() - task.last_run.getTime()) / (1000 * 60);
          if (diff >= intervalMinutes) {
            triggered.push(task);
          }
        } else {
          triggered.push(task);
        }
      }
    }

    return triggered;
  }

  private executeTask(task: ProactiveTask): void {
    logger.info(`Executing proactive task: ${task.name}`);

    task.last_run = new Date();
    task.run_count++;
    this.saveTask(task);

    // Execute action based on type
    switch (task.action_type) {
      case ActionType.REMINDER:
        logger.info(`REMINDER: ${task.action_config.message}`);
        break;
      case ActionType.ALERT:
        logger.warn(`ALERT: ${task.action_config.message}`);
        break;
      case ActionType.BRIEFING:
        logger.info(`BRIEFING: ${task.action_config.type}`);
        break;
      case ActionType.NOTIFICATION:
        logger.info(`NOTIFICATION: ${task.action_config.message}`);
        break;
    }
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    logger.info('Proactive engine started');

    // Check triggers every 30 seconds
    this.checkInterval = setInterval(() => {
      const triggered = this.checkTriggers();
      for (const task of triggered) {
        this.executeTask(task);
      }
    }, 30000);
  }

  stop(): void {
    this.running = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Proactive engine stopped');
  }

  addReminder(name: string, description: string, time: Date, message: string, channels?: string[]): string {
    const task: ProactiveTask = {
      id: `reminder_${Date.now()}`,
      name,
      description,
      trigger_type: TriggerType.TIME,
      trigger_config: { time: time.toISOString() },
      action_type: ActionType.REMINDER,
      action_config: { message, channels: channels || ['console'] },
      enabled: true,
      run_count: 0,
      created_at: new Date(),
      tags: ['reminder'],
    };
    return this.addTask(task);
  }

  addDailyBriefing(timeStr: string = '08:00', channels?: string[]): string {
    const [hour, minute] = timeStr.split(':').map(Number);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    if (target < now) {
      target.setDate(target.getDate() + 1);
    }

    const task: ProactiveTask = {
      id: `briefing_${timeStr.replace(':', '')}`,
      name: 'Daily Morning Briefing',
      description: 'Morning summary of tasks, calendar, and news',
      trigger_type: TriggerType.TIME,
      trigger_config: { time: target.toISOString(), recurring: 'daily' },
      action_type: ActionType.BRIEFING,
      action_config: { channels: channels || ['console'], type: 'morning' },
      enabled: true,
      run_count: 0,
      created_at: new Date(),
      tags: ['briefing', 'daily'],
    };
    return this.addTask(task);
  }

  listTasks(tag?: string): ProactiveTask[] {
    const tasks = Array.from(this.tasks.values());
    if (tag) {
      return tasks.filter(t => t.tags.includes(tag));
    }
    return tasks;
  }
}

// Global instance
let proactiveEngineInstance: ProactiveEngine | null = null;

export function getProactiveEngine(): ProactiveEngine {
  if (!proactiveEngineInstance) {
    proactiveEngineInstance = new ProactiveEngine();
  }
  return proactiveEngineInstance;
}
