/**
 * DeepClaw Bridge - TypeScript Client
 * 
 * This module provides a WebSocket client that connects to the Rust engine
 * to execute high-performance operations like bash commands, file operations,
 * and git context retrieval.
 */

import WebSocket from 'ws';

export interface BridgeConfig {
  host?: string;
  port?: number;
}

export interface BashCommandRequest {
  type: 'BashCommand';
  data: {
    command: string;
    cwd?: string;
  };
}

export interface ReadFileRequest {
  type: 'ReadFile';
  data: {
    path: string;
  };
}

export interface WriteFileRequest {
  type: 'WriteFile';
  data: {
    path: string;
    content: string;
  };
}

export interface EditFileRequest {
  type: 'EditFile';
  data: {
    path: string;
    old_string: string;
    new_string: string;
  };
}

export interface GrepSearchRequest {
  type: 'GrepSearch';
  data: {
    pattern: string;
    path: string;
    case_sensitive?: boolean;
  };
}

export interface GlobSearchRequest {
  type: 'GlobSearch';
  data: {
    pattern: string;
    path: string;
  };
}

export interface GitContextRequest {
  type: 'GitContext';
  data: {
    path: string;
  };
}

export type BridgeRequest =
  | BashCommandRequest
  | ReadFileRequest
  | WriteFileRequest
  | EditFileRequest
  | GrepSearchRequest
  | GlobSearchRequest
  | GitContextRequest;

export interface BashResult {
  type: 'BashResult';
  data: {
    exit_code: number;
    stdout: string;
    stderr: string;
  };
}

export interface FileContent {
  type: 'FileContent';
  data: {
    content: string;
  };
}

export interface WriteSuccess {
  type: 'WriteSuccess';
  data: null;
}

export interface EditSuccess {
  type: 'EditSuccess';
  data: null;
}

export interface GrepResults {
  type: 'GrepResults';
  data: {
    matches: string[];
  };
}

export interface GlobResults {
  type: 'GlobResults';
  data: {
    files: string[];
  };
}

export interface GitContext {
  type: 'GitContext';
  data: {
    branch: string;
    commit: string;
    status: string;
  };
}

export interface BridgeError {
  type: 'Error';
  data: {
    message: string;
  };
}

export type BridgeResponse =
  | BashResult
  | FileContent
  | WriteSuccess
  | EditSuccess
  | GrepResults
  | GlobResults
  | GitContext
  | BridgeError;

export class DeepClawBridge {
  private ws: WebSocket | null = null;
  private config: Required<BridgeConfig>;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(config: BridgeConfig = {}) {
    this.config = {
      host: config.host || '127.0.0.1',
      port: config.port || 9000,
    };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.config.host}:${this.config.port}`;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        console.log(`[DeepClaw Bridge] Connected to ${url}`);
        this.reconnectAttempts = 0;
        resolve();
      });

      this.ws.on('error', (error) => {
        console.error(`[DeepClaw Bridge] Connection error:`, error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log(`[DeepClaw Bridge] Disconnected`);
        this.attemptReconnect();
      });
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[DeepClaw Bridge] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[DeepClaw Bridge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[DeepClaw Bridge] Reconnection failed:', error);
      });
    }, delay);
  }

  private sendRequest(request: BridgeRequest): Promise<BridgeResponse> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not connected'));
        return;
      }

      const message = JSON.stringify(request);

      const oneTimeHandler = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString()) as BridgeResponse;
          resolve(response);
        } catch (error) {
          reject(error);
        }
      };

      this.ws.once('message', oneTimeHandler);
      this.ws.send(message);
    });
  }

  async executeBash(command: string, cwd?: string): Promise<BashResult['data']> {
    const request: BashCommandRequest = {
      type: 'BashCommand',
      data: { command, cwd },
    };

    const response = await this.sendRequest(request);

    if (response.type === 'BashResult') {
      return response.data;
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async readFile(path: string): Promise<string> {
    const request: ReadFileRequest = {
      type: 'ReadFile',
      data: { path },
    };

    const response = await this.sendRequest(request);

    if (response.type === 'FileContent') {
      return response.data.content;
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const request: WriteFileRequest = {
      type: 'WriteFile',
      data: { path, content },
    };

    const response = await this.sendRequest(request);

    if (response.type === 'WriteSuccess') {
      return;
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async editFile(path: string, oldString: string, newString: string): Promise<void> {
    const request: EditFileRequest = {
      type: 'EditFile',
      data: { path, old_string: oldString, new_string: newString },
    };

    const response = await this.sendRequest(request);

    if (response.type === 'EditSuccess') {
      return;
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async grepSearch(
    pattern: string,
    path: string,
    caseSensitive = false
  ): Promise<string[]> {
    const request: GrepSearchRequest = {
      type: 'GrepSearch',
      data: { pattern, path, case_sensitive: caseSensitive },
    };

    const response = await this.sendRequest(request);

    if (response.type === 'GrepResults') {
      return response.data.matches;
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async globSearch(pattern: string, path: string): Promise<string[]> {
    const request: GlobSearchRequest = {
      type: 'GlobSearch',
      data: { pattern, path },
    };

    const response = await this.sendRequest(request);

    if (response.type === 'GlobResults') {
      return response.data.files;
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async getGitContext(path: string): Promise<GitContext['data']> {
    const request: GitContextRequest = {
      type: 'GitContext',
      data: { path },
    };

    const response = await this.sendRequest(request);

    if (response.type === 'GitContext') {
      return response.data;
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
