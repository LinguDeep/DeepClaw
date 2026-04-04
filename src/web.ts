/**
 * Web UI server using Express
 * TypeScript equivalent of Python web.py
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Orchestrator } from './orchestrator';
import { SharedState } from './types';
import { RAGMemory } from './memory';
import { ShellTool, FileSystemTool } from './tools';
import { BaseProvider, ProviderManager } from './multi-provider';
import { getLogger } from './logger';

const logger = getLogger();

interface TaskRequest {
  task: string;
  model?: string;
  max_steps?: number;
}

export class WebUIManager {
  projectRoot: string;
  host: string;
  port: number;
  app: express.Application;
  server: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  orchestrator: Orchestrator | null;
  connections: Set<WebSocket>;

  constructor(projectRoot: string, host: string = '0.0.0.0', port: number = 8080) {
    this.projectRoot = projectRoot;
    this.host = host;
    this.port = port;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.orchestrator = null;
    this.connections = new Set();
  }

  /**
   * Initialize and start the web server
   */
  async start(): Promise<void> {
    // Setup middleware
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'static')));

    // Setup routes
    this.setupRoutes();
    this.setupWebSocket();

    // Start server
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        logger.info(`Web UI server started at http://${this.host}:${this.port}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', version: '0.3.0' });
    });

    // Get current state
    this.app.get('/api/state', (req: Request, res: Response) => {
      if (!this.orchestrator) {
        res.json({ running: false });
        return;
      }
      res.json({
        running: true,
        state: this.orchestrator.state,
      });
    });

    // Start new task
    this.app.post('/api/task', async (req: Request, res: Response) => {
      const body = req.body as TaskRequest;
      
      if (!body.task) {
        res.status(400).json({ error: 'Task required' });
        return;
      }

      try {
        // Initialize provider
        const manager = new ProviderManager();
        const provider = manager.createFromEnv();
        
        if (!provider) {
          res.status(500).json({ error: 'No LLM provider available' });
          return;
        }

        // Initialize tools
        const shell = new ShellTool(this.projectRoot);
        await shell.init();
        const fs = new FileSystemTool(this.projectRoot);
        const memory = new RAGMemory(this.projectRoot);
        await memory.init();

        // Create orchestrator
        this.orchestrator = new Orchestrator(
          provider,
          shell,
          fs,
          body.max_steps || 15
        );

        // Run task asynchronously
        this.runTask(body.task);

        res.json({ task_id: Date.now().toString(), status: 'started' });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Serve main HTML
    this.app.get('/', (_req: Request, res: Response) => {
      res.send(this.generateHTML());
    });
  }

  /**
   * Setup WebSocket for real-time updates
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('WebSocket client connected');
      this.connections.add(ws);

      ws.on('close', () => {
        this.connections.delete(ws);
        logger.info('WebSocket client disconnected');
      });

      ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(ws, message);
        } catch (error) {
          logger.error('Invalid WebSocket message');
        }
      });
    });
  }

  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(ws: WebSocket, message: any): void {
    if (message.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  /**
   * Run task and broadcast updates
   */
  private async runTask(task: string): Promise<void> {
    if (!this.orchestrator) return;

    try {
      this.broadcast({
        type: 'state_update',
        payload: { task, running: true },
      });

      const result = await this.orchestrator.run(task);

      this.broadcast({
        type: 'complete',
        payload: { result },
      });
    } catch (error: any) {
      this.broadcast({
        type: 'error',
        payload: { error: error.message },
      });
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(message: any): void {
    const data = JSON.stringify(message);
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Generate main HTML page
   */
  private generateHTML(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>LinguClaw Web UI</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            min-height: 100vh;
        }
        .header {
            background: #16213e;
            padding: 1rem 2rem;
            border-bottom: 1px solid #0f3460;
        }
        .header h1 {
            color: #e94560;
            font-size: 1.5rem;
        }
        .container {
            display: grid;
            grid-template-columns: 300px 1fr;
            gap: 1rem;
            padding: 1rem;
            height: calc(100vh - 70px);
        }
        .sidebar {
            background: #16213e;
            border-radius: 8px;
            padding: 1rem;
            overflow-y: auto;
        }
        .main {
            background: #16213e;
            border-radius: 8px;
            padding: 1rem;
            display: flex;
            flex-direction: column;
        }
        .input-area {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1rem;
        }
        .input-area input {
            flex: 1;
            padding: 0.75rem;
            border: 1px solid #0f3460;
            border-radius: 4px;
            background: #1a1a2e;
            color: #eee;
            font-size: 1rem;
        }
        .input-area button {
            padding: 0.75rem 1.5rem;
            background: #e94560;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        .input-area button:hover {
            background: #c73e54;
        }
        .log-area {
            flex: 1;
            background: #1a1a2e;
            border-radius: 4px;
            padding: 1rem;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 0.875rem;
            white-space: pre-wrap;
        }
        .status {
            padding: 0.5rem;
            border-radius: 4px;
            margin-bottom: 0.5rem;
        }
        .status.success { background: #1e5128; }
        .status.error { background: #51231e; }
        .status.info { background: #1e3a5f; }
        .step-list {
            list-style: none;
        }
        .step-item {
            padding: 0.5rem;
            margin-bottom: 0.25rem;
            border-radius: 4px;
            background: #1a1a2e;
            font-size: 0.875rem;
        }
        .step-item.completed { border-left: 3px solid #4caf50; }
        .step-item.failed { border-left: 3px solid #f44336; }
        .step-item.pending { border-left: 3px solid #9e9e9e; }
        .step-item.in-progress { border-left: 3px solid #ff9800; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🦀 LinguClaw — Multi-Agent Dashboard</h1>
    </div>
    <div class="container">
        <div class="sidebar">
            <h3>Execution Plan</h3>
            <ul class="step-list" id="steps">
                <li class="step-item pending">No active task</li>
            </ul>
        </div>
        <div class="main">
            <div class="input-area">
                <input type="text" id="taskInput" placeholder="Enter your task..." />
                <button onclick="startTask()">Execute</button>
            </div>
            <div class="log-area" id="logs">Waiting for task...</div>
        </div>
    </div>
    <script>
        const ws = new WebSocket('ws://' + window.location.host);
        const logs = document.getElementById('logs');
        const steps = document.getElementById('steps');
        
        ws.onopen = () => console.log('WebSocket connected');
        
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'state_update') {
                logs.textContent = 'Task: ' + msg.payload.task + '\\n\\n';
            } else if (msg.type === 'log') {
                logs.textContent += msg.payload + '\\n';
            } else if (msg.type === 'complete') {
                logs.textContent += '\\n✅ Complete: ' + msg.payload.result;
            } else if (msg.type === 'error') {
                logs.textContent += '\\n❌ Error: ' + msg.payload.error;
            }
        };
        
        async function startTask() {
            const task = document.getElementById('taskInput').value;
            if (!task) return;
            
            const response = await fetch('/api/task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task, max_steps: 15 })
            });
            
            const result = await response.json();
            if (result.error) {
                alert('Error: ' + result.error);
            }
        }
        
        // Ping to keep connection alive
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    </script>
</body>
</html>
    `;
  }
}

/**
 * Run web UI server
 */
export async function runWebUI(projectRoot: string, host: string, port: number): Promise<void> {
  const manager = new WebUIManager(projectRoot, host, port);
  await manager.start();
}
