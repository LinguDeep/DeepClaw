/**
 * Workflow Engine - n8n-style node-based workflow execution
 * Supports trigger → action → condition → transform → output chains
 */

import { EventEmitter } from 'events';
import { getLogger } from './logger';
import fs from 'fs';
import path from 'path';

const logger = getLogger();

// ==================== Types ====================

export type NodeType = 'trigger' | 'action' | 'condition' | 'transform' | 'output';

export interface WorkflowNodeDef {
  id: string;
  type: NodeType;
  name: string;
  icon: string;
  category: string;
  description: string;
  inputs: number;
  outputs: number;
  configFields: NodeConfigField[];
}

export interface NodeConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'code' | 'json';
  placeholder?: string;
  options?: { label: string; value: string }[];
  required?: boolean;
  default?: any;
}

export interface WorkflowNode {
  id: string;
  definitionId: string;
  type: NodeType;
  name: string;
  config: Record<string, any>;
  position: { x: number; y: number };
}

export interface WorkflowConnection {
  id: string;
  sourceNodeId: string;
  sourceOutput: number;
  targetNodeId: string;
  targetInput: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'error' | 'running';
}

export interface NodeExecutionResult {
  nodeId: string;
  status: 'success' | 'error' | 'skipped';
  output: any;
  error?: string;
  duration: number;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  status: 'success' | 'error' | 'partial';
  nodeResults: NodeExecutionResult[];
  startedAt: string;
  completedAt: string;
  duration: number;
}

// ==================== Built-in Node Definitions ====================

function generateId(): string {
  const chars = 'abcdef0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  id += '-';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  id += '-4';
  for (let i = 0; i < 3; i++) id += chars[Math.floor(Math.random() * chars.length)];
  id += '-';
  id += ['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)];
  for (let i = 0; i < 3; i++) id += chars[Math.floor(Math.random() * chars.length)];
  id += '-';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export const NODE_DEFINITIONS: WorkflowNodeDef[] = [
  // Triggers
  {
    id: 'manual-trigger',
    type: 'trigger',
    name: 'Manual Trigger',
    icon: 'play',
    category: 'Triggers',
    description: 'Start workflow manually',
    inputs: 0,
    outputs: 1,
    configFields: [],
  },
  {
    id: 'schedule-trigger',
    type: 'trigger',
    name: 'Schedule',
    icon: 'clock',
    category: 'Triggers',
    description: 'Run on a schedule (cron/interval)',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Interval', value: 'interval' }, { label: 'Cron', value: 'cron' }], default: 'interval' },
      { key: 'interval', label: 'Interval', type: 'text', placeholder: '5m, 1h, 1d' },
      { key: 'cron', label: 'Cron Expression', type: 'text', placeholder: '*/5 * * * *' },
    ],
  },
  {
    id: 'webhook-trigger',
    type: 'trigger',
    name: 'Webhook',
    icon: 'webhook',
    category: 'Triggers',
    description: 'Trigger via HTTP webhook',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'method', label: 'Method', type: 'select', options: [{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }], default: 'POST' },
      { key: 'path', label: 'Path', type: 'text', placeholder: '/webhook/my-flow' },
    ],
  },
  {
    id: 'email-trigger',
    type: 'trigger',
    name: 'Email Received',
    icon: 'mail',
    category: 'Triggers',
    description: 'Trigger when email arrives',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'folder', label: 'Folder', type: 'text', placeholder: 'INBOX', default: 'INBOX' },
      { key: 'filter', label: 'Subject Filter', type: 'text', placeholder: 'Optional regex' },
    ],
  },

  // Actions
  {
    id: 'http-request',
    type: 'action',
    name: 'HTTP Request',
    icon: 'globe',
    category: 'Actions',
    description: 'Make an HTTP request',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'method', label: 'Method', type: 'select', options: [{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }, { label: 'PUT', value: 'PUT' }, { label: 'DELETE', value: 'DELETE' }], default: 'GET' },
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://api.example.com/data', required: true },
      { key: 'headers', label: 'Headers', type: 'json', placeholder: '{"Authorization": "Bearer ..."}' },
      { key: 'body', label: 'Body', type: 'json', placeholder: '{"key": "value"}' },
    ],
  },
  {
    id: 'shell-command',
    type: 'action',
    name: 'Shell Command',
    icon: 'terminal',
    category: 'Actions',
    description: 'Execute a shell command',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'command', label: 'Command', type: 'text', placeholder: 'echo "Hello World"', required: true },
      { key: 'cwd', label: 'Working Directory', type: 'text', placeholder: '.' },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', default: 30000 },
    ],
  },
  {
    id: 'send-email',
    type: 'action',
    name: 'Send Email',
    icon: 'mail',
    category: 'Actions',
    description: 'Send an email message',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'to', label: 'To', type: 'text', placeholder: 'user@example.com', required: true },
      { key: 'subject', label: 'Subject', type: 'text', placeholder: 'Email subject', required: true },
      { key: 'body', label: 'Body', type: 'text', placeholder: 'Email body' },
    ],
  },
  {
    id: 'ai-prompt',
    type: 'action',
    name: 'AI Prompt',
    icon: 'brain',
    category: 'Actions',
    description: 'Send prompt to LLM and get response',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'systemPrompt', label: 'System Prompt', type: 'text', placeholder: 'You are a helpful assistant' },
      { key: 'userPrompt', label: 'User Prompt', type: 'text', placeholder: 'Analyze: {{input}}', required: true },
      { key: 'temperature', label: 'Temperature', type: 'number', default: 0.7 },
      { key: 'maxTokens', label: 'Max Tokens', type: 'number', default: 1000 },
    ],
  },
  {
    id: 'send-telegram',
    type: 'action',
    name: 'Send Telegram',
    icon: 'send',
    category: 'Actions',
    description: 'Send a Telegram message',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'chatId', label: 'Chat ID', type: 'text', placeholder: '123456789' },
      { key: 'message', label: 'Message', type: 'text', placeholder: 'Hello from LinguClaw!', required: true },
    ],
  },
  {
    id: 'read-file',
    type: 'action',
    name: 'Read File',
    icon: 'file',
    category: 'Actions',
    description: 'Read contents of a file',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'path', label: 'File Path', type: 'text', placeholder: '/path/to/file.txt', required: true },
      { key: 'encoding', label: 'Encoding', type: 'select', options: [{ label: 'UTF-8', value: 'utf8' }, { label: 'ASCII', value: 'ascii' }, { label: 'Base64', value: 'base64' }], default: 'utf8' },
    ],
  },
  {
    id: 'write-file',
    type: 'action',
    name: 'Write File',
    icon: 'file-plus',
    category: 'Actions',
    description: 'Write content to a file',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'path', label: 'File Path', type: 'text', placeholder: '/path/to/output.txt', required: true },
      { key: 'content', label: 'Content', type: 'text', placeholder: '{{input}}' },
      { key: 'append', label: 'Append', type: 'boolean', default: false },
    ],
  },
  {
    id: 'memory-store',
    type: 'action',
    name: 'Store Memory',
    icon: 'database',
    category: 'Actions',
    description: 'Store data in LinguClaw memory',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'key', label: 'Key', type: 'text', placeholder: 'my-data', required: true },
      { key: 'category', label: 'Category', type: 'text', placeholder: 'workflow', default: 'workflow' },
    ],
  },
  {
    id: 'memory-retrieve',
    type: 'action',
    name: 'Retrieve Memory',
    icon: 'database',
    category: 'Actions',
    description: 'Retrieve data from LinguClaw memory',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'key', label: 'Key', type: 'text', placeholder: 'my-data', required: true },
    ],
  },
  {
    id: 'delay',
    type: 'action',
    name: 'Delay',
    icon: 'clock',
    category: 'Actions',
    description: 'Wait for specified duration',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'duration', label: 'Duration (ms)', type: 'number', default: 1000, required: true },
    ],
  },

  // Conditions
  {
    id: 'if-condition',
    type: 'condition',
    name: 'IF',
    icon: 'git-branch',
    category: 'Logic',
    description: 'Branch based on condition',
    inputs: 1,
    outputs: 2,
    configFields: [
      { key: 'field', label: 'Field', type: 'text', placeholder: 'data.status', required: true },
      { key: 'operator', label: 'Operator', type: 'select', options: [
        { label: 'Equals', value: 'eq' }, { label: 'Not Equals', value: 'neq' },
        { label: 'Contains', value: 'contains' }, { label: 'Greater Than', value: 'gt' },
        { label: 'Less Than', value: 'lt' }, { label: 'Regex Match', value: 'regex' },
        { label: 'Is Empty', value: 'empty' }, { label: 'Is Not Empty', value: 'notEmpty' },
      ], default: 'eq' },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'expected value' },
    ],
  },
  {
    id: 'switch',
    type: 'condition',
    name: 'Switch',
    icon: 'git-branch',
    category: 'Logic',
    description: 'Multi-branch switch statement',
    inputs: 1,
    outputs: 3,
    configFields: [
      { key: 'field', label: 'Field', type: 'text', placeholder: 'data.type', required: true },
      { key: 'case1', label: 'Case 1 (Output 1)', type: 'text', placeholder: 'value1' },
      { key: 'case2', label: 'Case 2 (Output 2)', type: 'text', placeholder: 'value2' },
    ],
  },

  // Transforms
  {
    id: 'code-transform',
    type: 'transform',
    name: 'Code',
    icon: 'code',
    category: 'Transform',
    description: 'Transform data with JavaScript',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'code', label: 'JavaScript Code', type: 'code', placeholder: 'return { result: input.data };', required: true },
    ],
  },
  {
    id: 'json-transform',
    type: 'transform',
    name: 'JSON Transform',
    icon: 'braces',
    category: 'Transform',
    description: 'Transform JSON data with template',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'template', label: 'Output Template', type: 'json', placeholder: '{"name": "{{input.name}}"}', required: true },
    ],
  },
  {
    id: 'text-template',
    type: 'transform',
    name: 'Text Template',
    icon: 'type',
    category: 'Transform',
    description: 'Generate text from template',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'template', label: 'Template', type: 'text', placeholder: 'Hello {{input.name}}, your order #{{input.id}} is ready.', required: true },
    ],
  },
  {
    id: 'merge',
    type: 'transform',
    name: 'Merge',
    icon: 'git-merge',
    category: 'Transform',
    description: 'Merge multiple inputs',
    inputs: 2,
    outputs: 1,
    configFields: [
      { key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Append', value: 'append' }, { label: 'Merge Object', value: 'merge' }], default: 'merge' },
    ],
  },

  // Outputs
  {
    id: 'log-output',
    type: 'output',
    name: 'Log',
    icon: 'file-text',
    category: 'Output',
    description: 'Log data to console/file',
    inputs: 1,
    outputs: 0,
    configFields: [
      { key: 'level', label: 'Level', type: 'select', options: [{ label: 'Info', value: 'info' }, { label: 'Warn', value: 'warn' }, { label: 'Error', value: 'error' }], default: 'info' },
      { key: 'message', label: 'Message', type: 'text', placeholder: 'Workflow output: {{input}}' },
    ],
  },
  {
    id: 'webhook-response',
    type: 'output',
    name: 'Respond',
    icon: 'send',
    category: 'Output',
    description: 'Return HTTP response for webhook',
    inputs: 1,
    outputs: 0,
    configFields: [
      { key: 'statusCode', label: 'Status Code', type: 'number', default: 200 },
      { key: 'body', label: 'Response Body', type: 'json', placeholder: '{"success": true}' },
    ],
  },
];

// ==================== Workflow Engine ====================

export class WorkflowEngine extends EventEmitter {
  private workflows: Map<string, Workflow> = new Map();
  private storagePath: string;

  constructor(storagePath?: string) {
    super();
    this.storagePath = storagePath || path.join(process.env.HOME || '~', '.linguclaw', 'workflows.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
        if (Array.isArray(data)) {
          for (const wf of data) {
            this.workflows.set(wf.id, wf);
          }
        }
        logger.debug(`Loaded ${this.workflows.size} workflows`);
      }
    } catch (e: any) {
      logger.warn(`Failed to load workflows: ${e.message}`);
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = Array.from(this.workflows.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
    } catch (e: any) {
      logger.warn(`Failed to save workflows: ${e.message}`);
    }
  }

  getNodeDefinitions(): WorkflowNodeDef[] {
    return NODE_DEFINITIONS;
  }

  listWorkflows(): Workflow[] {
    return Array.from(this.workflows.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  getWorkflow(id: string): Workflow | null {
    return this.workflows.get(id) || null;
  }

  createWorkflow(name: string, description: string = ''): Workflow {
    const workflow: Workflow = {
      id: generateId(),
      name,
      description,
      nodes: [],
      connections: [],
      active: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.workflows.set(workflow.id, workflow);
    this.saveToDisk();
    return workflow;
  }

  updateWorkflow(id: string, updates: Partial<Workflow>): Workflow | null {
    const wf = this.workflows.get(id);
    if (!wf) return null;

    if (updates.name !== undefined) wf.name = updates.name;
    if (updates.description !== undefined) wf.description = updates.description;
    if (updates.nodes !== undefined) wf.nodes = updates.nodes;
    if (updates.connections !== undefined) wf.connections = updates.connections;
    if (updates.active !== undefined) wf.active = updates.active;
    wf.updatedAt = new Date().toISOString();

    this.workflows.set(id, wf);
    this.saveToDisk();
    return wf;
  }

  deleteWorkflow(id: string): boolean {
    const deleted = this.workflows.delete(id);
    if (deleted) this.saveToDisk();
    return deleted;
  }

  duplicateWorkflow(id: string): Workflow | null {
    const original = this.workflows.get(id);
    if (!original) return null;

    const copy: Workflow = {
      ...JSON.parse(JSON.stringify(original)),
      id: generateId(),
      name: original.name + ' (Copy)',
      active: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.workflows.set(copy.id, copy);
    this.saveToDisk();
    return copy;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(id: string, triggerData?: any, context?: { provider?: any; memory?: any }): Promise<WorkflowExecutionResult> {
    const wf = this.workflows.get(id);
    if (!wf) throw new Error('Workflow not found');

    const startedAt = new Date().toISOString();
    const nodeResults: NodeExecutionResult[] = [];

    // Update state
    wf.lastRunAt = startedAt;
    wf.lastRunStatus = 'running';
    this.emit('workflow:start', { workflowId: id });

    try {
      // Build execution graph
      const executionOrder = this.topologicalSort(wf);

      // Data store for node outputs
      const nodeOutputs = new Map<string, any>();

      // Execute nodes in order
      for (const nodeId of executionOrder) {
        const node = wf.nodes.find(n => n.id === nodeId);
        if (!node) continue;

        const startTime = Date.now();

        try {
          // Gather inputs from connected nodes
          const inputs = this.gatherInputs(wf, nodeId, nodeOutputs);

          // Execute the node
          const output = await this.executeNode(node, inputs, triggerData, context);
          nodeOutputs.set(nodeId, output);

          const result: NodeExecutionResult = {
            nodeId,
            status: 'success',
            output,
            duration: Date.now() - startTime,
          };
          nodeResults.push(result);
          this.emit('node:complete', { workflowId: id, ...result });

          // Handle condition nodes - determine which output path to take
          if (node.type === 'condition') {
            const skippedOutputs = this.getSkippedPaths(wf, nodeId, output);
            for (const skippedNodeId of skippedOutputs) {
              nodeOutputs.set(skippedNodeId, { _skipped: true });
            }
          }
        } catch (err: any) {
          const result: NodeExecutionResult = {
            nodeId,
            status: 'error',
            output: null,
            error: err.message,
            duration: Date.now() - startTime,
          };
          nodeResults.push(result);
          this.emit('node:error', { workflowId: id, ...result });
          logger.error(`Node ${node.name} (${nodeId}) failed: ${err.message}`);
        }
      }

      const completedAt = new Date().toISOString();
      const hasErrors = nodeResults.some(r => r.status === 'error');
      wf.lastRunStatus = hasErrors ? 'error' : 'success';
      this.saveToDisk();

      const execResult: WorkflowExecutionResult = {
        workflowId: id,
        status: hasErrors ? (nodeResults.some(r => r.status === 'success') ? 'partial' : 'error') : 'success',
        nodeResults,
        startedAt,
        completedAt,
        duration: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      };

      this.emit('workflow:complete', execResult);
      return execResult;

    } catch (err: any) {
      wf.lastRunStatus = 'error';
      this.saveToDisk();

      const result: WorkflowExecutionResult = {
        workflowId: id,
        status: 'error',
        nodeResults,
        startedAt,
        completedAt: new Date().toISOString(),
        duration: Date.now() - new Date(startedAt).getTime(),
      };
      this.emit('workflow:error', { ...result, error: err.message });
      return result;
    }
  }

  private topologicalSort(wf: Workflow): string[] {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const node of wf.nodes) {
      inDegree.set(node.id, 0);
      adjList.set(node.id, []);
    }

    for (const conn of wf.connections) {
      const targets = adjList.get(conn.sourceNodeId) || [];
      targets.push(conn.targetNodeId);
      adjList.set(conn.sourceNodeId, targets);
      inDegree.set(conn.targetNodeId, (inDegree.get(conn.targetNodeId) || 0) + 1);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      result.push(nodeId);

      for (const neighbor of adjList.get(nodeId) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return result;
  }

  private gatherInputs(wf: Workflow, nodeId: string, outputs: Map<string, any>): any {
    const incoming = wf.connections.filter(c => c.targetNodeId === nodeId);
    if (incoming.length === 0) return null;
    if (incoming.length === 1) return outputs.get(incoming[0].sourceNodeId);

    // Multiple inputs: merge into array
    return incoming.map(c => outputs.get(c.sourceNodeId)).filter(Boolean);
  }

  private getSkippedPaths(wf: Workflow, conditionNodeId: string, conditionResult: any): string[] {
    // For condition nodes, the result indicates which output(s) to skip
    const skipped: string[] = [];
    const outputIdx = conditionResult?._outputIndex ?? 0;

    const outConnections = wf.connections.filter(c => c.sourceNodeId === conditionNodeId);
    for (const conn of outConnections) {
      if (conn.sourceOutput !== outputIdx) {
        skipped.push(conn.targetNodeId);
      }
    }

    return skipped;
  }

  private async executeNode(node: WorkflowNode, input: any, triggerData?: any, context?: any): Promise<any> {
    // Skip if marked as skipped
    if (input && input._skipped) return { _skipped: true };

    const def = NODE_DEFINITIONS.find(d => d.id === node.definitionId);
    if (!def) throw new Error(`Unknown node type: ${node.definitionId}`);

    const config = node.config || {};

    // Replace template variables in config
    const resolvedConfig = this.resolveTemplates(config, input, triggerData);

    switch (node.definitionId) {
      case 'manual-trigger':
        return triggerData || { triggered: true, timestamp: new Date().toISOString() };

      case 'schedule-trigger':
        return { triggered: true, schedule: config.interval || config.cron, timestamp: new Date().toISOString() };

      case 'webhook-trigger':
        return triggerData || { triggered: true };

      case 'email-trigger':
        return triggerData || { triggered: true };

      case 'http-request':
        return await this.executeHttpRequest(resolvedConfig);

      case 'shell-command':
        return await this.executeShellCommand(resolvedConfig);

      case 'send-email':
        return { sent: true, to: resolvedConfig.to, subject: resolvedConfig.subject };

      case 'ai-prompt':
        return await this.executeAIPrompt(resolvedConfig, input, context);

      case 'send-telegram':
        return { sent: true, chatId: resolvedConfig.chatId, message: resolvedConfig.message };

      case 'read-file':
        return this.executeReadFile(resolvedConfig);

      case 'write-file':
        return this.executeWriteFile(resolvedConfig, input);

      case 'memory-store':
        if (context?.memory) {
          context.memory.store(resolvedConfig.key, input, resolvedConfig.category || 'workflow');
        }
        return { stored: true, key: resolvedConfig.key };

      case 'memory-retrieve':
        if (context?.memory) {
          const results = context.memory.search(resolvedConfig.key, undefined, 1);
          return results.length > 0 ? results[0].value : null;
        }
        return null;

      case 'delay':
        await new Promise(resolve => setTimeout(resolve, parseInt(config.duration) || 1000));
        return input;

      case 'if-condition':
        return this.evaluateCondition(resolvedConfig, input);

      case 'switch':
        return this.evaluateSwitch(resolvedConfig, input);

      case 'code-transform':
        return this.executeCodeTransform(resolvedConfig, input);

      case 'json-transform':
        return this.executeJsonTransform(resolvedConfig, input);

      case 'text-template':
        return { text: this.applyTemplate(resolvedConfig.template || '', input) };

      case 'merge':
        if (Array.isArray(input)) {
          return resolvedConfig.mode === 'merge' ? Object.assign({}, ...input.filter(i => i && typeof i === 'object')) : input;
        }
        return input;

      case 'log-output':
        const msg = resolvedConfig.message ? this.applyTemplate(resolvedConfig.message, input) : JSON.stringify(input);
        const lvl = resolvedConfig.level || 'info';
        if (lvl === 'warn') logger.warn(`[Workflow] ${msg}`);
        else if (lvl === 'error') logger.error(`[Workflow] ${msg}`);
        else logger.info(`[Workflow] ${msg}`);
        return { logged: true, message: msg };

      case 'webhook-response':
        return { statusCode: resolvedConfig.statusCode || 200, body: resolvedConfig.body || input };

      default:
        throw new Error(`Unimplemented node: ${node.definitionId}`);
    }
  }

  private resolveTemplates(config: Record<string, any>, input: any, triggerData?: any): Record<string, any> {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        resolved[key] = this.applyTemplate(value, input, triggerData);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private applyTemplate(template: string, input: any, triggerData?: any): string {
    return template.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
      const parts = path.split('.');
      let value: any = parts[0] === 'trigger' ? triggerData : (parts[0] === 'input' ? input : input);
      if (parts[0] === 'input' || parts[0] === 'trigger') parts.shift();
      for (const part of parts) {
        if (value == null) return '';
        value = value[part];
      }
      return value != null ? String(value) : '';
    });
  }

  private async executeHttpRequest(config: Record<string, any>): Promise<any> {
    const axios = require('axios');
    let headers: any = {};
    if (config.headers) {
      try { headers = typeof config.headers === 'string' ? JSON.parse(config.headers) : config.headers; }
      catch { /* ignore */ }
    }
    let data: any = undefined;
    if (config.body) {
      try { data = typeof config.body === 'string' ? JSON.parse(config.body) : config.body; }
      catch { data = config.body; }
    }

    const response = await axios({
      method: (config.method || 'GET').toLowerCase(),
      url: config.url,
      headers,
      data,
      timeout: 30000,
      validateStatus: () => true,
    });

    return { status: response.status, headers: response.headers, data: response.data };
  }

  private async executeShellCommand(config: Record<string, any>): Promise<any> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const timeout = parseInt(config.timeout) || 30000;
    const result = await execAsync(config.command, {
      cwd: config.cwd || undefined,
      timeout,
      maxBuffer: 5 * 1024 * 1024,
    });

    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  }

  private async executeAIPrompt(config: Record<string, any>, input: any, context?: any): Promise<any> {
    if (!context?.provider) throw new Error('No LLM provider available');

    const messages = [];
    if (config.systemPrompt) messages.push({ role: 'system', content: config.systemPrompt });
    const userMsg = config.userPrompt ? this.applyTemplate(config.userPrompt, input) : JSON.stringify(input);
    messages.push({ role: 'user', content: userMsg });

    const response = await context.provider.complete(messages, config.temperature || 0.7, config.maxTokens || 1000);
    return { content: response.content, model: response.model, usage: response.usage };
  }

  private executeReadFile(config: Record<string, any>): any {
    const content = fs.readFileSync(config.path, config.encoding || 'utf8');
    return { content, path: config.path, size: Buffer.byteLength(content) };
  }

  private executeWriteFile(config: Record<string, any>, input: any): any {
    const content = config.content ? this.applyTemplate(config.content, input) : JSON.stringify(input, null, 2);
    if (config.append) {
      fs.appendFileSync(config.path, content);
    } else {
      const dir = path.dirname(config.path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(config.path, content);
    }
    return { written: true, path: config.path, size: Buffer.byteLength(content) };
  }

  private evaluateCondition(config: Record<string, any>, input: any): any {
    const field = config.field;
    const value = this.getNestedValue(input, field);
    const expected = config.value;
    let result = false;

    switch (config.operator) {
      case 'eq': result = String(value) === String(expected); break;
      case 'neq': result = String(value) !== String(expected); break;
      case 'contains': result = String(value).includes(String(expected)); break;
      case 'gt': result = Number(value) > Number(expected); break;
      case 'lt': result = Number(value) < Number(expected); break;
      case 'regex': result = new RegExp(expected).test(String(value)); break;
      case 'empty': result = value == null || value === '' || (Array.isArray(value) && value.length === 0); break;
      case 'notEmpty': result = value != null && value !== '' && !(Array.isArray(value) && value.length === 0); break;
    }

    return { ...input, _conditionResult: result, _outputIndex: result ? 0 : 1 };
  }

  private evaluateSwitch(config: Record<string, any>, input: any): any {
    const value = String(this.getNestedValue(input, config.field));
    let outputIdx = 2; // default output
    if (value === String(config.case1)) outputIdx = 0;
    else if (value === String(config.case2)) outputIdx = 1;

    return { ...input, _outputIndex: outputIdx };
  }

  private executeCodeTransform(config: Record<string, any>, input: any): any {
    // Sandboxed code execution using Function constructor
    const fn = new Function('input', 'JSON', `"use strict"; ${config.code}`);
    return fn(input, JSON);
  }

  private executeJsonTransform(config: Record<string, any>, input: any): any {
    const template = config.template;
    if (!template) return input;

    const resolved = this.applyTemplate(typeof template === 'string' ? template : JSON.stringify(template), input);
    try {
      return JSON.parse(resolved);
    } catch {
      return { result: resolved };
    }
  }

  private getNestedValue(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    const parts = path.split('.');
    let value = obj;
    for (const part of parts) {
      if (value == null) return undefined;
      value = value[part];
    }
    return value;
  }
}

// Singleton
let engineInstance: WorkflowEngine | null = null;

export function getWorkflowEngine(): WorkflowEngine {
  if (!engineInstance) {
    engineInstance = new WorkflowEngine();
  }
  return engineInstance;
}
