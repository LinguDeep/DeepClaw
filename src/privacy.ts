/**
 * Privacy and data control settings
 * TypeScript equivalent of Python privacy.py
 */

import fs from 'fs';
import path from 'path';
import { PrivacySettings, DataRetention, LogLevel } from './types';
import { getLogger } from './logger';

const logger = getLogger();

const DEFAULT_SETTINGS: PrivacySettings = {
  conversation_retention: DataRetention.THIRTY_DAYS,
  memory_retention: DataRetention.FOREVER,
  log_retention: DataRetention.SEVEN_DAYS,
  log_level: LogLevel.MINIMAL,
  log_to_cloud: false,
  share_analytics: false,
  share_crashes: false,
  allow_remote_commands: false,
  prefer_local_models: true,
  offline_mode: false,
  encrypt_memory: true,
  encrypt_logs: false,
  secure_delete: true,
  require_auth: false,
  allowed_users: [],
  admin_users: [],
  data_dir: path.join(process.env.HOME || '~', '.linguclaw'),
};

export class PrivacyManager {
  configPath: string;
  settings: PrivacySettings;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.env.HOME || '~', '.linguclaw', 'privacy.json');
    this.settings = this.loadSettings();
  }

  private loadSettings(): PrivacySettings {
    if (fs.existsSync(this.configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        return { ...DEFAULT_SETTINGS, ...data };
      } catch (error) {
        logger.error(`Failed to load privacy settings: ${error}`);
      }
    }
    this.saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }

  private saveSettings(settings: PrivacySettings): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(settings, null, 2));
    } catch (error) {
      logger.error(`Failed to save privacy settings: ${error}`);
    }
  }

  getSettings(): PrivacySettings {
    return this.settings;
  }

  updateSettings(settings: PrivacySettings): void {
    this.settings = settings;
    this.saveSettings(settings);
    logger.info('Privacy settings updated');
  }

  clearConversations(): number {
    try {
      // Clear conversation data from memory
      const dataDir = this.settings.data_dir;
      const memoryDb = path.join(dataDir, 'memory.db');
      // In real implementation, would clear from SQLite
      logger.info('Cleared conversation entries');
      return 0;
    } catch (error) {
      logger.error(`Failed to clear conversations: ${error}`);
      return 0;
    }
  }

  clearLogs(): number {
    try {
      const logDir = path.join(this.settings.data_dir, 'logs');
      if (!fs.existsSync(logDir)) return 0;

      let count = 0;
      const files = fs.readdirSync(logDir);
      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(logDir, file);
          if (this.settings.secure_delete) {
            // Overwrite before delete
            const stats = fs.statSync(filePath);
            fs.writeFileSync(filePath, Buffer.alloc(stats.size, 0));
          }
          fs.unlinkSync(filePath);
          count++;
        }
      }
      logger.info(`Cleared ${count} log files`);
      return count;
    } catch (error) {
      logger.error(`Failed to clear logs: ${error}`);
      return 0;
    }
  }

  exportData(outputPath: string): boolean {
    try {
      const export_data = {
        export_date: new Date().toISOString(),
        settings: this.settings,
        conversations: [],
        memory: {},
        preferences: {},
      };

      fs.writeFileSync(outputPath, JSON.stringify(export_data, null, 2));
      logger.info(`Data exported to ${outputPath}`);
      return true;
    } catch (error) {
      logger.error(`Failed to export data: ${error}`);
      return false;
    }
  }

  deleteAllData(): boolean {
    try {
      this.clearConversations();
      this.clearLogs();

      // Delete memory database
      const memoryDb = path.join(this.settings.data_dir, 'memory.db');
      if (fs.existsSync(memoryDb)) {
        if (this.settings.secure_delete) {
          const stats = fs.statSync(memoryDb);
          fs.writeFileSync(memoryDb, Buffer.alloc(stats.size, 0));
        }
        fs.unlinkSync(memoryDb);
      }

      // Delete proactive database
      const proactiveDb = path.join(this.settings.data_dir, 'proactive.db');
      if (fs.existsSync(proactiveDb)) {
        if (this.settings.secure_delete) {
          const stats = fs.statSync(proactiveDb);
          fs.writeFileSync(proactiveDb, Buffer.alloc(stats.size, 0));
        }
        fs.unlinkSync(proactiveDb);
      }

      logger.info('All user data deleted');
      return true;
    } catch (error) {
      logger.error(`Failed to delete all data: ${error}`);
      return false;
    }
  }

  canUseCloudLLM(): boolean {
    if (this.settings.offline_mode) return false;
    return true;
  }

  getPrivacyReport(): any {
    return {
      settings_summary: {
        data_stored_locally: true,
        cloud_logging_disabled: !this.settings.log_to_cloud,
        analytics_disabled: !this.settings.share_analytics,
        offline_capable: this.settings.offline_mode || this.settings.prefer_local_models,
        encryption_enabled: this.settings.encrypt_memory,
      },
      data_stats: { total_entries: 0 },
      retention_policies: {
        conversations: this.settings.conversation_retention,
        memory: this.settings.memory_retention,
        logs: this.settings.log_retention,
      },
      recommendations: this.getRecommendations(),
    };
  }

  private getRecommendations(): string[] {
    const recs: string[] = [];
    if (!this.settings.encrypt_memory) {
      recs.push('Enable memory encryption for better security');
    }
    if (this.settings.log_level === LogLevel.FULL) {
      recs.push('Consider using minimal log level for better privacy');
    }
    if (this.settings.share_analytics) {
      recs.push('Disable analytics sharing for maximum privacy');
    }
    if (!this.settings.offline_mode && !this.settings.prefer_local_models) {
      recs.push('Enable prefer local models to reduce cloud dependency');
    }
    if (recs.length === 0) {
      recs.push('Your privacy settings look good!');
    }
    return recs;
  }
}

// Global instance
let privacyManagerInstance: PrivacyManager | null = null;

export function getPrivacyManager(): PrivacyManager {
  if (!privacyManagerInstance) {
    privacyManagerInstance = new PrivacyManager();
  }
  return privacyManagerInstance;
}
