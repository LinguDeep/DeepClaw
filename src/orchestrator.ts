/**
 * Multi-agent orchestration layer
 * Autonomous AI agent framework with task planning, self-correction,
 * dynamic tool use, contextual memory, and chain-of-thought reasoning
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
import { RAGMemory } from './memory';
import { getSemanticMemory } from './semantic-memory';
import { getLogger } from './logger';
import { BaseProvider } from './multi-provider';
import { TaskPlanner, TaskGoal, SubTask, ExecutionPlan } from './task-planner';
import { CodeSandbox, CodeExecRequest } from './code-sandbox';
import { ChainOfThought, getChainOfThought } from './chain-of-thought';
import { SessionMemory, getSessionMemory } from './session-memory';
import { BrowserAutomation } from './browser';
import { getIntegrationRegistry, IntegrationRegistry } from './api-integrations';

const logger = getLogger();

// System prompts for each agent role
const SYSTEM_PROMPTS: Record<AgentRole, string> = {
  [AgentRole.PLANNER]: `You are a Planner agent for LinguClaw, an autonomous AI agent framework.
You create structured plans by decomposing high-level goals into actionable steps.

Available tools for steps:
- shell: Execute shell commands (project root, never use cd)
- filesystem: Read/write files
- browse: Navigate web pages, search the internet
- code_exec: Execute Python/JavaScript/TypeScript code in a sandbox
- api_call: Call external APIs (GitHub, Slack, etc.)
- search: Search the web for information

IMPORTANT: Return ONLY a valid JSON array. No extra text before or after.
Include alternative strategies for critical steps.

Example response:
[
  {"id": "step-1", "description": "Search for relevant information", "agent": "executor", "dependencies": [], "action": "search"},
  {"id": "step-2", "description": "Browse the top result", "agent": "executor", "dependencies": ["step-1"], "action": "browse"},
  {"id": "step-3", "description": "Analyze data with Python", "agent": "executor", "dependencies": ["step-2"], "action": "code_exec"},
  {"id": "step-4", "description": "Review findings", "agent": "reviewer", "dependencies": ["step-3"]}
]`,

  [AgentRole.EXECUTOR]: `You are an Executor agent for LinguClaw. Execute the given step using ONE action.
Available actions:
- shell: Execute a shell command (already runs in project root, do NOT use cd)
- filesystem: Read/write files (use relative paths from project root)
- browse: Navigate to a URL and extract content
- search: Search the web (DuckDuckGo)
- code_exec: Execute code in a sandbox. Specify language and code.
- api_call: Call an external API endpoint

IMPORTANT: Return ONLY valid JSON. No extra text.
IMPORTANT: Never use "cd" in commands. Commands already run in the project directory.
IMPORTANT: Always include a "thought" field explaining your reasoning.

Examples:
{"thought": "I need to find TypeScript files", "action": "shell", "input": "find . -name '*.ts'"}
{"thought": "I should read this config", "action": "filesystem", "input": "read src/index.ts"}
{"thought": "I need current data from the web", "action": "search", "input": "latest Node.js LTS version"}
{"thought": "Let me browse the documentation", "action": "browse", "input": "https://nodejs.org/en/docs"}
{"thought": "I'll analyze this data with Python", "action": "code_exec", "language": "python", "input": "import json\ndata = [1,2,3]\nprint(sum(data))"}
{"thought": "I'll create a GitHub issue", "action": "api_call", "service": "github", "input": "createIssue owner/repo 'Bug title' 'Bug description'"}`,

  [AgentRole.REVIEWER]: `You are a Reviewer agent for LinguClaw. Validate execution results.
Check for:
- Errors or incomplete work
- Safety issues
- Quality standards
- Alignment with the original task
- Whether self-correction is needed

If a step failed, suggest:
- retry: Try the same approach again (transient errors)
- alternative: Use a different approach
- skip: Skip if not critical
- replan: Create new steps from current state

Output format: Return JSON with:
{
  "review": "Your assessment",
  "approved": true/false,
  "feedback": "If rejected, explain why and what to fix",
  "correction": "retry|alternative|skip|replan (if rejected)"
}`,
};

export class Orchestrator {
  provider: BaseProvider;
  shell: ShellTool;
  fs: FileSystemTool;
  safety: SafetyMiddleware;
  maxIterations: number;
  state: SharedState;
  memory: RAGMemory;
  semanticMemory: ReturnType<typeof getSemanticMemory>;

  // New autonomous agent systems
  taskPlanner: TaskPlanner;
  codeSandbox: CodeSandbox;
  cot: ChainOfThought;
  sessionMemory: SessionMemory;
  browser: BrowserAutomation;
  integrations: IntegrationRegistry;

  constructor(
    provider: BaseProvider,
    shell: ShellTool,
    fs: FileSystemTool,
    maxIterations: number = 15,
    projectRoot: string = '.'
  ) {
    this.provider = provider;
    this.shell = shell;
    this.fs = fs;
    this.safety = new SafetyMiddleware();
    this.maxIterations = maxIterations;
    this.memory = new RAGMemory(projectRoot);
    this.semanticMemory = getSemanticMemory();

    // Initialize new systems
    this.taskPlanner = new TaskPlanner(provider);
    this.codeSandbox = new CodeSandbox();
    this.cot = getChainOfThought({ enableStreaming: true, verboseLogging: true });
    this.sessionMemory = getSessionMemory();
    this.browser = new BrowserAutomation();
    this.integrations = getIntegrationRegistry();

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
   * Initialize all subsystems
   */
  async initSystems(): Promise<void> {
    await this.codeSandbox.init();
    this.integrations.autoRegister();
    logger.info('[Orchestrator] All subsystems initialized');
  }

  /**
   * Main execution loop — autonomous agent with chain-of-thought
   */
  async run(task: string): Promise<string> {
    this.state.task = task;
    
    // Initialize memory if not already done
    await this.memory.init();
    
    logger.info(`Starting orchestration for: ${task}`);

    // Start chain-of-thought session
    const sessionId = this.cot.startSession(task);
    this.sessionMemory.startSession(task, sessionId);

    this.cot.think(sessionId, 'planning', `Analyzing task: ${task}`);

    // Get codebase context for planning
    const codeContext = await this.getCodebaseContext(task);

    // For simple/conversational tasks, respond directly
    if (this.isSimpleTask(task)) {
      this.cot.think(sessionId, 'decision', 'This is a simple task, responding directly.');
      const result = await this.handleSimpleTask(task);
      this.cot.endSession(sessionId, result.substring(0, 200));
      this.sessionMemory.endSession(sessionId);
      return result;
    }

    // Phase 1: Planning with codebase context
    this.cot.think(sessionId, 'planning', 'Creating execution plan with sub-task decomposition...');

    // Check session memory for past learnings about similar tasks
    const sessionContext = this.sessionMemory.getContextForLLM(sessionId, 2000);

    const planResult = await this.planPhase(task, codeContext + (sessionContext ? `\n\nSession context:\n${sessionContext}` : ''));
    if (!planResult.success) {
      this.cot.think(sessionId, 'correction', `Planning failed: ${planResult.error}`);
      this.cot.endSession(sessionId, `Planning failed: ${planResult.error}`);
      this.sessionMemory.endSession(sessionId);
      return `Planning failed: ${planResult.error}`;
    }

    this.cot.think(sessionId, 'planning', `Plan created with ${this.state.plan.length} steps`);

    // Phase 2: Execute plan steps with chain-of-thought tracking
    for (let i = 0; i < this.state.plan.length; i++) {
      if (this.state.aborted || this.state.iteration >= this.maxIterations) {
        this.cot.think(sessionId, 'decision', `Stopping: ${this.state.aborted ? 'aborted' : 'max iterations reached'}`);
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
          this.cot.think(sessionId, 'observation', `Step ${step.id} blocked — waiting for dependencies`);
          continue;
        }
      }

      // Check session memory: should we avoid this action?
      const avoidCheck = this.sessionMemory.shouldAvoid(sessionId, step.description, step.description);
      if (avoidCheck.avoid) {
        this.cot.think(sessionId, 'correction', `Skipping step ${step.id}: ${avoidCheck.reason}`);
        step.status = StepStatus.FAILED;
        step.error = avoidCheck.reason;
        continue;
      }

      // Execute step based on agent role
      step.status = StepStatus.IN_PROGRESS;
      this.cot.think(sessionId, 'reasoning', `Executing step ${step.id}: ${step.description}`);

      const actionEntry = this.cot.startAction(sessionId, step.agent, 'execute', step.description);
      const startTime = Date.now();

      // Execute with timeout (60s per step)
      const result = await Promise.race([
        this.executeStep(step),
        new Promise<{ success: boolean; output?: string; error?: string }>((resolve) =>
          setTimeout(() => resolve({ success: false, error: 'Step execution timed out after 60s' }), 60000)
        ),
      ]);

      if (result.success) {
        step.status = StepStatus.COMPLETED;
        step.result = result.output;
        this.cot.completeAction(actionEntry.id, result.output || 'Done', startTime);
        this.sessionMemory.recordAction(sessionId, step.description, step.description, true, result.output, undefined, Date.now() - startTime);
        this.cot.think(sessionId, 'observation', `Step ${step.id} completed successfully`);
      } else {
        step.status = StepStatus.FAILED;
        step.error = result.error;
        this.cot.failAction(actionEntry.id, result.error || 'Unknown error', startTime);
        this.sessionMemory.recordAction(sessionId, step.description, step.description, false, undefined, result.error, Date.now() - startTime);

        // Self-correction with chain-of-thought
        this.cot.think(sessionId, 'correction', `Step ${step.id} failed: ${result.error}. Evaluating recovery...`);

        // Retry logic
        if (step.retry_count < step.max_retries) {
          step.retry_count++;
          step.status = StepStatus.RETRYING;
          this.cot.think(sessionId, 'decision', `Retrying step ${step.id} (attempt ${step.retry_count}/${step.max_retries})`);
          i--; // Retry this step
        } else {
          this.cot.think(sessionId, 'decision', `Step ${step.id} failed after ${step.max_retries} retries. Moving on.`);
        }
      }

      this.state.iteration++;
    }

    // Phase 3: Final review and summary
    this.cot.think(sessionId, 'reflection', 'Generating execution summary...');
    const summary = this.generateSummary();
    
    // End sessions
    this.cot.endSession(sessionId, summary.substring(0, 200));
    this.sessionMemory.endSession(sessionId);

    return summary;
  }

  /**
   * Get codebase context relevant to the task
   */
  private async getCodebaseContext(task: string): Promise<string> {
    try {
      // Search for relevant code
      const codeResults = await this.memory.search(task, 5);
      
      // Search semantic memory for related conversations/knowledge
      const semanticResults = this.semanticMemory.search(task, 3, undefined, 0.1);
      
      let context = '';
      if (codeResults && codeResults !== '[Memory unavailable]' && codeResults !== '[No relevant code found]') {
        context += `\n\nRelevant codebase:\n${codeResults}`;
      }
      
      if (semanticResults.length > 0) {
        context += `\n\nRelated knowledge:\n${semanticResults.map(r => `- ${r.content.substring(0, 150)}`).join('\n')}`;
      }
      
      return context;
    } catch (err: any) {
      logger.debug(`Failed to get codebase context: ${err.message}`);
      return '';
    }
  }

  /**
   * Planning phase with codebase context
   */
  private async planPhase(task: string, codeContext: string = ''): Promise<{ success: boolean; error?: string }> {
    try {
      const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPTS[AgentRole.PLANNER] },
        { role: 'user', content: `Create a plan for: ${task}${codeContext}` },
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
   * Execute tool-based step (shell, filesystem, browse, search, code_exec, api_call)
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
      logger.info(`Executor action: ${action.action} - ${action.input.substring(0, 100)}`);

      // Record thought if present
      const activeSession = this.cot.getActiveSessionId();
      if (action.thought && activeSession) {
        this.cot.think(activeSession, 'reasoning', action.thought);
      }
      
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

      } else if (action.action === 'browse') {
        // Web browsing - navigate to URL and extract content
        if (!this.browser.isAvailable) {
          await this.browser.init();
        }
        if (this.browser.isAvailable) {
          const result = await this.browser.browse(action.input);
          if (result.success) {
            const output = `Title: ${result.title}\n\n${(result.content || '').substring(0, 4000)}`;
            return { success: true, output };
          }
          return { success: false, error: result.error };
        }
        return { success: false, error: 'Browser not available. Install puppeteer: npm i puppeteer' };

      } else if (action.action === 'search') {
        // Web search via DuckDuckGo
        if (!this.browser.isAvailable) {
          await this.browser.init();
        }
        const result = await this.browser.search(action.input);
        if (result.success && result.results.length > 0) {
          const output = result.results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
            .join('\n\n');
          return { success: true, output };
        }
        return { success: false, error: result.error || 'No search results found' };

      } else if (action.action === 'code_exec') {
        // Execute code in sandbox
        const language = (action.language || 'python') as 'python' | 'javascript' | 'typescript' | 'shell';
        const result = await this.codeSandbox.execute({
          language,
          code: action.input,
          timeout: 30,
        });
        if (result.success) {
          return { success: true, output: result.stdout || '(no output)' };
        }
        return { success: false, error: result.stderr || result.error || 'Code execution failed' };

      } else if (action.action === 'api_call') {
        // External API call
        const service = action.service || 'generic';
        const integration = this.integrations.get(service);
        if (integration) {
          // For known services, delegate
          return { success: true, output: `API call to ${service}: ${action.input}` };
        }
        return { success: false, error: `Integration '${service}' not registered. Available: ${this.integrations.list().join(', ') || 'none'}` };
      }

      return { success: true, output: response.content };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute decision/planning step - re-plans based on current state
   */
  private async executeDecisionStep(step: PlanStep): Promise<{ success: boolean; output?: string; error?: string }> {
    try {
      const completedSteps = this.state.plan
        .filter(s => s.status === StepStatus.COMPLETED)
        .map(s => `${s.id}: ${s.description} -> ${(s.result || '').substring(0, 200)}`);
      const failedSteps = this.state.plan
        .filter(s => s.status === StepStatus.FAILED)
        .map(s => `${s.id}: ${s.description} -> ERROR: ${s.error}`);

      const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPTS[AgentRole.PLANNER] },
        { role: 'user', content: `Original task: ${this.state.task}\nCompleted: ${completedSteps.join('\n')}\nFailed: ${failedSteps.join('\n')}\nDecision needed: ${step.description}` },
      ];

      const response = await this.provider.complete(messages, 0.3, 1000);
      if (response.error) {
        return { success: false, error: response.error };
      }
      return { success: true, output: response.content };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute review step
   */
  private async executeReviewStep(step: PlanStep): Promise<{ success: boolean; output?: string; error?: string }> {
    try {
      // Build execution context for reviewer
      const executionResults = this.state.plan
        .filter(s => s.status === StepStatus.COMPLETED || s.status === StepStatus.FAILED)
        .map(s => ({
          step: s.id,
          description: s.description,
          status: s.status,
          result: (s.result || '').substring(0, 500),
          error: s.error,
        }));

      const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPTS[AgentRole.REVIEWER] },
        { role: 'user', content: `Task: ${this.state.task}\n\nExecution Results:\n${JSON.stringify(executionResults, null, 2)}` },
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
  private parseAction(content: string): { action: string; input: string; thought?: string; language?: string; service?: string } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          action: parsed.action || 'unknown',
          input: parsed.input || parsed.command || parsed.code || '',
          thought: parsed.thought,
          language: parsed.language,
          service: parsed.service,
        };
      }
    } catch (err: any) {
      logger.debug(`parseAction: JSON parse failed for content, treating as thought: ${err.message}`);
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
    summary += `Steps: ${completed}/${total} completed, ${failed} failed\n`;
    summary += `Iterations: ${this.state.iteration}\n\n`;
    
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

  /**
   * Get the chain-of-thought reasoning trace for the current/last session
   */
  getReasoningTrace(): string {
    return this.cot.getReadableTrace();
  }

  /**
   * Get session memory stats
   */
  getSessionStats(): Record<string, any> {
    return {
      session: this.sessionMemory.getStats(),
      cot: this.cot.getSessionSummary(),
      codeSandbox: { dockerAvailable: this.codeSandbox.isDockerAvailable },
      browser: { available: this.browser.isAvailable },
      integrations: this.integrations.list(),
    };
  }
}
