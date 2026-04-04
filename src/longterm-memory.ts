/**
 * Long-term memory system - persistent storage
 * TypeScript equivalent of Python longterm_memory.py
 */

import Database from 'better-sqlite3';
import path from 'path';
import { MemoryEntry } from './types';
import { getLogger } from './logger';

const logger = getLogger();

export class LongTermMemory {
  dbPath: string;
  private db: Database.Database | null;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.env.HOME || '~', '.linguclaw', 'memory.db');
    this.db = null;
    this.init();
  }

  private init(): void {
    try {
      const dir = path.dirname(this.dbPath);
      if (!require('fs').existsSync(dir)) {
        require('fs').mkdirSync(dir, { recursive: true });
      }

      this.db = new Database(this.dbPath);
      this.createTable();
    } catch (error) {
      logger.error(`Failed to initialize long-term memory: ${error}`);
    }
  }

  private createTable(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        timestamp TEXT NOT NULL,
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        expires_at TEXT
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_category ON memories(category)');
  }

  store(
    key: string,
    value: any,
    category: string = 'general',
    tags: string[] = [],
    ttlDays?: number
  ): boolean {
    try {
      if (!this.db) return false;

      const expiresAt = ttlDays
        ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const now = new Date().toISOString();

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO memories 
        (key, value, category, timestamp, access_count, last_accessed, tags, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        key,
        JSON.stringify(value),
        category,
        now,
        0,
        now,
        JSON.stringify(tags),
        expiresAt
      );

      logger.debug(`Stored memory: ${key} (${category})`);
      return true;
    } catch (error) {
      logger.error(`Failed to store memory: ${error}`);
      return false;
    }
  }

  retrieve(key: string): any | null {
    try {
      if (!this.db) return null;

      const row = this.db.prepare('SELECT value, expires_at FROM memories WHERE key = ?').get(key) as { value: string; expires_at?: string } | undefined;
      if (!row) return null;

      // Check expiration
      if (row.expires_at) {
        const expiresAt = new Date(row.expires_at);
        if (new Date() > expiresAt) {
          this.db.prepare('DELETE FROM memories WHERE key = ?').run(key);
          return null;
        }
      }

      // Update access stats
      this.db.prepare(`
        UPDATE memories 
        SET access_count = access_count + 1, last_accessed = ?
        WHERE key = ?
      `).run(new Date().toISOString(), key);

      return JSON.parse(row.value);
    } catch (error) {
      logger.error(`Failed to retrieve memory: ${error}`);
      return null;
    }
  }

  search(query: string, category?: string, limit: number = 10): Array<Record<string, any>> {
    try {
      if (!this.db) return [];

      let sql = 'SELECT key, value, category, timestamp, access_count FROM memories WHERE (key LIKE ? OR value LIKE ?)';
      const params = [`%${query}%`, `%${query}%`];

      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      sql += ' ORDER BY access_count DESC LIMIT ?';
      params.push(limit.toString());

      const rows = this.db.prepare(sql).all(...params);
      return rows.map((row: any) => ({
        key: row.key,
        value: JSON.parse(row.value),
        category: row.category,
        timestamp: row.timestamp,
        access_count: row.access_count,
      }));
    } catch (error) {
      logger.error(`Failed to search memories: ${error}`);
      return [];
    }
  }

  getByCategory(category: string, limit: number = 50): Array<Record<string, any>> {
    try {
      if (!this.db) return [];

      const rows = this.db.prepare(
        `SELECT key, value, timestamp, access_count FROM memories 
         WHERE category = ? ORDER BY last_accessed DESC LIMIT ?`
      ).all(category, limit);

      return rows.map((row: any) => ({
        key: row.key,
        value: JSON.parse(row.value),
        timestamp: row.timestamp,
        access_count: row.access_count,
      }));
    } catch (error) {
      logger.error(`Failed to get memories by category: ${error}`);
      return [];
    }
  }

  delete(key: string): boolean {
    try {
      if (!this.db) return false;
      const result = this.db.prepare('DELETE FROM memories WHERE key = ?').run(key);
      return result.changes > 0;
    } catch (error) {
      logger.error(`Failed to delete memory: ${error}`);
      return false;
    }
  }

  clearCategory(category: string): number {
    try {
      if (!this.db) return 0;
      const result = this.db.prepare('DELETE FROM memories WHERE category = ?').run(category);
      return result.changes;
    } catch (error) {
      logger.error(`Failed to clear category: ${error}`);
      return 0;
    }
  }

  getStats(): { total_entries: number; by_category: Record<string, number> } {
    try {
      if (!this.db) return { total_entries: 0, by_category: {} };

      const total = (this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as any).count;
      const categories: Record<string, number> = {};
      const rows = this.db.prepare('SELECT category, COUNT(*) as count FROM memories GROUP BY category').all() as any[];
      for (const row of rows) {
        categories[row.category] = row.count;
      }

      return { total_entries: total, by_category: categories };
    } catch (error) {
      logger.error(`Failed to get stats: ${error}`);
      return { total_entries: 0, by_category: {} };
    }
  }
}

// User Preferences
export class UserPreferences {
  private memory: LongTermMemory;

  constructor(memory?: LongTermMemory) {
    this.memory = memory || new LongTermMemory();
  }

  set(key: string, value: any): void {
    this.memory.store(`pref:${key}`, value, 'preferences');
  }

  get(key: string, defaultValue?: any): any {
    const value = this.memory.retrieve(`pref:${key}`);
    return value !== null ? value : defaultValue;
  }

  getAll(): Record<string, any> {
    const prefs = this.memory.getByCategory('preferences');
    const result: Record<string, any> = {};
    for (const p of prefs) {
      result[p.key.replace('pref:', '')] = p.value;
    }
    return result;
  }
}

// Conversation History
export class ConversationHistory {
  private memory: LongTermMemory;
  private maxHistory: number;

  constructor(memory?: LongTermMemory, maxHistory: number = 100) {
    this.memory = memory || new LongTermMemory();
    this.maxHistory = maxHistory;
  }

  add(conversationId: string, role: string, content: string, metadata?: Record<string, any>): void {
    const key = `conv:${conversationId}:${new Date().toISOString()}`;
    const entry = {
      role,
      content,
      timestamp: new Date().toISOString(),
      metadata: metadata || {},
    };
    this.memory.store(key, entry, 'conversations', [], 30); // 30 day TTL
  }

  getHistory(conversationId: string, limit: number = 20): Array<Record<string, any>> {
    const prefix = `conv:${conversationId}:`;
    const results = this.memory.search(prefix, 'conversations', limit);
    return results.map(r => r.value);
  }
}

// Workflow Memory
export class WorkflowMemory {
  private memory: LongTermMemory;

  constructor(memory?: LongTermMemory) {
    this.memory = memory || new LongTermMemory();
  }

  saveWorkflow(name: string, workflow: Record<string, any>): void {
    this.memory.store(`workflow:${name}`, workflow, 'workflows');
  }

  getWorkflow(name: string): Record<string, any> | null {
    return this.memory.retrieve(`workflow:${name}`);
  }

  listWorkflows(): string[] {
    const workflows = this.memory.getByCategory('workflows');
    return workflows.map(w => w.key.replace('workflow:', ''));
  }
}

// Global instances
let memoryInstance: LongTermMemory | null = null;

export function getMemory(): LongTermMemory {
  if (!memoryInstance) {
    memoryInstance = new LongTermMemory();
  }
  return memoryInstance;
}

export function getPreferences(): UserPreferences {
  return new UserPreferences(getMemory());
}

export function getConversationHistory(): ConversationHistory {
  return new ConversationHistory(getMemory());
}

export function getWorkflowMemory(): WorkflowMemory {
  return new WorkflowMemory(getMemory());
}
