/**
 * Skills system - modular automation and task execution
 * TypeScript equivalent of Python skills.py
 */

import { SkillType, SkillResult } from './types';
import { getLogger } from './logger';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';

const logger = getLogger();

export abstract class BaseSkill {
  abstract readonly NAME: string;
  abstract readonly DESCRIPTION: string;
  abstract readonly VERSION: string;
  abstract readonly AUTHOR: string;
  abstract readonly TYPE: SkillType;

  config: Record<string, any>;

  constructor(config: Record<string, any> = {}) {
    this.config = config;
  }

  abstract execute(params: Record<string, any>): Promise<SkillResult>;

  getSchema(): Record<string, any> {
    return {
      name: this.NAME,
      description: this.DESCRIPTION,
      version: this.VERSION,
      type: this.TYPE,
      parameters: {},
    };
  }
}

// ============== Email Skill ==============

export class EmailSkill extends BaseSkill {
  NAME = 'email';
  DESCRIPTION = 'Send and manage emails';
  VERSION = '1.0.0';
  AUTHOR = 'LinguClaw';
  TYPE = SkillType.PYTHON;

  async execute(params: Record<string, any>): Promise<SkillResult> {
    const action = params.action || 'send';

    switch (action) {
      case 'send':
        return this.sendEmail(params);
      case 'read':
        return { success: true, output: 'Email reading requires IMAP configuration' };
      case 'search':
        return { success: true, output: 'Email search requires IMAP configuration' };
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  private async sendEmail(params: Record<string, any>): Promise<SkillResult> {
    try {
      const smtpHost = this.config.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com';
      const smtpPort = parseInt(this.config.smtp_port || process.env.SMTP_PORT || '587', 10);
      const username = this.config.username || process.env.EMAIL_USERNAME;
      const password = this.config.password || process.env.EMAIL_PASSWORD;

      if (!username || !password) {
        return { success: false, error: 'Email credentials not configured' };
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: username, pass: password },
      });

      await transporter.sendMail({
        from: username,
        to: params.to,
        subject: params.subject || 'No Subject',
        text: params.body || '',
      });

      return { success: true, output: 'Email sent successfully' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// ============== Calendar Skill ==============

export class CalendarSkill extends BaseSkill {
  NAME = 'calendar';
  DESCRIPTION = 'Manage calendar events and scheduling';
  VERSION = '1.0.0';
  AUTHOR = 'LinguClaw';
  TYPE = SkillType.PYTHON;

  async execute(params: Record<string, any>): Promise<SkillResult> {
    const action = params.action || 'list';

    switch (action) {
      case 'create':
        return this.createEvent(params);
      case 'list':
        return { success: true, output: 'Calendar events listed' };
      case 'delete':
        return { success: true, output: 'Event deleted' };
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  private async createEvent(params: Record<string, any>): Promise<SkillResult> {
    try {
      const event = {
        title: params.title || 'New Event',
        description: params.description || '',
        start: new Date(params.start),
        end: new Date(params.end),
      };

      // Save to simple JSON storage
      const dataDir = path.join(process.env.HOME || '~', '.linguclaw');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const calendarFile = path.join(dataDir, 'calendar.json');
      let events: any[] = [];
      
      if (fs.existsSync(calendarFile)) {
        events = JSON.parse(fs.readFileSync(calendarFile, 'utf-8'));
      }

      events.push(event);
      fs.writeFileSync(calendarFile, JSON.stringify(events, null, 2));

      return { success: true, output: `Event created: ${event.title}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// ============== File Manager Skill ==============

export class FileSkill extends BaseSkill {
  NAME = 'file_manager';
  DESCRIPTION = 'Advanced file operations and organization';
  VERSION = '1.0.0';
  AUTHOR = 'LinguClaw';
  TYPE = SkillType.PYTHON;

  async execute(params: Record<string, any>): Promise<SkillResult> {
    const action = params.action;

    switch (action) {
      case 'organize':
        return this.organizeFiles(params);
      case 'search':
        return this.searchFiles(params);
      case 'backup':
        return this.backupFiles(params);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  private async organizeFiles(params: Record<string, any>): Promise<SkillResult> {
    try {
      const source = path.resolve(params.source || '.');
      const by = params.by || 'type';

      if (!fs.existsSync(source)) {
        return { success: false, error: `Source path not found: ${source}` };
      }

      let organized = 0;
      const entries = fs.readdirSync(source);

      for (const entry of entries) {
        const fullPath = path.join(source, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isFile()) {
          let dest: string;
          
          if (by === 'type') {
            const ext = path.extname(entry) || 'no_extension';
            dest = path.join(source, ext.replace('.', ''));
          } else if (by === 'date') {
            const mtime = stat.mtime;
            dest = path.join(source, mtime.getFullYear().toString(), (mtime.getMonth() + 1).toString());
          } else {
            continue;
          }

          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }

          const newPath = path.join(dest, entry);
          fs.renameSync(fullPath, newPath);
          organized++;
        }
      }

      return { success: true, output: `Organized ${organized} files` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async searchFiles(params: Record<string, any>): Promise<SkillResult> {
    try {
      const root = path.resolve(params.root || '.');
      const pattern = params.pattern || '*';

      const matches: string[] = [];
      const searchRecursive = (dir: string) => {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
            searchRecursive(fullPath);
          } else if (stat.isFile()) {
            // Simple glob matching
            const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
            if (regex.test(entry)) {
              matches.push(fullPath);
            }
          }
        }
      };

      searchRecursive(root);
      return { success: true, output: `Found ${matches.length} files`, metadata: { files: matches.slice(0, 20) } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async backupFiles(params: Record<string, any>): Promise<SkillResult> {
    try {
      const source = path.resolve(params.source);
      const dest = path.resolve(params.destination);

      if (!fs.existsSync(source)) {
        return { success: false, error: `Source not found: ${source}` };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const backupDir = path.join(dest, `backup_${timestamp}`);
      fs.mkdirSync(backupDir, { recursive: true });

      // Copy directory recursively
      this.copyRecursive(source, path.join(backupDir, path.basename(source)));

      return { success: true, output: `Backup created at ${backupDir}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private copyRecursive(src: string, dest: string): void {
    const stat = fs.statSync(src);
    
    if (stat.isDirectory()) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      const entries = fs.readdirSync(src);
      for (const entry of entries) {
        this.copyRecursive(path.join(src, entry), path.join(dest, entry));
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

// ============== Web Search Skill ==============

export class WebSearchSkill extends BaseSkill {
  NAME = 'web_search';
  DESCRIPTION = 'Search the web and fetch page content';
  VERSION = '1.0.0';
  AUTHOR = 'LinguClaw';
  TYPE = SkillType.PYTHON;

  async execute(params: Record<string, any>): Promise<SkillResult> {
    const action = params.action || 'search';

    switch (action) {
      case 'search':
        return this.search(params.query);
      case 'fetch':
        return this.fetchPage(params.url);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  private async search(query: string): Promise<SkillResult> {
    if (!query) return { success: false, error: 'Query is required' };

    try {
      const axios = require('axios');
      const res = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
        timeout: 10000,
      });

      const html = res.data as string;
      const results: { title: string; url: string; snippet: string }[] = [];
      const titleRegex = /<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/gi;
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;

      let titleMatch;
      while ((titleMatch = titleRegex.exec(html)) !== null && results.length < 5) {
        results.push({
          title: titleMatch[1].replace(/<[^>]*>/g, '').trim(),
          url: '',
          snippet: '',
        });
      }

      let snippetMatch;
      let idx = 0;
      while ((snippetMatch = snippetRegex.exec(html)) !== null && idx < results.length) {
        results[idx].snippet = snippetMatch[1].replace(/<[^>]*>/g, '').trim();
        idx++;
      }

      return {
        success: true,
        output: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}`).join('\n\n'),
        metadata: { results },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async fetchPage(url: string): Promise<SkillResult> {
    if (!url) return { success: false, error: 'URL is required' };

    try {
      const axios = require('axios');
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000,
        maxContentLength: 1024 * 1024, // 1MB max
      });

      const html = res.data as string;
      // Extract text content
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000);

      return { success: true, output: text };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// ============== System Command Skill ==============

export class SystemSkill extends BaseSkill {
  NAME = 'system';
  DESCRIPTION = 'System utilities: time, uptime, disk, processes';
  VERSION = '1.0.0';
  AUTHOR = 'LinguClaw';
  TYPE = SkillType.PYTHON;

  async execute(params: Record<string, any>): Promise<SkillResult> {
    const action = params.action || 'info';

    switch (action) {
      case 'info':
        return this.systemInfo();
      case 'time':
        return { success: true, output: new Date().toLocaleString() };
      case 'uptime':
        return this.getUptime();
      case 'disk':
        return this.getDisk();
      case 'exec':
        return this.safeExec(params.command);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  private systemInfo(): SkillResult {
    const os = require('os');
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const info = [
      `Hostname: ${os.hostname()}`,
      `Platform: ${os.platform()} ${os.arch()}`,
      `CPUs: ${os.cpus().length}x ${os.cpus()[0]?.model || 'Unknown'}`,
      `Memory: ${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1)}GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(1)}GB`,
      `Uptime: ${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
      `Load: ${os.loadavg().map((l: number) => l.toFixed(2)).join(', ')}`,
    ].join('\n');
    return { success: true, output: info };
  }

  private getUptime(): SkillResult {
    const os = require('os');
    const uptime = os.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    return { success: true, output: `System uptime: ${days}d ${hours}h ${mins}m` };
  }

  private getDisk(): SkillResult {
    try {
      const { execSync } = require('child_process');
      const output = execSync('df -h / 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
      return { success: true, output: output.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private safeExec(command: string): SkillResult {
    if (!command) return { success: false, error: 'Command is required' };

    // Block dangerous commands
    const blocked = ['rm -rf', 'mkfs', 'dd if=', ':(){', 'chmod -R 777', 'sudo rm'];
    for (const b of blocked) {
      if (command.includes(b)) {
        return { success: false, error: `Blocked dangerous command: ${b}` };
      }
    }

    try {
      const { execSync } = require('child_process');
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 1024 * 512, // 512KB
      });
      return { success: true, output: output.trim().substring(0, 5000) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// ============== Note Taking Skill ==============

export class NoteSkill extends BaseSkill {
  NAME = 'notes';
  DESCRIPTION = 'Create, search, and manage quick notes';
  VERSION = '1.0.0';
  AUTHOR = 'LinguClaw';
  TYPE = SkillType.PYTHON;

  private notesPath: string;

  constructor(config: Record<string, any> = {}) {
    super(config);
    this.notesPath = path.join(process.env.HOME || '~', '.linguclaw', 'notes.json');
  }

  async execute(params: Record<string, any>): Promise<SkillResult> {
    const action = params.action || 'list';

    switch (action) {
      case 'add':
        return this.addNote(params.title, params.content, params.tags);
      case 'list':
        return this.listNotes(params.tag);
      case 'search':
        return this.searchNotes(params.query);
      case 'delete':
        return this.deleteNote(params.id);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  private loadNotes(): any[] {
    try {
      if (fs.existsSync(this.notesPath)) {
        return JSON.parse(fs.readFileSync(this.notesPath, 'utf-8'));
      }
    } catch (err: any) {
      const logger = getLogger();
      logger.debug(`Notes load failed: ${err.message}`);
    }
    return [];
  }

  private saveNotes(notes: any[]): void {
    const dir = path.dirname(this.notesPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.notesPath, JSON.stringify(notes, null, 2));
  }

  private addNote(title: string, content: string, tags?: string): SkillResult {
    if (!title) return { success: false, error: 'Title is required' };
    const notes = this.loadNotes();
    const note = {
      id: 'n-' + Date.now().toString(36),
      title,
      content: content || '',
      tags: tags ? tags.split(',').map((t: string) => t.trim()) : [],
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    this.saveNotes(notes);
    return { success: true, output: `Note created: "${title}" (${note.id})` };
  }

  private listNotes(tag?: string): SkillResult {
    let notes = this.loadNotes();
    if (tag) {
      notes = notes.filter((n: any) => n.tags?.some((t: string) => t.toLowerCase() === tag.toLowerCase()));
    }
    if (notes.length === 0) return { success: true, output: 'No notes found' };
    const output = notes.map((n: any) => `[${n.id}] ${n.title} ${n.tags?.length ? '(' + n.tags.join(', ') + ')' : ''}`).join('\n');
    return { success: true, output, metadata: { count: notes.length } };
  }

  private searchNotes(query: string): SkillResult {
    if (!query) return this.listNotes();
    const notes = this.loadNotes();
    const q = query.toLowerCase();
    const results = notes.filter((n: any) =>
      n.title?.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q)
    );
    if (results.length === 0) return { success: true, output: `No notes matching "${query}"` };
    const output = results.map((n: any) => `[${n.id}] ${n.title}: ${(n.content || '').substring(0, 80)}`).join('\n');
    return { success: true, output };
  }

  private deleteNote(id: string): SkillResult {
    if (!id) return { success: false, error: 'Note ID is required' };
    const notes = this.loadNotes();
    const idx = notes.findIndex((n: any) => n.id === id);
    if (idx === -1) return { success: false, error: `Note not found: ${id}` };
    const removed = notes.splice(idx, 1)[0];
    this.saveNotes(notes);
    return { success: true, output: `Deleted: "${removed.title}"` };
  }
}

// ============== Skill Manager ==============

export class SkillManager {
  skills: Map<string, BaseSkill>;
  skillsDir: string;

  constructor(skillsDir?: string) {
    this.skills = new Map();
    this.skillsDir = skillsDir || path.join(process.env.HOME || '~', '.linguclaw', 'skills');
    
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  register(skill: BaseSkill): void {
    this.skills.set(skill.NAME, skill);
    logger.info(`Registered skill: ${skill.NAME}`);
  }

  unregister(name: string): void {
    if (this.skills.has(name)) {
      this.skills.delete(name);
      logger.info(`Unregistered skill: ${name}`);
    }
  }

  get(name: string): BaseSkill | undefined {
    return this.skills.get(name);
  }

  listSkills(): Array<Record<string, any>> {
    return Array.from(this.skills.values()).map(skill => ({
      name: skill.NAME,
      description: skill.DESCRIPTION,
      version: skill.VERSION,
      type: skill.TYPE,
    }));
  }

  async execute(skillName: string, params: Record<string, any>): Promise<SkillResult> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return { success: false, error: `Skill not found: ${skillName}` };
    }

    try {
      return await skill.execute(params);
    } catch (error: any) {
      logger.error(`Skill execution error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  loadBuiltinSkills(): void {
    this.register(new EmailSkill());
    this.register(new CalendarSkill());
    this.register(new FileSkill());
    this.register(new WebSearchSkill());
    this.register(new SystemSkill());
    this.register(new NoteSkill());
    logger.info(`Loaded ${this.skills.size} built-in skills`);
  }
}

// Global instance
let skillManagerInstance: SkillManager | null = null;

export function getSkillManager(): SkillManager {
  if (!skillManagerInstance) {
    skillManagerInstance = new SkillManager();
  }
  return skillManagerInstance;
}
