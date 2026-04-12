/**
 * Autonomous Task Planning & Decomposition Engine
 * 
 * Core capabilities:
 * - Reasoning Engine: Creates multi-step plans from high-level prompts
 * - Sub-task Execution: Breaks goals into actionable pieces with dependency graphs
 * - Self-Correction: Detects failures and pivots to alternative strategies
 * - Plan Validation: Validates plans before execution
 */

import { EventEmitter } from 'events';
import { Message, LLMResponse, PlanStep, StepStatus, AgentRole } from './types';
import { BaseProvider } from './multi-provider';
import { getLogger } from './logger';

const logger = getLogger();

// ==================== Types ====================

export interface TaskGoal {
  id: string;
  description: string;
  context?: string;
  constraints?: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  deadline?: Date;
  parentGoalId?: string;
}

export interface SubTask {
  id: string;
  goalId: string;
  description: string;
  action: TaskAction;
  dependencies: string[];
  status: SubTaskStatus;
  result?: any;
  error?: string;
  retryCount: number;
  maxRetries: number;
  estimatedDuration: number; // seconds
  actualDuration?: number;
  alternativeStrategies: string[];
  metadata: Record<string, any>;
}

export type SubTaskStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped' | 'retrying' | 'blocked';

export interface TaskAction {
  type: 'shell' | 'filesystem' | 'browse' | 'search' | 'code_exec' | 'api_call' | 'llm_reason' | 'human_input';
  command?: string;
  params?: Record<string, any>;
}

export interface ExecutionPlan {
  id: string;
  goal: TaskGoal;
  subtasks: SubTask[];
  createdAt: Date;
  updatedAt: Date;
  status: 'planning' | 'ready' | 'executing' | 'completed' | 'failed' | 'replanning';
  totalEstimatedDuration: number;
  executionOrder: string[]; // topologically sorted subtask IDs
  corrections: CorrectionRecord[];
}

export interface CorrectionRecord {
  timestamp: Date;
  failedSubtaskId: string;
  errorType: string;
  errorMessage: string;
  strategy: 'retry' | 'alternative' | 'skip' | 'replan' | 'abort';
  newSubtaskId?: string;
  newAction?: string;
  newDescription?: string;
  reasoning: string;
}

export interface PlannerConfig {
  maxSubtasks: number;
  maxRetries: number;
  maxReplans: number;
  enableSelfCorrection: boolean;
  enableParallelExecution: boolean;
  planningTemperature: number;
  executionTimeout: number; // seconds per subtask
}

const DEFAULT_CONFIG: PlannerConfig = {
  maxSubtasks: 20,
  maxRetries: 3,
  maxReplans: 2,
  enableSelfCorrection: true,
  enableParallelExecution: true,
  planningTemperature: 0.3,
  executionTimeout: 120,
};

// ==================== System Prompts ====================

const PLANNING_PROMPT = `You are an autonomous task planner for LinguClaw, an AI agent framework.

Your job is to decompose a high-level goal into a detailed execution plan.

For each subtask, specify:
1. A clear description of what to do
2. The action type: shell, filesystem, browse, search, code_exec, api_call, llm_reason
3. Dependencies (which subtasks must complete first)
4. Alternative strategies if this approach fails
5. Estimated duration in seconds

IMPORTANT RULES:
- Break complex tasks into 3-15 manageable steps
- Each step should be independently verifiable
- Include verification steps after critical operations
- Consider failure modes and provide alternatives
- Order steps logically with proper dependencies
- Never use "cd" in shell commands

Return a JSON array of subtasks:
[
  {
    "id": "task-1",
    "description": "Search for relevant information",
    "action": { "type": "search", "params": { "query": "..." } },
    "dependencies": [],
    "alternativeStrategies": ["Use a different search engine", "Try browsing directly"],
    "estimatedDuration": 10
  }
]`;

const SELF_CORRECTION_PROMPT = `You are a self-correction engine for LinguClaw.

A subtask has failed. Analyze the failure and decide the best recovery strategy.

Strategies:
1. "retry" - Try the same approach again (for transient errors like timeouts)
2. "alternative" - Use one of the predefined alternative strategies
3. "skip" - Skip this subtask if it's not critical
4. "replan" - Create a new plan from the current state
5. "abort" - Stop execution if the failure is unrecoverable

Return JSON:
{
  "strategy": "alternative",
  "reasoning": "The website returned a 403 error, suggesting we're blocked. Switching to an alternative data source.",
  "newAction": { "type": "browse", "params": { "url": "..." } },
  "newDescription": "Fetch data from alternative source"
}`;

// ==================== Task Planner ====================

export class TaskPlanner extends EventEmitter {
  private provider: BaseProvider;
  private config: PlannerConfig;
  private activePlans: Map<string, ExecutionPlan> = new Map();
  private replanCount: Map<string, number> = new Map();

  constructor(provider: BaseProvider, config?: Partial<PlannerConfig>) {
    super();
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create an execution plan from a high-level goal
   */
  async createPlan(goal: TaskGoal, context?: string): Promise<ExecutionPlan> {
    logger.info(`[TaskPlanner] Creating plan for: ${goal.description}`);
    this.emit('planning:start', { goalId: goal.id });

    const messages: Message[] = [
      { role: 'system', content: PLANNING_PROMPT },
      {
        role: 'user',
        content: `Goal: ${goal.description}
${goal.context ? `\nContext: ${goal.context}` : ''}
${context ? `\nAdditional context: ${context}` : ''}
${goal.constraints?.length ? `\nConstraints: ${goal.constraints.join(', ')}` : ''}
Priority: ${goal.priority}`
      },
    ];

    const response = await this.provider.complete(
      messages,
      this.config.planningTemperature,
      2048
    );

    if (response.error || !response.content) {
      throw new Error(`Planning failed: ${response.error || 'Empty response'}`);
    }

    const subtasks = this.parseSubtasks(response.content, goal.id);
    const executionOrder = this.topologicalSort(subtasks);

    const plan: ExecutionPlan = {
      id: `plan-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      goal,
      subtasks,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'ready',
      totalEstimatedDuration: subtasks.reduce((sum, t) => sum + t.estimatedDuration, 0),
      executionOrder,
      corrections: [],
    };

    this.activePlans.set(plan.id, plan);
    this.replanCount.set(plan.id, 0);
    this.emit('planning:complete', { planId: plan.id, subtaskCount: subtasks.length });

    logger.info(`[TaskPlanner] Plan created: ${plan.id} with ${subtasks.length} subtasks`);
    return plan;
  }

  /**
   * Get the next ready subtask(s) for execution
   */
  getReadySubtasks(plan: ExecutionPlan): SubTask[] {
    const completedIds = new Set(
      plan.subtasks
        .filter(t => t.status === 'completed' || t.status === 'skipped')
        .map(t => t.id)
    );

    return plan.subtasks.filter(task => {
      if (task.status !== 'pending' && task.status !== 'ready') return false;
      const depsResolved = task.dependencies.every(dep => completedIds.has(dep));
      if (depsResolved) task.status = 'ready';
      return depsResolved;
    });
  }

  /**
   * Mark a subtask as started
   */
  markRunning(plan: ExecutionPlan, subtaskId: string): void {
    const task = plan.subtasks.find(t => t.id === subtaskId);
    if (task) {
      task.status = 'running';
      task.metadata._startTime = Date.now();
      this.emit('subtask:start', { planId: plan.id, subtaskId, description: task.description });
    }
  }

  /**
   * Mark a subtask as completed
   */
  markCompleted(plan: ExecutionPlan, subtaskId: string, result: any): void {
    const task = plan.subtasks.find(t => t.id === subtaskId);
    if (task) {
      task.status = 'completed';
      task.result = result;
      if (task.metadata._startTime) {
        task.actualDuration = (Date.now() - task.metadata._startTime) / 1000;
      }
      plan.updatedAt = new Date();
      this.emit('subtask:complete', { planId: plan.id, subtaskId, result });
      logger.info(`[TaskPlanner] Subtask completed: ${subtaskId}`);
    }

    // Check if all subtasks are done
    if (plan.subtasks.every(t => t.status === 'completed' || t.status === 'skipped')) {
      plan.status = 'completed';
      this.emit('plan:complete', { planId: plan.id });
    }
  }

  /**
   * Handle subtask failure with self-correction
   */
  async handleFailure(
    plan: ExecutionPlan,
    subtaskId: string,
    error: string
  ): Promise<CorrectionRecord> {
    const task = plan.subtasks.find(t => t.id === subtaskId);
    if (!task) throw new Error(`Subtask ${subtaskId} not found`);

    task.status = 'failed';
    task.error = error;

    logger.warn(`[TaskPlanner] Subtask failed: ${subtaskId} — ${error}`);
    this.emit('subtask:fail', { planId: plan.id, subtaskId, error });

    if (!this.config.enableSelfCorrection) {
      const record: CorrectionRecord = {
        timestamp: new Date(),
        failedSubtaskId: subtaskId,
        errorType: this.classifyError(error),
        errorMessage: error,
        strategy: 'abort',
        reasoning: 'Self-correction disabled',
      };
      plan.corrections.push(record);
      plan.status = 'failed';
      return record;
    }

    // Attempt self-correction
    const correction = await this.selfCorrect(plan, task, error);
    plan.corrections.push(correction);

    switch (correction.strategy) {
      case 'retry':
        if (task.retryCount < task.maxRetries) {
          task.retryCount++;
          task.status = 'retrying';
          task.error = undefined;
          logger.info(`[TaskPlanner] Retrying subtask: ${subtaskId} (attempt ${task.retryCount})`);
        } else {
          task.status = 'failed';
          correction.strategy = 'skip'; // Downgrade to skip after max retries
        }
        break;

      case 'alternative':
        if (correction.newAction) {
          // Create replacement subtask
          const newTask: SubTask = {
            ...task,
            id: `${task.id}-alt-${task.retryCount + 1}`,
            description: correction.newDescription || task.description,
            action: (correction.newAction as unknown) as TaskAction,
            status: 'ready',
            retryCount: 0,
            error: undefined,
            result: undefined,
            metadata: { ...task.metadata, replacedSubtask: subtaskId },
          };
          // Insert after the failed task
          const idx = plan.subtasks.findIndex(t => t.id === subtaskId);
          plan.subtasks.splice(idx + 1, 0, newTask);
          // Update dependencies pointing to old task
          plan.subtasks.forEach(t => {
            const depIdx = t.dependencies.indexOf(subtaskId);
            if (depIdx >= 0) t.dependencies[depIdx] = newTask.id;
          });
          task.status = 'skipped';
          correction.newSubtaskId = newTask.id;
          logger.info(`[TaskPlanner] Alternative strategy: ${newTask.id}`);
        }
        break;

      case 'skip':
        task.status = 'skipped';
        logger.info(`[TaskPlanner] Skipping subtask: ${subtaskId}`);
        break;

      case 'replan':
        const count = this.replanCount.get(plan.id) || 0;
        if (count < this.config.maxReplans) {
          this.replanCount.set(plan.id, count + 1);
          plan.status = 'replanning';
          await this.replan(plan);
          logger.info(`[TaskPlanner] Replanned: ${plan.id}`);
        } else {
          plan.status = 'failed';
          logger.warn(`[TaskPlanner] Max replans reached for: ${plan.id}`);
        }
        break;

      case 'abort':
        plan.status = 'failed';
        logger.warn(`[TaskPlanner] Plan aborted: ${plan.id}`);
        break;
    }

    this.emit('correction', { planId: plan.id, correction });
    return correction;
  }

  /**
   * Self-correction: Analyze failure and decide recovery strategy
   */
  private async selfCorrect(
    plan: ExecutionPlan,
    failedTask: SubTask,
    error: string
  ): Promise<CorrectionRecord> {
    const errorType = this.classifyError(error);

    // Fast path: transient errors → retry
    if (errorType === 'transient') {
      return {
        timestamp: new Date(),
        failedSubtaskId: failedTask.id,
        errorType,
        errorMessage: error,
        strategy: 'retry',
        reasoning: `Transient error detected (${errorType}). Will retry.`,
      };
    }

    // Fast path: has alternatives → use them
    if (failedTask.alternativeStrategies.length > 0 && errorType !== 'auth') {
      try {
        const messages: Message[] = [
          { role: 'system', content: SELF_CORRECTION_PROMPT },
          {
            role: 'user',
            content: `Failed subtask: ${failedTask.description}
Action: ${JSON.stringify(failedTask.action)}
Error: ${error}
Error type: ${errorType}
Available alternatives: ${failedTask.alternativeStrategies.join('; ')}
Previous corrections: ${plan.corrections.length}

Decide the best recovery strategy.`,
          },
        ];

        const response = await this.provider.complete(messages, 0.3, 512);

        if (response.content) {
          const parsed = this.parseCorrectionResponse(response.content);
          return {
            timestamp: new Date(),
            failedSubtaskId: failedTask.id,
            errorType,
            errorMessage: error,
            strategy: (parsed.strategy || 'skip') as CorrectionRecord['strategy'],
            reasoning: parsed.reasoning || 'LLM-guided correction',
            newAction: parsed.newAction,
            newDescription: parsed.newDescription,
          };
        }
      } catch (e: any) {
        logger.warn(`[TaskPlanner] Self-correction LLM call failed: ${e.message}`);
      }
    }

    // Default fallback based on error type
    return {
      timestamp: new Date(),
      failedSubtaskId: failedTask.id,
      errorType,
      errorMessage: error,
      strategy: errorType === 'auth' ? 'abort' : 'skip',
      reasoning: `Fallback: ${errorType} error with no alternatives available.`,
    };
  }

  /**
   * Replan: Create new subtasks for remaining work
   */
  private async replan(plan: ExecutionPlan): Promise<void> {
    const completed = plan.subtasks
      .filter(t => t.status === 'completed')
      .map(t => `✓ ${t.description}: ${String(t.result).substring(0, 200)}`);
    const failed = plan.subtasks
      .filter(t => t.status === 'failed')
      .map(t => `✗ ${t.description}: ${t.error}`);
    const pending = plan.subtasks
      .filter(t => t.status === 'pending' || t.status === 'ready')
      .map(t => `○ ${t.description}`);

    const messages: Message[] = [
      { role: 'system', content: PLANNING_PROMPT },
      {
        role: 'user',
        content: `REPLANNING needed. Original goal: ${plan.goal.description}

Completed steps:
${completed.join('\n')}

Failed steps:
${failed.join('\n')}

Remaining steps (need revision):
${pending.join('\n')}

Create a revised plan for the REMAINING work only. Do not repeat completed steps.`,
      },
    ];

    const response = await this.provider.complete(messages, 0.3, 2048);
    if (response.content) {
      const newSubtasks = this.parseSubtasks(response.content, plan.goal.id);

      // Remove pending/ready tasks and add new ones
      plan.subtasks = plan.subtasks.filter(
        t => t.status === 'completed' || t.status === 'skipped' || t.status === 'failed'
      );
      plan.subtasks.push(...newSubtasks);
      plan.executionOrder = this.topologicalSort(plan.subtasks);
      plan.status = 'executing';
      plan.updatedAt = new Date();
    }
  }

  /**
   * Classify error type for correction strategy
   */
  private classifyError(error: string): string {
    const lower = error.toLowerCase();
    if (lower.includes('timeout') || lower.includes('econnreset') || lower.includes('econnrefused'))
      return 'transient';
    if (lower.includes('404') || lower.includes('not found'))
      return 'not_found';
    if (lower.includes('403') || lower.includes('401') || lower.includes('unauthorized') || lower.includes('forbidden'))
      return 'auth';
    if (lower.includes('captcha') || lower.includes('rate limit') || lower.includes('429'))
      return 'rate_limit';
    if (lower.includes('syntax') || lower.includes('parse'))
      return 'syntax';
    if (lower.includes('permission') || lower.includes('eacces'))
      return 'permission';
    return 'unknown';
  }

  /**
   * Parse subtasks from LLM response
   */
  private parseSubtasks(content: string, goalId: string): SubTask[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) throw new Error('Not an array');

      return parsed.slice(0, this.config.maxSubtasks).map((item: any, idx: number) => ({
        id: item.id || `task-${idx + 1}`,
        goalId,
        description: item.description || '',
        action: this.parseAction(item.action || item),
        dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
        status: 'pending' as SubTaskStatus,
        retryCount: 0,
        maxRetries: this.config.maxRetries,
        estimatedDuration: item.estimatedDuration || 30,
        alternativeStrategies: Array.isArray(item.alternativeStrategies) ? item.alternativeStrategies : [],
        metadata: {},
      }));
    } catch (e: any) {
      logger.warn(`[TaskPlanner] Failed to parse subtasks: ${e.message}`);
      // Fallback: single task
      return [{
        id: 'task-1',
        goalId,
        description: content.trim().substring(0, 500),
        action: { type: 'llm_reason' },
        dependencies: [],
        status: 'pending',
        retryCount: 0,
        maxRetries: this.config.maxRetries,
        estimatedDuration: 60,
        alternativeStrategies: [],
        metadata: {},
      }];
    }
  }

  /**
   * Parse action from subtask data
   */
  private parseAction(data: any): TaskAction {
    if (typeof data === 'object' && data.type) {
      return {
        type: data.type,
        command: data.command,
        params: data.params || {},
      };
    }
    return { type: 'llm_reason' };
  }

  /**
   * Parse correction response from LLM
   */
  private parseCorrectionResponse(content: string): {
    strategy?: string;
    reasoning?: string;
    newAction?: any;
    newDescription?: string;
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) { /* fallback */ }
    return { strategy: 'skip', reasoning: content.substring(0, 200) };
  }

  /**
   * Topological sort of subtask dependency graph
   */
  private topologicalSort(subtasks: SubTask[]): string[] {
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const task of subtasks) {
      if (!graph.has(task.id)) graph.set(task.id, []);
      if (!inDegree.has(task.id)) inDegree.set(task.id, 0);

      for (const dep of task.dependencies) {
        if (!graph.has(dep)) graph.set(dep, []);
        graph.get(dep)!.push(task.id);
        inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);
      for (const neighbor of graph.get(current) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return sorted;
  }

  /**
   * Get plan status summary
   */
  getPlanSummary(plan: ExecutionPlan): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    running: number;
    corrections: number;
    progress: number;
  } {
    const total = plan.subtasks.length;
    const completed = plan.subtasks.filter(t => t.status === 'completed').length;
    const failed = plan.subtasks.filter(t => t.status === 'failed').length;
    const pending = plan.subtasks.filter(t => t.status === 'pending' || t.status === 'ready').length;
    const running = plan.subtasks.filter(t => t.status === 'running').length;

    return {
      total,
      completed,
      failed,
      pending,
      running,
      corrections: plan.corrections.length,
      progress: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  /**
   * Get active plan by ID
   */
  getPlan(planId: string): ExecutionPlan | undefined {
    return this.activePlans.get(planId);
  }
}
