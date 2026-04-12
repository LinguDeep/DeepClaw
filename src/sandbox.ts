/**
 * Docker sandbox management
 * TypeScript equivalent of Python sandbox.py using dockerode
 */

import Docker from 'dockerode';
import { SandboxConfig, SandboxExecResult } from './types';
import { getLogger } from './logger';

const logger = getLogger();

export class DockerSandbox {
  private docker: Docker;
  private config: SandboxConfig;
  private container: Docker.Container | null;
  public available: boolean;

  constructor(config: SandboxConfig) {
    this.docker = new Docker();
    this.config = config;
    this.container = null;
    this.available = false;
  }

  /**
   * Check if Docker is available and initialize
   */
  async checkAvailability(): Promise<boolean> {
    try {
      await this.docker.ping();
      this.available = true;
      return true;
    } catch (error) {
      this.available = false;
      logger.warn('Docker not available');
      return false;
    }
  }

  /**
   * Start the sandbox container
   */
  async start(projectRoot: string): Promise<boolean> {
    if (!this.available) {
      logger.error('Docker not available');
      return false;
    }

    try {
      // Create container with security constraints
      const createOptions: Docker.ContainerCreateOptions = {
        Image: this.config.image,
        Cmd: ['sh', '-c', 'while true; do sleep 3600; done'],
        HostConfig: {
          AutoRemove: this.config.auto_remove,
          Memory: this.parseMemoryLimit(this.config.memory_limit),
          CpuQuota: this.config.cpu_limit * 100000,
          CpuPeriod: 100000,
          ReadonlyRootfs: true,
          NetworkMode: this.config.network_disabled ? 'none' : 'bridge',
          Binds: [`${projectRoot}:/workspace:rw`],
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges:true'],
        },
        WorkingDir: '/workspace',
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      };

      this.container = await this.docker.createContainer(createOptions);
      await this.container.start();
      
      logger.info(`Docker sandbox started with ${this.config.memory_limit} RAM, ${this.config.cpu_limit} CPU`);
      return true;
    } catch (error: any) {
      logger.error(`Failed to start Docker sandbox: ${error.message}`);
      this.container = null;
      return false;
    }
  }

  /**
   * Execute command in sandbox
   */
  async exec(command: string): Promise<SandboxExecResult> {
    if (!this.container) {
      return { exit_code: -1, stdout: '', stderr: 'Container not running' };
    }

    try {
      const exec = await this.container.exec({
        Cmd: ['sh', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: '/workspace',
      });

      const stream = await exec.start({
        hijack: true,
        stdin: false,
      });

      let stdout = '';
      let stderr = '';

      // Collect output from stream
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          // Docker multiplexed stream format: header[8] + data
          // Stream type is in header[0]: 0=stdin, 1=stdout, 2=stderr
          if (chunk.length > 8) {
            const streamType = chunk[0];
            const data = chunk.slice(8).toString('utf-8');
            if (streamType === 1) {
              stdout += data;
            } else if (streamType === 2) {
              stderr += data;
            }
          }
        });

        stream.on('end', async () => {
          try {
            const inspect = await exec.inspect();
            resolve({
              exit_code: inspect.ExitCode || 0,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            });
          } catch (error) {
            reject(error);
          }
        });

        stream.on('error', (error: Error) => {
          reject(error);
        });
      });
    } catch (error: any) {
      logger.error(`Exec error: ${error.message}`);
      return { exit_code: -1, stdout: '', stderr: error.message };
    }
  }

  /**
   * Stop and remove the sandbox container
   */
  async stop(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop();
        logger.info('Docker sandbox stopped');
      } catch (error: any) {
        logger.warn(`Error stopping container: ${error.message}`);
      }
      this.container = null;
    }
  }

  /**
   * Parse memory limit string (e.g., "512m") to bytes
   */
  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)([kmg]?)b?$/i);
    if (!match) return 512 * 1024 * 1024; // Default 512MB

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 'k': return value * 1024;
      case 'm': return value * 1024 * 1024;
      case 'g': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }
}
