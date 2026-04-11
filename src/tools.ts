/**
 * Containerized tools with Docker sandboxing
 * TypeScript equivalent of Python tools.py
 */

import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { DockerSandbox } from './sandbox';
import { SafetyMiddleware, FallbackSafetyMode } from './safety';
import { CommandResult, FileResult, SandboxConfig } from './types';
import { getLogger } from './logger';

const execAsync = promisify(execCallback);
const logger = getLogger();

export class ShellTool {
  projectRoot: string;
  safety: SafetyMiddleware;
  sandbox: DockerSandbox | null;
  fallback: FallbackSafetyMode | null;
  private usingDocker: boolean;

  constructor(
    projectRoot: string,
    useDocker: boolean = true,
    safety?: SafetyMiddleware,
    fallbackConfirmed: boolean = false
  ) {
    this.projectRoot = path.resolve(projectRoot);
    this.safety = safety || new SafetyMiddleware();
    this.sandbox = null;
    this.fallback = null;
    this.usingDocker = false;

    // Ensure project directory exists
    if (!fs.existsSync(this.projectRoot)) {
      fs.mkdirSync(this.projectRoot, { recursive: true });
    }

    if (useDocker) {
      this.sandbox = new DockerSandbox({
        image: 'alpine:latest',
        memory_limit: '512m',
        cpu_limit: 0.5,
        auto_remove: true,
      });
    } else {
      this.initFallback(fallbackConfirmed);
    }
  }

  /**
   * Initialize Docker sandbox
   */
  async init(): Promise<boolean> {
    if (this.sandbox) {
      const available = await this.sandbox.checkAvailability();
      if (available) {
        const started = await this.sandbox.start(this.projectRoot);
        if (started) {
          this.usingDocker = true;
          logger.info('Using Docker sandbox');
          return true;
        }
      }
      logger.warn('Docker available but sandbox start failed');
    }
    
    this.initFallback(false);
    return false;
  }

  private initFallback(confirmed: boolean): void {
    this.fallback = new FallbackSafetyMode(this.safety, confirmed);
    logger.warn('Docker unavailable - using strict safety fallback');
  }

  /**
   * Check if running in sandbox
   */
  get isSandboxed(): boolean {
    return this.usingDocker && this.sandbox !== null;
  }

  /**
   * Execute command in sandbox or fallback
   */
  async run(command: string, timeout: number = 60): Promise<CommandResult> {
    if (this.isSandboxed && this.sandbox) {
      // Docker sandboxed execution
      try {
        const result = await this.sandbox.exec(command);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          returncode: result.exit_code,
          sandboxed: true,
        };
      } catch (error: any) {
        return {
          stdout: '',
          stderr: `Sandbox error: ${error.message}`,
          returncode: -1,
          sandboxed: true,
        };
      }
    } else if (this.fallback) {
      // Strict safety fallback
      const allowed = this.fallback.check(command);
      
      if (!allowed.allowed) {
        // Try to get explicit confirmation
        if (this.fallback.promptConfirmation(command)) {
          // Proceed with execution
        } else {
          return {
            stdout: '',
            stderr: `STRICT SAFETY BLOCKED: ${allowed.reason}`,
            returncode: -1,
            sandboxed: false,
          };
        }
      }

      // Execute with basic subprocess
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: this.projectRoot,
          timeout: timeout * 1000,
        });
        return {
          stdout: stdout || '',
          stderr: stderr || '',
          returncode: 0,
          sandboxed: false,
        };
      } catch (error: any) {
        return {
          stdout: '',
          stderr: error.stderr || error.message,
          returncode: error.code || -1,
          sandboxed: false,
        };
      }
    }

    return {
      stdout: '',
      stderr: 'No execution method available',
      returncode: -1,
      sandboxed: false,
    };
  }

  /**
   * Cleanup sandbox resources
   */
  async stop(): Promise<void> {
    if (this.sandbox) {
      await this.sandbox.stop();
    }
  }
}

/**
 * RAG-based semantic search over codebase memory
 */
export class SearchMemoryTool {
  private memory: any; // RAGMemory type would be imported

  constructor(memory: any) {
    this.memory = memory;
  }

  searchCodebase(query: string, k: number = 5): string {
    if (!this.memory.available) {
      return '[Memory unavailable - RAG system offline]';
    }
    return this.memory.search(query, k);
  }

  getStats(): Record<string, any> {
    return this.memory.getStats();
  }
}

/**
 * Sandboxed filesystem operations
 */
export class FileSystemTool {
  root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }
  }

  /**
   * Validate path is within root (prevents path traversal)
   */
  private validate(targetPath: string): string {
    const target = path.resolve(this.root, targetPath);
    const realRoot = fs.realpathSync(this.root);
    // Resolve symlinks to prevent traversal via symlinks
    let realTarget: string;
    try {
      realTarget = fs.realpathSync(target);
    } catch {
      // File may not exist yet (for write), check parent
      const parent = path.dirname(target);
      try {
        const realParent = fs.realpathSync(parent);
        if (!realParent.startsWith(realRoot)) {
          throw new Error(`Access denied: ${targetPath} outside project root`);
        }
      } catch {
        // Parent doesn't exist either, just check resolved path
        if (!target.startsWith(realRoot)) {
          throw new Error(`Access denied: ${targetPath} outside project root`);
        }
      }
      return target;
    }
    if (!realTarget.startsWith(realRoot)) {
      throw new Error(`Access denied: ${targetPath} outside project root`);
    }
    return realTarget;
  }

  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private static readonly MAX_DIR_ENTRIES = 5000;

  /**
   * Read file contents
   */
  read(filePath: string, limit?: number): FileResult {
    try {
      const target = this.validate(filePath);
      if (!fs.existsSync(target)) {
        return { success: false, error: `Not found: ${filePath}` };
      }
      const stat = fs.statSync(target);
      if (!stat.isFile()) {
        return { success: false, error: `Not a file: ${filePath}` };
      }
      if (stat.size > FileSystemTool.MAX_FILE_SIZE) {
        return { success: false, error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB > 10MB limit)` };
      }

      let content = fs.readFileSync(target, 'utf-8');
      if (limit && content.length > limit) {
        content = content.slice(0, limit) + `\n... (${content.length - limit} more)`;
      }
      return { success: true, content };
    } catch (error: any) {
      if (error.message.includes('Access denied')) {
        return { success: false, error: error.message };
      }
      return { success: false, error: `Read error: ${error.message}` };
    }
  }

  /**
   * Write file contents
   */
  write(filePath: string, content: string): FileResult {
    try {
      const target = this.validate(filePath);
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(target, content, 'utf-8');
      return { success: true };
    } catch (error: any) {
      if (error.message.includes('Access denied')) {
        return { success: false, error: error.message };
      }
      return { success: false, error: `Write error: ${error.message}` };
    }
  }

  /**
   * List directory contents
   */
  listDir(dirPath: string = '.'): FileResult {
    try {
      const target = this.validate(dirPath);
      if (!fs.existsSync(target)) {
        return { success: false, error: `Not found: ${dirPath}` };
      }
      if (!fs.statSync(target).isDirectory()) {
        return { success: false, error: `Not a directory: ${dirPath}` };
      }

      const entries = fs.readdirSync(target);
      if (entries.length > FileSystemTool.MAX_DIR_ENTRIES) {
        return { success: false, error: `Directory has ${entries.length} entries (limit: ${FileSystemTool.MAX_DIR_ENTRIES})` };
      }
      const formatted = entries.map(e => {
        const fullPath = path.join(target, e);
        const isDir = fs.statSync(fullPath).isDirectory();
        return `${isDir ? '[dir]' : '[file]'} ${e}`;
      });

      return { success: true, content: formatted.sort().join('\n') };
    } catch (error: any) {
      if (error.message.includes('Access denied')) {
        return { success: false, error: error.message };
      }
      return { success: false, error: `List error: ${error.message}` };
    }
  }
}
