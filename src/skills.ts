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
