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
  [AgentRole.PLANNER]: `You are a Planner agent. Create structured plans as a JSON array.
Break down tasks into clear steps. Each step uses one of: executor, planner, reviewer.
IMPORTANT: Return ONLY a valid JSON array. No extra text before or after.
Commands run in the project root directory already - never use "cd" commands.

Example response:
[
  {"id": "step-1", "description": "Run: find . -name '*.ts'", "agent": "executor", "dependencies": []},
  {"id": "step-2", "description": "Review the output", "agent": "reviewer", "dependencies": ["step-1"]}
]`,

  [AgentRole.EXECUTOR]: `You are an Executor agent. Execute the given step using ONE action.
Available actions:
- shell: Execute a shell command (already runs in project root, do NOT use cd)
- filesystem: Read/write files (use relative paths from project root)

IMPORTANT: Return ONLY valid JSON. No extra text.
IMPORTANT: Never use "cd" in commands. Commands already run in the project directory.

Example:
{"thought": "List TypeScript files", "action": "shell", "input": "find . -name '*.ts'"}
{"thought": "Read a file", "action": "filesystem", "input": "read src/index.ts"}`,

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

    // For simple/conversational tasks, respond directly
    if (this.isSimpleTask(task)) {
      return this.handleSimpleTask(task);
    }

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

      const response = await this.provider.complete(messages, 0.3, 1000);
      
      if (response.error) {
        return { success: false, error: response.error };
      }

      if (!response.content || response.content.trim().length === 0) {
        return { success: false, error: 'LLM returned empty response. Check your API key and credits.' };
      }

      logger.info(`Plan response: ${response.content.substring(0, 200)}`);

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
    const mapStep = (step: any, idx: number): PlanStep => ({
      id: step.id || `step-${idx + 1}`,
      description: step.description || '',
      agent: (step.agent as AgentRole) || AgentRole.EXECUTOR,
      status: StepStatus.PENDING,
      dependencies: step.dependencies || [],
      retry_count: 0,
      max_retries: 3,
    });

    // Try 1: Extract JSON array
    try {
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          logger.info(`Parsed ${parsed.length} steps from JSON array`);
          return parsed.map(mapStep);
        }
      }
    } catch (e) {
      logger.warn('JSON array parse failed, trying individual objects');
    }

    // Try 2: Extract individual JSON objects
    try {
      const objMatches = content.match(/\{[^{}]*"id"[^{}]*"description"[^{}]*\}/g);
      if (objMatches && objMatches.length > 0) {
        const steps: PlanStep[] = [];
        for (let i = 0; i < objMatches.length; i++) {
          try {
            const parsed = JSON.parse(objMatches[i]);
            steps.push(mapStep(parsed, i));
          } catch (e) { /* skip malformed */ }
        }
        if (steps.length > 0) {
          logger.info(`Parsed ${steps.length} steps from individual objects`);
          return steps;
        }
      }
    } catch (e) {
      logger.warn('Individual object parse failed');
    }

    // Fallback: Create single executor step from content
    logger.warn('Using fallback single step plan');
    return [{
      id: 'step-1',
      description: content.trim(),
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

      console.log('DEBUG: Calling provider.complete with messages:', JSON.stringify(messages, null, 2));
      const response = await this.provider.complete(messages, 0.7, 1024);
      console.log('DEBUG: Provider response:', JSON.stringify(response, null, 2));
      
      if (response.error) {
        console.log('DEBUG: Provider returned error:', response.error);
        return { success: false, error: response.error };
      }

      // Parse action from response
      const action = this.parseAction(response.content);
      console.log('DEBUG: Parsed action:', JSON.stringify(action));
      
      if (action.action === 'shell') {
        // Strip cd commands - shell tool already runs in project root
        let cmd = action.input.replace(/^\s*cd\s+[^\s;&&|]+\s*[;&|]*\s*/g, '').trim();
        if (!cmd) cmd = 'echo "No command to run"';
        logger.info(`Shell exec: ${cmd}`);
        const result = await this.shell.run(cmd);
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
  private isSimpleTask(task: string): boolean {
    const simple = task.trim().toLowerCase();
    const simplePatterns = ['hello', 'hi', 'hey', 'merhaba', 'selam', 'test', 'ping', 'help', 'yardım'];
    return simple.split(/\s+/).length <= 3 && simplePatterns.some(p => simple.includes(p));
  }

  private async handleSimpleTask(task: string): Promise<string> {
    try {
      const messages: Message[] = [
        { role: 'system', content: 'You are LinguClaw, a helpful AI coding assistant. Respond concisely and helpfully.' },
        { role: 'user', content: task },
      ];

      const response = await this.provider.complete(messages, 0.7, 500);
      
      if (response.error) {
        return 'Error: ' + response.error;
      }
      if (!response.content || response.content.trim().length === 0) {
        return 'Error: LLM returned empty response. Check your API key and credits.';
      }
      return response.content;
    } catch (error: any) {
      return 'Error: ' + error.message;
    }
  }

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
