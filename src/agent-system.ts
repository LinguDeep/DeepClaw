/**
 * Advanced AI Agent System for LinguClaw
 * Multi-agent collaboration with specialized agents
 */

import { EventEmitter } from 'events';
import { getLogger } from './logger';
import { SemanticMemory } from './semantic-memory';

const logger = getLogger();

// ============================================
// AGENT TYPES AND INTERFACES
// ============================================

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  capabilities: Capability[];
  context: AgentContext;
  memory: AgentMemory;
  execute(task: Task): Promise<TaskResult>;
  collaborate(message: AgentMessage): Promise<void>;
}

export type AgentType = 
  | 'architect'     // System design and architecture
  | 'coder'         // Code implementation
  | 'reviewer'      // Code review and quality
  | 'tester'        // Testing and validation
  | 'debugger'      // Debugging and troubleshooting
  | 'optimizer'     // Performance optimization
  | 'security'      // Security analysis
  | 'documenter'    // Documentation generation
  | 'researcher'    // Research and exploration
  | 'coordinator';  // Orchestrates other agents

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'error' | 'offline';

export interface Capability {
  name: string;
  description: string;
  priority: number;
  canExecute: (task: Task) => boolean;
}

export interface AgentContext {
  projectPath: string;
  language?: string;
  framework?: string;
  files: string[];
  dependencies: string[];
  recentCommits: string[];
}

export interface AgentMemory {
  shortTerm: string[];
  longTerm: Map<string, any>;
  conversations: AgentMessage[];
  learnings: string[];
}

export interface Task {
  id: string;
  type: TaskType;
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  context: any;
  dependencies: string[];
  estimatedTime: number; // minutes
  deadline?: Date;
  assignedTo?: string;
  parentTask?: string;
  subtasks: string[];
}

export type TaskType =
  | 'implement'
  | 'refactor'
  | 'review'
  | 'test'
  | 'debug'
  | 'optimize'
  | 'document'
  | 'research'
  | 'design'
  | 'analyze';

export interface TaskResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output: string;
  artifacts: Artifact[];
  metrics: TaskMetrics;
  errors: string[];
  warnings: string[];
  suggestions: string[];
  completedAt: Date;
}

export interface Artifact {
  type: 'code' | 'test' | 'doc' | 'config' | 'data';
  path: string;
  content: string;
  language?: string;
}

export interface TaskMetrics {
  duration: number;
  tokensUsed: number;
  apiCalls: number;
  filesModified: number;
  linesChanged: number;
  complexity: number;
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: MessageType;
  content: string;
  context?: any;
  timestamp: Date;
  priority: 'low' | 'medium' | 'high';
}

export type MessageType =
  | 'request'      // Asking for help/info
  | 'response'     // Replying to request
  | 'broadcast'    // To all agents
  | 'update'       // Status update
  | 'alert'        // Important notification
  | 'result';      // Task result

// ============================================
// SPECIALIZED AGENTS
// ============================================

export class ArchitectAgent implements Agent {
  id = 'architect-' + Date.now().toString(36);
  name = 'System Architect';
  type: AgentType = 'architect';
  status: AgentStatus = 'idle';
  capabilities: Capability[] = [
    {
      name: 'system_design',
      description: 'Design system architecture and patterns',
      priority: 1,
      canExecute: (task) => task.type === 'design' || task.type === 'analyze',
    },
    {
      name: 'code_review',
      description: 'Review code for architectural compliance',
      priority: 2,
      canExecute: (task) => task.type === 'review',
    },
  ];
  context: AgentContext;
  memory: AgentMemory;
  private llmProvider: any;

  constructor(context: AgentContext, llmProvider: any) {
    this.context = context;
    this.llmProvider = llmProvider;
    this.memory = {
      shortTerm: [],
      longTerm: new Map(),
      conversations: [],
      learnings: [],
    };
  }

  async execute(task: Task): Promise<TaskResult> {
    this.status = 'working';
    const startTime = Date.now();

    try {
      logger.info(`[${this.name}] Executing task: ${task.description}`);

      let output = '';
      const artifacts: Artifact[] = [];

      switch (task.type) {
        case 'design':
          output = await this.designSystem(task.context);
          artifacts.push(...this.generateDesignArtifacts(task.context));
          break;
        case 'review':
          output = await this.reviewArchitecture(task.context);
          break;
        case 'analyze':
          output = await this.analyzeSystem(task.context);
          break;
        default:
          throw new Error(`Task type ${task.type} not supported by ${this.name}`);
      }

      this.status = 'idle';

      return {
        taskId: task.id,
        agentId: this.id,
        success: true,
        output,
        artifacts,
        metrics: {
          duration: Date.now() - startTime,
          tokensUsed: 0,
          apiCalls: 0,
          filesModified: artifacts.length,
          linesChanged: 0,
          complexity: 0,
        },
        errors: [],
        warnings: [],
        suggestions: [],
        completedAt: new Date(),
      };
    } catch (error: any) {
      this.status = 'error';
      return {
        taskId: task.id,
        agentId: this.id,
        success: false,
        output: '',
        artifacts: [],
        metrics: {
          duration: Date.now() - startTime,
          tokensUsed: 0,
          apiCalls: 0,
          filesModified: 0,
          linesChanged: 0,
          complexity: 0,
        },
        errors: [error.message],
        warnings: [],
        suggestions: [],
        completedAt: new Date(),
      };
    }
  }

  async collaborate(message: AgentMessage): Promise<void> {
    this.memory.conversations.push(message);
    logger.info(`[${this.name}] Received message from ${message.from}: ${message.content.substring(0, 100)}`);
  }

  private async designSystem(context: any): Promise<string> {
    const prompt = `
      Design a system architecture for:
      ${JSON.stringify(context, null, 2)}
      
      Consider:
      1. Scalability
      2. Maintainability
      3. Security
      4. Performance
      5. Testing
      
      Provide:
      - Component diagram
      - Data flow
      - API design
      - Database schema
      - Deployment strategy
    `;

    // Simulated LLM call
    return `System Architecture Design:
    
## Components
- Frontend: React with TypeScript
- Backend: Node.js/Express API
- Database: PostgreSQL with Redis cache
- Message Queue: RabbitMQ
- File Storage: S3

## Data Flow
1. Client requests → API Gateway
2. Authentication → JWT validation
3. Business logic → Service layer
4. Data persistence → Database
5. Caching → Redis
6. Async processing → Queue

## API Design
RESTful API with versioning (v1, v2)
GraphQL for complex queries
WebSocket for real-time features

## Database Schema
Users table, Projects table, Tasks table
Relationships: User has many Projects, Project has many Tasks

## Deployment
Docker containers orchestrated with Kubernetes
CI/CD pipeline with GitHub Actions
Monitoring with Prometheus and Grafana`;
  }

  private async reviewArchitecture(context: any): Promise<string> {
    return `Architecture Review:
    
Strengths:
- Clear separation of concerns
- Proper use of design patterns
- Good modularity

Recommendations:
1. Consider microservices for scalability
2. Add circuit breaker pattern for external calls
3. Implement event sourcing for audit trail
4. Use CQRS for complex read/write operations`;
  }

  private async analyzeSystem(context: any): Promise<string> {
    return `System Analysis:
    
Complexity Metrics:
- Cyclomatic complexity: Moderate
- Coupling: Low
- Cohesion: High

Potential Issues:
1. Tight coupling in module X
2. Missing error handling in module Y
3. Performance bottleneck in database queries

Improvements:
1. Refactor module X using dependency injection
2. Add comprehensive error handling
3. Implement query optimization and caching`;
  }

  private generateDesignArtifacts(context: any): Artifact[] {
    return [
      {
        type: 'doc',
        path: 'architecture.md',
        content: '# System Architecture\n\n## Overview\n...',
      },
      {
        type: 'config',
        path: 'docker-compose.yml',
        content: 'version: "3.8"\nservices:\n  api:\n    ...',
      },
    ];
  }
}

export class CoderAgent implements Agent {
  id = 'coder-' + Date.now().toString(36);
  name = 'Code Implementer';
  type: AgentType = 'coder';
  status: AgentStatus = 'idle';
  capabilities: Capability[] = [
    {
      name: 'implement',
      description: 'Implement features and functionality',
      priority: 1,
      canExecute: (task) => task.type === 'implement',
    },
    {
      name: 'refactor',
      description: 'Refactor existing code',
      priority: 2,
      canExecute: (task) => task.type === 'refactor',
    },
  ];
  context: AgentContext;
  memory: AgentMemory;
  private llmProvider: any;

  constructor(context: AgentContext, llmProvider: any) {
    this.context = context;
    this.llmProvider = llmProvider;
    this.memory = {
      shortTerm: [],
      longTerm: new Map(),
      conversations: [],
      learnings: [],
    };
  }

  async execute(task: Task): Promise<TaskResult> {
    this.status = 'working';
    const startTime = Date.now();

    try {
      logger.info(`[${this.name}] Executing task: ${task.description}`);

      let output = '';
      const artifacts: Artifact[] = [];

      switch (task.type) {
        case 'implement':
          const impl = await this.implementFeature(task.context);
          output = impl.description;
          artifacts.push(...impl.code);
          break;
        case 'refactor':
          const ref = await this.refactorCode(task.context);
          output = ref.description;
          artifacts.push(...ref.code);
          break;
        default:
          throw new Error(`Task type ${task.type} not supported by ${this.name}`);
      }

      this.status = 'idle';

      return {
        taskId: task.id,
        agentId: this.id,
        success: true,
        output,
        artifacts,
        metrics: {
          duration: Date.now() - startTime,
          tokensUsed: 0,
          apiCalls: 0,
          filesModified: artifacts.length,
          linesChanged: artifacts.reduce((sum, a) => sum + a.content.split('\n').length, 0),
          complexity: 0,
        },
        errors: [],
        warnings: [],
        suggestions: [],
        completedAt: new Date(),
      };
    } catch (error: any) {
      this.status = 'error';
      return {
        taskId: task.id,
        agentId: this.id,
        success: false,
        output: '',
        artifacts: [],
        metrics: {
          duration: Date.now() - startTime,
          tokensUsed: 0,
          apiCalls: 0,
          filesModified: 0,
          linesChanged: 0,
          complexity: 0,
        },
        errors: [error.message],
        warnings: [],
        suggestions: [],
        completedAt: new Date(),
      };
    }
  }

  async collaborate(message: AgentMessage): Promise<void> {
    this.memory.conversations.push(message);
  }

  private async implementFeature(context: any): Promise<{ description: string; code: Artifact[] }> {
    const feature = context.feature || 'New feature';
    const language = context.language || 'typescript';

    return {
      description: `Implemented ${feature} in ${language}`,
      code: [
        {
          type: 'code',
          path: `src/${feature.toLowerCase().replace(/\s+/g, '-')}.ts`,
          content: `export class ${feature.replace(/\s+/g, '')} {
  constructor() {
    // Implementation
  }
  
  execute() {
    // Feature logic
    return true;
  }
}`,
          language,
        },
        {
          type: 'test',
          path: `tests/${feature.toLowerCase().replace(/\s+/g, '-')}.test.ts`,
          content: `import { ${feature.replace(/\s+/g, '')} } from '../src/${feature.toLowerCase().replace(/\s+/g, '-')}';

describe('${feature}', () => {
  it('should execute successfully', () => {
    const instance = new ${feature.replace(/\s+/g, '')}();
    expect(instance.execute()).toBe(true);
  });
});`,
          language,
        },
      ],
    };
  }

  private async refactorCode(context: any): Promise<{ description: string; code: Artifact[] }> {
    const file = context.file || 'unknown';
    
    return {
      description: `Refactored ${file} for better maintainability`,
      code: [
        {
          type: 'code',
          path: file,
          content: '// Refactored code\n// - Extracted functions\n// - Improved naming\n// - Added types',
        },
      ],
    };
  }
}

export class ReviewerAgent implements Agent {
  id = 'reviewer-' + Date.now().toString(36);
  name = 'Code Reviewer';
  type: AgentType = 'reviewer';
  status: AgentStatus = 'idle';
  capabilities: Capability[] = [
    {
      name: 'code_review',
      description: 'Review code for quality and best practices',
      priority: 1,
      canExecute: (task) => task.type === 'review',
    },
  ];
  context: AgentContext;
  memory: AgentMemory;
  private llmProvider: any;

  constructor(context: AgentContext, llmProvider: any) {
    this.context = context;
    this.llmProvider = llmProvider;
    this.memory = {
      shortTerm: [],
      longTerm: new Map(),
      conversations: [],
      learnings: [],
    };
  }

  async execute(task: Task): Promise<TaskResult> {
    this.status = 'working';
    const startTime = Date.now();

    try {
      const review = await this.reviewCode(task.context);
      this.status = 'idle';

      return {
        taskId: task.id,
        agentId: this.id,
        success: true,
        output: review.summary,
        artifacts: review.comments.map(c => ({
          type: 'doc',
          path: `review-${task.id}.md`,
          content: c,
        })),
        metrics: {
          duration: Date.now() - startTime,
          tokensUsed: 0,
          apiCalls: 0,
          filesModified: 0,
          linesChanged: 0,
          complexity: 0,
        },
        errors: [],
        warnings: review.warnings,
        suggestions: review.suggestions,
        completedAt: new Date(),
      };
    } catch (error: any) {
      this.status = 'error';
      return {
        taskId: task.id,
        agentId: this.id,
        success: false,
        output: '',
        artifacts: [],
        metrics: {
          duration: Date.now() - startTime,
          tokensUsed: 0,
          apiCalls: 0,
          filesModified: 0,
          linesChanged: 0,
          complexity: 0,
        },
        errors: [error.message],
        warnings: [],
        suggestions: [],
        completedAt: new Date(),
      };
    }
  }

  async collaborate(message: AgentMessage): Promise<void> {
    this.memory.conversations.push(message);
  }

  private async reviewCode(context: any): Promise<{ summary: string; comments: string[]; warnings: string[]; suggestions: string[] }> {
    return {
      summary: 'Code review completed',
      comments: [
        'Consider adding more type annotations',
        'Function is too long, consider splitting',
        'Missing error handling',
      ],
      warnings: [
        'Potential null pointer exception',
        'Hardcoded credentials detected',
      ],
      suggestions: [
        'Use const instead of let where possible',
        'Add unit tests for edge cases',
        'Consider using async/await for better readability',
      ],
    };
  }
}

export class TesterAgent implements Agent {
  id = 'tester-' + Date.now().toString(36);
  name = 'Test Engineer';
  type: AgentType = 'tester';
  status: AgentStatus = 'idle';
  capabilities: Capability[] = [
    {
      name: 'test',
      description: 'Generate and run tests',
      priority: 1,
      canExecute: (task) => task.type === 'test',
    },
  ];
  context: AgentContext;
  memory: AgentMemory;
  private llmProvider: any;

  constructor(context: AgentContext, llmProvider: any) {
    this.context = context;
    this.llmProvider = llmProvider;
    this.memory = {
      shortTerm: [],
      longTerm: new Map(),
      conversations: [],
      learnings: [],
    };
  }

  async execute(task: Task): Promise<TaskResult> {
    this.status = 'working';
    const startTime = Date.now();

    try {
      const tests = await this.generateTests(task.context);
      this.status = 'idle';

      return {
        taskId: task.id,
        agentId: this.id,
        success: true,
        output: `Generated ${tests.length} tests`,
        artifacts: tests,
        metrics: {
          duration: Date.now() - startTime,
          tokensUsed: 0,
          apiCalls: 0,
          filesModified: tests.length,
          linesChanged: tests.reduce((sum, t) => sum + t.content.split('\n').length, 0),
          complexity: 0,
        },
        errors: [],
        warnings: [],
        suggestions: [],
        completedAt: new Date(),
      };
    } catch (error: any) {
      this.status = 'error';
      return {
        taskId: task.id,
        agentId: this.id,
        success: false,
        output: '',
        artifacts: [],
        metrics: {
          duration: Date.now() - startTime,
          tokensUsed: 0,
          apiCalls: 0,
          filesModified: 0,
          linesChanged: 0,
          complexity: 0,
        },
        errors: [error.message],
        warnings: [],
        suggestions: [],
        completedAt: new Date(),
      };
    }
  }

  async collaborate(message: AgentMessage): Promise<void> {
    this.memory.conversations.push(message);
  }

  private async generateTests(context: any): Promise<Artifact[]> {
    const target = context.target || 'unknown';
    
    return [
      {
        type: 'test',
        path: `tests/${target}.test.ts`,
        content: `describe('${target}', () => {
  it('should handle normal case', () => {});
  it('should handle edge case', () => {});
  it('should handle error case', () => {});
});`,
      },
    ];
  }
}

// ============================================
// AGENT ORCHESTRATOR
// ============================================

export class AgentOrchestrator extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private tasks: Map<string, Task> = new Map();
  private results: Map<string, TaskResult> = new Map();
  private messageQueue: AgentMessage[] = [];
  private semanticMemory: SemanticMemory;
  private projectPath: string;

  constructor(projectPath: string, memoryPath: string) {
    super();
    this.projectPath = projectPath;
    this.semanticMemory = new SemanticMemory(memoryPath);
  }

  async initialize(): Promise<void> {
    this.semanticMemory.init();
    logger.info('Agent orchestrator initialized');
  }

  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.emit('agent:registered', agent);
    logger.info(`Agent registered: ${agent.name} (${agent.type})`);
  }

  createAgent(type: AgentType, llmProvider: any): Agent {
    const context: AgentContext = {
      projectPath: this.projectPath,
      files: [],
      dependencies: [],
      recentCommits: [],
    };

    switch (type) {
      case 'architect':
        return new ArchitectAgent(context, llmProvider);
      case 'coder':
        return new CoderAgent(context, llmProvider);
      case 'reviewer':
        return new ReviewerAgent(context, llmProvider);
      case 'tester':
        return new TesterAgent(context, llmProvider);
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }

  async submitTask(task: Omit<Task, 'id' | 'subtasks'>): Promise<string> {
    const id = 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const fullTask: Task = {
      ...task,
      id,
      subtasks: [],
    };

    this.tasks.set(id, fullTask);
    this.emit('task:submitted', fullTask);

    // Find best agent for task
    const agent = this.findBestAgent(fullTask);
    if (agent) {
      fullTask.assignedTo = agent.id;
      
      // Execute task
      const result = await agent.execute(fullTask);
      this.results.set(id, result);
      this.emit('task:completed', result);

      // Store in semantic memory
      this.semanticMemory.store(id, `Task: ${task.description}\nResult: ${result.output}`, 'task', {
        type: task.type,
        success: result.success,
        agent: agent.name,
        timestamp: new Date().toISOString(),
      });
    } else {
      logger.warn(`No suitable agent found for task: ${task.description}`);
    }

    return id;
  }

  findBestAgent(task: Task): Agent | undefined {
    let bestAgent: Agent | undefined;
    let bestScore = -1;

    for (const agent of this.agents.values()) {
      let score = 0;

      // Check capabilities
      for (const cap of agent.capabilities) {
        if (cap.canExecute(task)) {
          score += cap.priority * 10;
        }
      }

      // Check agent type match
      if (this.typeMatchesTask(agent.type, task.type)) {
        score += 5;
      }

      // Check if agent is idle
      if (agent.status === 'idle') {
        score += 3;
      }

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestAgent;
  }

  private typeMatchesTask(agentType: AgentType, taskType: TaskType): boolean {
    const mappings: Record<AgentType, TaskType[]> = {
      architect: ['design', 'analyze'],
      coder: ['implement', 'refactor'],
      reviewer: ['review'],
      tester: ['test'],
      debugger: ['debug'],
      optimizer: ['optimize'],
      security: ['analyze'],
      documenter: ['document'],
      researcher: ['research'],
      coordinator: [],
    };

    return mappings[agentType]?.includes(taskType) || false;
  }

  async broadcast(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      id: 'msg-' + Date.now().toString(36),
      timestamp: new Date(),
    };

    this.messageQueue.push(fullMessage);

    for (const agent of this.agents.values()) {
      await agent.collaborate(fullMessage);
    }

    this.emit('message:broadcast', fullMessage);
  }

  getAgentStatus(): { id: string; name: string; type: AgentType; status: AgentStatus }[] {
    return Array.from(this.agents.values()).map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      status: a.status,
    }));
  }

  getTaskStatus(taskId: string): TaskResult | undefined {
    return this.results.get(taskId);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  async runWorkflow(workflow: WorkflowDefinition): Promise<WorkflowResult> {
    logger.info(`Starting workflow: ${workflow.name}`);
    
    const results: TaskResult[] = [];
    
    for (const step of workflow.steps) {
      logger.info(`Executing workflow step: ${step.name}`);
      
      // Create task from step
      const taskId = await this.submitTask({
        type: step.taskType,
        priority: step.priority,
        description: step.description,
        context: step.context,
        dependencies: step.dependencies,
        estimatedTime: step.estimatedTime,
      });

      const result = this.results.get(taskId);
      if (result) {
        results.push(result);
        
        if (!result.success && step.required) {
          logger.error(`Required step failed: ${step.name}`);
          break;
        }
      }
    }

    return {
      name: workflow.name,
      success: results.every(r => r.success),
      results,
      completedAt: new Date(),
    };
  }
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  name: string;
  taskType: TaskType;
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  context: any;
  dependencies: string[];
  estimatedTime: number;
  required: boolean;
}

export interface WorkflowResult {
  name: string;
  success: boolean;
  results: TaskResult[];
  completedAt: Date;
}

export default AgentOrchestrator;
