/**
 * Multi-agent orchestration layer
 * TypeScript equivalent of Python orchestrator.py
 */

import { 
  AgentRole, 
  StepStatus, 
  PlanStep, 
  SharedState, 
  ExecutionRecord,
  Message,
  LLMResponse 
} from './types';

export { SharedState } from './types';
import { ShellTool, FileSystemTool } from './tools';
import { SafetyMiddleware } from './safety';
import { getLogger } from './logger';
import { BaseProvider } from './multi-provider';

const logger = getLogger();

// System prompts for each agent role
const SYSTEM_PROMPTS: Record<AgentRole, string> = {
  [AgentRole.PLANNER]: `You are a Planner agent. Your job is to create structured, actionable plans.
Break down complex tasks into clear steps. Each step should be assignable to either:
- PLANNER (strategy/decision making)
- EXECUTOR (tool usage, file operations, shell commands)
- REVIEWER (validation, error checking, final approval)

Output format: Return a JSON array of steps with fields:
{
  "id": "step-1",
  "description": "Clear instruction",
  "agent": "executor",
  "dependencies": []
}`,

  [AgentRole.EXECUTOR]: `You are an Executor agent. Your job is to execute the current step using available tools.
Available tools:
- shell: Execute commands (Docker sandboxed)
- filesystem: Read/write files (sandboxed to project root)
- search: Search codebase memory

Think step by step, then take ONE action. After each action, wait for the result.

Output format: Return JSON with:
{
  "thought": "Your reasoning",
  "action": "tool_name",
  "input": "command or params"
}`,

  [AgentRole.REVIEWER]: `You are a Reviewer agent. Your job is to validate the execution result.
Check for:
- Errors or incomplete work
- Safety issues
- Quality standards
- Alignment with the original task

Output format: Return JSON with:
{
  "review": "Your assessment",
  "approved": true/false,
  "feedback": "If rejected, explain why and what to fix"
}`,
};

export class Orchestrator {
  provider: BaseProvider;
  shell: ShellTool;
  fs: FileSystemTool;
  safety: SafetyMiddleware;
  maxIterations: number;
  state: SharedState;

  constructor(
    provider: BaseProvider,
    shell: ShellTool,
    fs: FileSystemTool,
    maxIterations: number = 15
  ) {
    this.provider = provider;
    this.shell = shell;
    this.fs = fs;
    this.safety = new SafetyMiddleware();
    this.maxIterations = maxIterations;
    this.state = {
      task: '',
      plan: [],
      current_step_idx: -1,
      execution_log: [],
      files_modified: [],
      context: new Map(),
      iteration: 0,
      max_iterations: maxIterations,
      aborted: false,
    };
  }

  /**
   * Main execution loop
   */
  async run(task: string): Promise<string> {
    this.state.task = task;
    
    logger.info(`Starting orchestration for: ${task}`);

    // Phase 1: Planning
    const planResult = await this.planPhase(task);
    if (!planResult.success) {
      return `Planning failed: ${planResult.error}`;
    }

    // Phase 2: Execute plan steps
    for (let i = 0; i < this.state.plan.length; i++) {
      if (this.state.aborted || this.state.iteration >= this.maxIterations) {
        break;
      }

      this.state.current_step_idx = i;
      const step = this.state.plan[i];

      // Check dependencies
      if (step.dependencies.length > 0) {
        const depsCompleted = step.dependencies.every(depId => {
          const dep = this.state.plan.find(p => p.id === depId);
          return dep && dep.status === StepStatus.COMPLETED;
        });
        if (!depsCompleted) {
          step.status = StepStatus.PENDING;
          continue;
        }
      }

      // Execute step based on agent role
      step.status = StepStatus.IN_PROGRESS;
      const result = await this.executeStep(step);

      if (result.success) {
        step.status = StepStatus.COMPLETED;
        step.result = result.output;
      } else {
        step.status = StepStatus.FAILED;
        step.error = result.error;
        
        // Retry logic
        if (step.retry_count < step.max_retries) {
          step.retry_count++;
          step.status = StepStatus.RETRYING;
          i--; // Retry this step
        }
      }

      this.state.iteration++;
    }

    // Phase 3: Final review and summary
    return this.generateSummary();
  }

  /**
   * Planning phase
   */
  private async planPhase(task: string): Promise<{ success: boolean; error?: string }> {
    try {
      const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPTS[AgentRole.PLANNER] },
        { role: 'user', content: `Create a plan for: ${task}` },
      ];

      const response = await this.provider.complete(messages, 0.3, 2048);
      
      if (response.error) {
        return { success: false, error: response.error };
      }

      // Parse plan from response
      const plan = this.parsePlan(response.content);
      this.state.plan = plan;
      
      logger.info(`Created plan with ${plan.length} steps`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse plan from LLM response
   */
  private parsePlan(content: string): PlanStep[] {
    try {
      // Try to extract JSON
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.map((step: any, idx: number) => ({
          id: step.id || `step-${idx + 1}`,
          description: step.description,
          agent: step.agent as AgentRole,
          status: StepStatus.PENDING,
          dependencies: step.dependencies || [],
          retry_count: 0,
          max_retries: 3,
        }));
      }
    } catch (error) {
      logger.warn('Failed to parse structured plan, using fallback');
    }

    // Fallback: Create single executor step
    return [{
      id: 'step-1',
      description: content,
      agent: AgentRole.EXECUTOR,
      status: StepStatus.PENDING,
      dependencies: [],
      retry_count: 0,
      max_retries: 3,
    }];
  }

  /**
   * Execute a single plan step
   */
  private async executeStep(step: PlanStep): Promise<{ success: boolean; output?: string; error?: string }> {
    switch (step.agent) {
      case AgentRole.EXECUTOR:
        return this.executeToolStep(step);
      case AgentRole.PLANNER:
        return this.executeDecisionStep(step);
      case AgentRole.REVIEWER:
        return this.executeReviewStep(step);
      default:
        return { success: false, error: `Unknown agent role: ${step.agent}` };
    }
  }

  /**
   * Execute tool-based step (shell, filesystem)
   */
  private async executeToolStep(step: PlanStep): Promise<{ success: boolean; output?: string; error?: string }> {
    try {
      const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPTS[AgentRole.EXECUTOR] },
        { role: 'user', content: step.description },
      ];

      const response = await this.provider.complete(messages, 0.7, 1024);
      
      if (response.error) {
        return { success: false, error: response.error };
      }

      // Parse action from response
      const action = this.parseAction(response.content);
      
      if (action.action === 'shell') {
        const result = await this.shell.run(action.input);
        return {
          success: result.returncode === 0,
          output: result.stdout,
          error: result.stderr || undefined,
        };
      } else if (action.action === 'filesystem') {
        // Parse filesystem command
        const parts = action.input.split(' ');
        const cmd = parts[0];
        const filePath = parts[1];

        if (cmd === 'read') {
          const result = this.fs.read(filePath);
          return { success: result.success, output: result.content !== null ? result.content : undefined, error: result.error || undefined };
        } else if (cmd === 'write') {
          const content = parts.slice(2).join(' ');
          const result = this.fs.write(filePath, content);
          return { success: result.success, error: result.error || undefined };
        }
      }

      return { success: true, output: response.content };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute decision/planning step
   */
  private async executeDecisionStep(step: PlanStep): Promise<{ success: boolean; output?: string; error?: string }> {
    // Decision steps mainly update the plan or state
    return { success: true, output: 'Decision made' };
  }

  /**
   * Execute review step
   */
  private async executeReviewStep(step: PlanStep): Promise<{ success: boolean; output?: string; error?: string }> {
    try {
      const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPTS[AgentRole.REVIEWER] },
        { role: 'user', content: `Review task: ${this.state.task}\nPlan: ${JSON.stringify(this.state.plan)}` },
      ];

      const response = await this.provider.complete(messages, 0.3, 1024);
      
      // Parse review result
      const approved = response.content.toLowerCase().includes('approved: true') ||
                       response.content.toLowerCase().includes('"approved": true');

      return { success: approved, output: response.content };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse action from executor response
   */
  private parseAction(content: string): { action: string; input: string } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          action: parsed.action || 'unknown',
          input: parsed.input || parsed.command || '',
        };
      }
    } catch {
      // Fallback: treat entire content as thought
    }
    return { action: 'unknown', input: content };
  }

  /**
   * Generate final summary
   */
  private generateSummary(): string {
    const completed = this.state.plan.filter(s => s.status === StepStatus.COMPLETED).length;
    const failed = this.state.plan.filter(s => s.status === StepStatus.FAILED).length;
    const total = this.state.plan.length;

    let summary = `# Execution Summary\n\n`;
    summary += `Task: ${this.state.task}\n`;
    summary += `Steps: ${completed}/${total} completed, ${failed} failed\n\n`;
    
    summary += `## Results\n\n`;
    for (const step of this.state.plan) {
      const icon = step.status === StepStatus.COMPLETED ? '✅' : 
                   step.status === StepStatus.FAILED ? '❌' : '⏳';
      summary += `${icon} **${step.id}**: ${step.description}\n`;
      if (step.result) {
        summary += `   Result: ${step.result}\n`;
      }
      if (step.error) {
        summary += `   Error: ${step.error}\n`;
      }
    }

    return summary;
  }
}
