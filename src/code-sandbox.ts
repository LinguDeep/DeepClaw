/**
 * Code Sandbox - Execute Python/JavaScript/TypeScript code safely in Docker
 * 
 * Core capabilities:
 * - Execute code in isolated Docker containers
 * - Support for Python, JavaScript, TypeScript, and Shell
 * - Memory and CPU limits for safety
 * - Timeout enforcement
 * - Output capture (stdout, stderr, files)
 * - Fallback to local execution with safety checks
 */

import { getLogger } from './logger';
import fs from 'fs';
import path from 'path';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execCallback);
const logger = getLogger();

// ==================== Types ====================

export type SandboxLanguage = 'python' | 'javascript' | 'typescript' | 'shell';

export interface CodeExecRequest {
  language: SandboxLanguage;
  code: string;
  timeout?: number; // seconds, default 30
  stdin?: string;
  env?: Record<string, string>;
  workDir?: string;
  packages?: string[]; // pip/npm packages to install before execution
}

export interface CodeExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number; // milliseconds
  sandboxed: boolean;
  language: SandboxLanguage;
  error?: string;
  files?: { name: string; content: string }[]; // output files
}

interface LanguageConfig {
  dockerImage: string;
  fileExtension: string;
  runCommand: (filePath: string) => string;
  installCommand?: (packages: string[]) => string;
}

// ==================== Language Configs ====================

const LANGUAGE_CONFIGS: Record<SandboxLanguage, LanguageConfig> = {
  python: {
    dockerImage: 'python:3.12-slim',
    fileExtension: '.py',
    runCommand: (f) => `python3 ${f}`,
    installCommand: (pkgs) => `pip install --quiet ${pkgs.join(' ')}`,
  },
  javascript: {
    dockerImage: 'node:20-slim',
    fileExtension: '.js',
    runCommand: (f) => `node ${f}`,
    installCommand: (pkgs) => `npm install --silent ${pkgs.join(' ')}`,
  },
  typescript: {
    dockerImage: 'node:20-slim',
    fileExtension: '.ts',
    runCommand: (f) => `npx tsx ${f}`,
    installCommand: (pkgs) => `npm install --silent tsx ${pkgs.join(' ')}`,
  },
  shell: {
    dockerImage: 'alpine:latest',
    fileExtension: '.sh',
    runCommand: (f) => `sh ${f}`,
  },
};

// Dangerous patterns to block in local execution
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+[\/~]/i,
  /mkfs/i,
  /dd\s+if=/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}/,  // fork bomb
  />\s*\/dev\/sd/i,
  /chmod\s+777\s+\//i,
  /curl.*\|\s*sh/i,
  /wget.*\|\s*sh/i,
  /eval\s*\(\s*(?:require|import)/i,
  /process\.exit/i,
  /os\.system\s*\(\s*['"]rm/i,
  /shutil\.rmtree\s*\(\s*['"]\//i,
  /import\s+subprocess.*Popen/i,
  /__import__\s*\(\s*['"]os['"]\)/i,
];

// ==================== Code Sandbox ====================

export class CodeSandbox {
  private dockerAvailable: boolean = false;
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(process.env.HOME || '/tmp', '.linguclaw', 'sandbox-tmp');
    this.ensureDir(this.tempDir);
  }

  /**
   * Initialize and check Docker availability
   */
  async init(): Promise<boolean> {
    try {
      const Docker = require('dockerode');
      const docker = new Docker();
      await docker.ping();
      this.dockerAvailable = true;
      logger.info('[CodeSandbox] Docker available — full isolation enabled');
      return true;
    } catch (e: any) {
      this.dockerAvailable = false;
      logger.warn('[CodeSandbox] Docker unavailable — using restricted local execution');
      return false;
    }
  }

  get isDockerAvailable(): boolean {
    return this.dockerAvailable;
  }

  /**
   * Execute code in sandbox
   */
  async execute(request: CodeExecRequest): Promise<CodeExecResult> {
    const startTime = Date.now();
    const timeout = (request.timeout || 30) * 1000;
    const langConfig = LANGUAGE_CONFIGS[request.language];

    if (!langConfig) {
      return {
        success: false,
        stdout: '',
        stderr: `Unsupported language: ${request.language}`,
        exitCode: 1,
        executionTime: 0,
        sandboxed: false,
        language: request.language,
        error: `Unsupported language: ${request.language}`,
      };
    }

    logger.info(`[CodeSandbox] Executing ${request.language} code (${request.code.length} chars)`);

    if (this.dockerAvailable) {
      return this.executeInDocker(request, langConfig, timeout, startTime);
    } else {
      return this.executeLocally(request, langConfig, timeout, startTime);
    }
  }

  /**
   * Execute code in Docker container
   */
  private async executeInDocker(
    request: CodeExecRequest,
    langConfig: LanguageConfig,
    timeout: number,
    startTime: number
  ): Promise<CodeExecResult> {
    const Docker = require('dockerode');
    const docker = new Docker();
    const fileName = `code_${Date.now()}${langConfig.fileExtension}`;
    const containerWorkDir = '/workspace';
    const filePath = `${containerWorkDir}/${fileName}`;

    // Write code to temp file for mounting
    const hostFilePath = path.join(this.tempDir, fileName);
    fs.writeFileSync(hostFilePath, request.code, 'utf-8');

    let container: any = null;

    try {
      // Build command
      let cmd = '';
      if (request.packages?.length && langConfig.installCommand) {
        cmd += langConfig.installCommand(request.packages) + ' && ';
      }
      cmd += langConfig.runCommand(filePath);

      // Create container
      container = await docker.createContainer({
        Image: langConfig.dockerImage,
        Cmd: ['sh', '-c', cmd],
        WorkingDir: containerWorkDir,
        HostConfig: {
          AutoRemove: true,
          Memory: 256 * 1024 * 1024, // 256MB
          CpuQuota: 50000, // 50% of one CPU
          CpuPeriod: 100000,
          NetworkMode: 'none', // No network access
          ReadonlyRootfs: false, // Need write for pip/npm
          Binds: [`${this.tempDir}:${containerWorkDir}:rw`],
        },
        Env: Object.entries(request.env || {}).map(([k, v]) => `${k}=${v}`),
      });

      await container.start();

      // Wait with timeout
      const result = await Promise.race<{ StatusCode: number }>([
        container.wait(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Execution timed out')), timeout)
        ),
      ]);

      // Collect logs
      const logs = await container.logs({ stdout: true, stderr: true, follow: false });
      const output = this.parseDockerLogs(logs);

      // Clean up temp file
      this.safeDelete(hostFilePath);

      return {
        success: result.StatusCode === 0,
        stdout: output.stdout.substring(0, 50000),
        stderr: output.stderr.substring(0, 10000),
        exitCode: result.StatusCode,
        executionTime: Date.now() - startTime,
        sandboxed: true,
        language: request.language,
      };
    } catch (error: any) {
      // Clean up on error
      this.safeDelete(hostFilePath);
      if (container) {
        try { await container.stop({ t: 1 }); } catch { /* already stopped */ }
      }

      const isTimeout = error.message?.includes('timed out');
      return {
        success: false,
        stdout: '',
        stderr: isTimeout ? 'Execution timed out' : error.message,
        exitCode: isTimeout ? 124 : 1,
        executionTime: Date.now() - startTime,
        sandboxed: true,
        language: request.language,
        error: error.message,
      };
    }
  }

  /**
   * Execute code locally with safety restrictions (fallback when Docker unavailable)
   */
  private async executeLocally(
    request: CodeExecRequest,
    langConfig: LanguageConfig,
    timeout: number,
    startTime: number
  ): Promise<CodeExecResult> {
    // Safety check: scan for dangerous patterns
    const safetyCheck = this.checkCodeSafety(request.code, request.language);
    if (!safetyCheck.safe) {
      return {
        success: false,
        stdout: '',
        stderr: `Code blocked by safety check: ${safetyCheck.reason}`,
        exitCode: 1,
        executionTime: 0,
        sandboxed: false,
        language: request.language,
        error: `Safety violation: ${safetyCheck.reason}`,
      };
    }

    const fileName = `code_${Date.now()}${langConfig.fileExtension}`;
    const filePath = path.join(this.tempDir, fileName);
    fs.writeFileSync(filePath, request.code, 'utf-8');

    try {
      let cmd = '';
      if (request.packages?.length && langConfig.installCommand) {
        cmd += langConfig.installCommand(request.packages) + ' && ';
      }
      cmd += langConfig.runCommand(filePath);

      const { stdout, stderr } = await Promise.race<{ stdout: string; stderr: string }>([
        execAsync(cmd, {
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          cwd: request.workDir || this.tempDir,
          env: { ...process.env, ...request.env },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Execution timed out')), timeout)
        ),
      ]);

      this.safeDelete(filePath);

      return {
        success: true,
        stdout: stdout.substring(0, 50000),
        stderr: stderr.substring(0, 10000),
        exitCode: 0,
        executionTime: Date.now() - startTime,
        sandboxed: false,
        language: request.language,
      };
    } catch (error: any) {
      this.safeDelete(filePath);

      return {
        success: false,
        stdout: error.stdout?.substring(0, 50000) || '',
        stderr: error.stderr?.substring(0, 10000) || error.message,
        exitCode: error.code || 1,
        executionTime: Date.now() - startTime,
        sandboxed: false,
        language: request.language,
        error: error.message,
      };
    }
  }

  /**
   * Check code for dangerous patterns
   */
  private checkCodeSafety(code: string, language: SandboxLanguage): { safe: boolean; reason?: string } {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        return { safe: false, reason: `Matches dangerous pattern: ${pattern.source}` };
      }
    }

    // Language-specific checks
    if (language === 'python') {
      if (/exec\s*\(.*(?:import|__builtins__)/.test(code)) {
        return { safe: false, reason: 'Dynamic exec with imports blocked' };
      }
    }

    if (language === 'shell') {
      if (/>\s*\/etc\//.test(code) || />\s*\/usr\//.test(code)) {
        return { safe: false, reason: 'Writing to system directories blocked' };
      }
    }

    return { safe: true };
  }

  /**
   * Parse Docker container logs into stdout/stderr
   */
  private parseDockerLogs(logs: Buffer | string): { stdout: string; stderr: string } {
    if (typeof logs === 'string') {
      return { stdout: logs, stderr: '' };
    }

    let stdout = '';
    let stderr = '';
    let offset = 0;
    const buf = Buffer.isBuffer(logs) ? logs : Buffer.from(logs);

    while (offset < buf.length) {
      if (offset + 8 > buf.length) break;
      const streamType = buf.readUInt8(offset);
      const size = buf.readUInt32BE(offset + 4);
      if (offset + 8 + size > buf.length) break;
      const payload = buf.slice(offset + 8, offset + 8 + size).toString('utf-8');

      if (streamType === 1) stdout += payload;
      else if (streamType === 2) stderr += payload;

      offset += 8 + size;
    }

    // Fallback if header parsing fails
    if (!stdout && !stderr) {
      return { stdout: buf.toString('utf-8'), stderr: '' };
    }

    return { stdout, stderr };
  }

  /**
   * Get available languages and their status
   */
  async getAvailableLanguages(): Promise<Record<SandboxLanguage, { available: boolean; runtime: string }>> {
    const result: Record<string, { available: boolean; runtime: string }> = {};

    for (const [lang, config] of Object.entries(LANGUAGE_CONFIGS)) {
      if (this.dockerAvailable) {
        result[lang] = { available: true, runtime: `Docker (${config.dockerImage})` };
      } else {
        // Check if local runtime exists
        try {
          const cmd = lang === 'python' ? 'python3 --version' :
                      lang === 'javascript' ? 'node --version' :
                      lang === 'typescript' ? 'npx tsx --version' :
                      'sh --version';
          const { stdout } = await execAsync(cmd, { timeout: 5000 });
          result[lang] = { available: true, runtime: `Local (${stdout.trim()})` };
        } catch {
          result[lang] = { available: false, runtime: 'Not installed' };
        }
      }
    }

    return result as Record<SandboxLanguage, { available: boolean; runtime: string }>;
  }

  /**
   * Utility: ensure directory exists
   */
  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Utility: safely delete a file
   */
  private safeDelete(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }
}
