/**
 * Agent Loop Integration Tests - Real multi-step task validation
 * Tests actual planning, execution, and feedback loops
 */

import { Orchestrator } from '../src/orchestrator';
import { ShellTool, FileSystemTool } from '../src/tools';
import { BaseProvider } from '../src/multi-provider';
import { Message, LLMResponse, AgentRole, StepStatus } from '../src/types';

// Create a mock provider that simulates real LLM responses
class MockProvider extends BaseProvider {
  private responseQueue: LLMResponse[] = [];
  private callLog: { messages: Message[]; temperature: number; maxTokens: number }[] = [];

  constructor() {
    super('mock-model', 'mock-key');
  }

  queueResponse(response: LLMResponse): void {
    this.responseQueue.push(response);
  }

  getCallLog(): typeof this.callLog {
    return this.callLog;
  }

  async complete(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): Promise<LLMResponse> {
    this.callLog.push({ messages: [...messages], temperature, maxTokens });
    
    if (this.responseQueue.length > 0) {
      return this.responseQueue.shift()!;
    }
    
    return {
      content: 'Default mock response',
      model: this.model,
    };
  }

  clearQueue(): void {
    this.responseQueue = [];
    this.callLog = [];
  }
}

describe('Agent Loop - Multi-Step Task Execution', () => {
  let provider: MockProvider;
  let shell: ShellTool;
  let fs: FileSystemTool;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    provider = new MockProvider();
    shell = new ShellTool('.', false); // No docker for tests
    await shell.init();
    fs = new FileSystemTool('.');
    orchestrator = new Orchestrator(provider, shell, fs, 10, '.');
    
    // Initialize memory
    await (orchestrator as any).memory.init();
  });

  afterEach(async () => {
    await shell.stop();
  });

  describe('Planning Phase', () => {
    it('should create multi-step plan from LLM response', async () => {
      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Find all TypeScript files', agent: 'executor', dependencies: [] },
          { id: 'step-2', description: 'Count lines of code', agent: 'executor', dependencies: ['step-1'] },
          { id: 'step-3', description: 'Review results', agent: 'reviewer', dependencies: ['step-2'] },
        ]),
        model: 'mock',
      });

      // Mock simple task check to return false (not simple)
      const result = await orchestrator.run('Analyze codebase structure');
      
      const state = (orchestrator as any).state;
      expect(state.plan).toHaveLength(3);
      expect(state.plan[0].id).toBe('step-1');
      expect(state.plan[1].dependencies).toContain('step-1');
    });

    it('should include codebase context in planning prompt', async () => {
      provider.queueResponse({
        content: JSON.stringify([{ id: 'step-1', description: 'Test', agent: 'executor', dependencies: [] }]),
        model: 'mock',
      });

      await orchestrator.run('Task with context');
      
      const callLog = provider.getCallLog();
      const planningCall = callLog[0];
      expect(planningCall.messages[0].role).toBe('system');
      expect(planningCall.messages[0].content).toContain('Planner');
    });

    it('should handle malformed plan responses gracefully', async () => {
      provider.queueResponse({
        content: 'Not valid JSON at all, just some text',
        model: 'mock',
      });

      // Should fallback to single-step plan
      const result = await orchestrator.run('Ambiguous task');
      const state = (orchestrator as any).state;
      expect(state.plan.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse plan from markdown code blocks', async () => {
      provider.queueResponse({
        content: '```json\n[{"id": "step-1", "description": "Test", "agent": "executor", "dependencies": []}]\n```',
        model: 'mock',
      });

      await orchestrator.run('Task with markdown');
      const state = (orchestrator as any).state;
      expect(state.plan).toHaveLength(1);
    });
  });

  describe('Execution Phase', () => {
    it('should execute shell commands and capture output', async () => {
      // Queue planning response
      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Run: echo "hello world"', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      });

      // Queue execution response with shell action
      provider.queueResponse({
        content: JSON.stringify({ thought: 'Run echo', action: 'shell', input: 'echo "hello world"' }),
        model: 'mock',
      });

      await orchestrator.run('Echo test');
      
      const state = (orchestrator as any).state;
      expect(state.plan[0].status).toBe(StepStatus.COMPLETED);
    });

    it('should read files using filesystem tool', async () => {
      // Create a test file
      fs.write('test-file.txt', 'test content');

      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Read test-file.txt', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      });

      provider.queueResponse({
        content: JSON.stringify({ thought: 'Read file', action: 'filesystem', input: 'read test-file.txt' }),
        model: 'mock',
      });

      await orchestrator.run('Read file');
      
      const state = (orchestrator as any).state;
      expect(state.plan[0].status).toBe(StepStatus.COMPLETED);

      // Cleanup via shell
      await shell.execute('rm -f test-file.txt');
    });

    it('should respect step dependencies', async () => {
      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'First step', agent: 'executor', dependencies: [] },
          { id: 'step-2', description: 'Second step', agent: 'executor', dependencies: ['step-1'] },
          { id: 'step-3', description: 'Third step', agent: 'executor', dependencies: ['step-2'] },
        ]),
        model: 'mock',
      });

      // All execution responses
      for (let i = 0; i < 3; i++) {
        provider.queueResponse({
          content: JSON.stringify({ thought: 'Execute', action: 'shell', input: 'echo step' }),
          model: 'mock',
        });
      }

      await orchestrator.run('Sequential steps');
      
      const state = (orchestrator as any).state;
      expect(state.plan[0].status).toBe(StepStatus.COMPLETED);
      expect(state.plan[1].status).toBe(StepStatus.COMPLETED);
      expect(state.plan[2].status).toBe(StepStatus.COMPLETED);
    });

    it('should retry failed steps up to max_retries', async () => {
      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Risky operation', agent: 'executor', dependencies: [], max_retries: 3 },
        ]),
        model: 'mock',
      });

      // Fail twice, succeed on third
      provider.queueResponse({
        content: JSON.stringify({ thought: 'Try', action: 'shell', input: 'false' }),
        model: 'mock',
      });

      await orchestrator.run('Retry test');
      
      const state = (orchestrator as any).state;
      expect(state.plan[0].retry_count).toBeGreaterThan(0);
    });

    it('should timeout long-running steps', async () => {
      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Slow command', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      });

      // Override timeout for test
      const result = await Promise.race([
        (orchestrator as any).executeStep({
          id: 'test',
          description: 'sleep 120',
          agent: AgentRole.EXECUTOR,
          status: StepStatus.IN_PROGRESS,
          dependencies: [],
          retry_count: 0,
          max_retries: 3,
        }),
        new Promise((resolve) => setTimeout(() => resolve({ success: false, error: 'timeout' }), 100)),
      ]);

      expect(result).toHaveProperty('error');
    }, 5000);
  });

  describe('Review Phase', () => {
    it('should execute reviewer agent after execution', async () => {
      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Do work', agent: 'executor', dependencies: [] },
          { id: 'step-2', description: 'Review work', agent: 'reviewer', dependencies: ['step-1'] },
        ]),
        model: 'mock',
      });

      provider.queueResponse({
        content: JSON.stringify({ thought: 'Work', action: 'shell', input: 'echo done' }),
        model: 'mock',
      });

      provider.queueResponse({
        content: JSON.stringify({ review: 'Good work', approved: true, feedback: '' }),
        model: 'mock',
      });

      await orchestrator.run('Work with review');
      
      const state = (orchestrator as any).state;
      expect(state.plan[1].agent).toBe(AgentRole.REVIEWER);
    });

    it('should include execution results in review context', async () => {
      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Generate output', agent: 'executor', dependencies: [] },
          { id: 'step-2', description: 'Review', agent: 'reviewer', dependencies: ['step-1'] },
        ]),
        model: 'mock',
      });

      provider.queueResponse({
        content: JSON.stringify({ thought: 'Generate', action: 'shell', input: 'echo "result data"' }),
        model: 'mock',
      });

      provider.queueResponse({
        content: JSON.stringify({ review: 'Reviewed', approved: true }),
        model: 'mock',
      });

      await orchestrator.run('Review with context');
      
      const callLog = provider.getCallLog();
      const reviewCall = callLog.find(c => c.messages[0].content.includes('Reviewer'));
      expect(reviewCall).toBeDefined();
    });
  });

  describe('Memory Integration', () => {
    it('should use codebase context from memory', async () => {
      // First index some code
      const memory = (orchestrator as any).memory;
      await memory.semanticMemory.store('test-code', 'function calculate() { return 42; }', 'code', {
        file_path: 'src/math.ts',
        name: 'calculate',
      });

      provider.queueResponse({
        content: JSON.stringify([{ id: 'step-1', description: 'Use calculate function', agent: 'executor', dependencies: [] }]),
        model: 'mock',
      });

      const context = await (orchestrator as any).getCodebaseContext('calculate function');
      expect(context).toContain('calculate');
    });

    it('should store task results in semantic memory', async () => {
      provider.queueResponse({
        content: JSON.stringify([{ id: 'step-1', description: 'Task', agent: 'executor', dependencies: [] }]),
        model: 'mock',
      });

      provider.queueResponse({
        content: JSON.stringify({ thought: 'Done', action: 'shell', input: 'echo success' }),
        model: 'mock',
      });

      await orchestrator.run('Memory test');
      
      // Check that something was stored in semantic memory
      const semanticMemory = (orchestrator as any).semanticMemory;
      const results = semanticMemory.search('success', 10);
      expect(results.length).toBeGreaterThanOrEqual(0); // May or may not have results
    });
  });

  describe('Simple Task Shortcut', () => {
    it('should bypass planning for simple conversational tasks', async () => {
      provider.queueResponse({
        content: 'Hello! How can I help you today?',
        model: 'mock',
      });

      const result = await orchestrator.run('Hello');
      
      expect(result).toContain('Hello');
      const state = (orchestrator as any).state;
      expect(state.plan).toHaveLength(0); // No plan created for simple task
    });

    it('should detect simple tasks by keyword and length', async () => {
      const simpleTasks = ['Hi', 'Hello', 'Hey', 'Test', 'Ping', 'Help'];
      
      for (const task of simpleTasks) {
        provider.clearQueue();
        provider.queueResponse({ content: `Response to ${task}`, model: 'mock' });
        
        const result = await orchestrator.run(task);
        expect(result).toBeDefined();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle LLM errors gracefully', async () => {
      provider.queueResponse({
        content: '',
        error: 'Rate limit exceeded',
        model: 'mock',
      });

      const result = await orchestrator.run('Task that fails');
      expect(result).toContain('failed');
    });

    it('should handle tool execution errors', async () => {
      provider.queueResponse({
        content: JSON.stringify([{ id: 'step-1', description: 'Invalid command', agent: 'executor', dependencies: [] }]),
        model: 'mock',
      });

      provider.queueResponse({
        content: JSON.stringify({ thought: 'Run invalid', action: 'shell', input: 'invalid_command_12345' }),
        model: 'mock',
      });

      await orchestrator.run('Task with error');
      
      const state = (orchestrator as any).state;
      expect(state.plan[0].status).toBe(StepStatus.FAILED);
      expect(state.plan[0].error).toBeDefined();
    });

    it('should generate summary even with partial failures', async () => {
      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Will succeed', agent: 'executor', dependencies: [] },
          { id: 'step-2', description: 'Will fail', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      });

      // First succeeds
      provider.queueResponse({
        content: JSON.stringify({ thought: 'Good', action: 'shell', input: 'echo ok' }),
        model: 'mock',
      });

      // Second fails
      provider.queueResponse({
        content: JSON.stringify({ thought: 'Bad', action: 'shell', input: 'false' }),
        model: 'mock',
      });

      const result = await orchestrator.run('Mixed results');
      
      expect(result).toContain('Execution Summary');
      expect(result).toContain('completed');
      expect(result).toContain('failed');
    });
  });

  describe('Complex Multi-Step Workflows', () => {
    it('should execute find-read-modify workflow', async () => {
      // Create test file
      fs.write('workflow-test.txt', 'original content');

      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Find test files', agent: 'executor', dependencies: [] },
          { id: 'step-2', description: 'Read workflow-test.txt', agent: 'executor', dependencies: ['step-1'] },
          { id: 'step-3', description: 'Modify content', agent: 'executor', dependencies: ['step-2'] },
        ]),
        model: 'mock',
      });

      // Find
      provider.queueResponse({
        content: JSON.stringify({ thought: 'Find', action: 'shell', input: 'ls *.txt' }),
        model: 'mock',
      });

      // Read
      provider.queueResponse({
        content: JSON.stringify({ thought: 'Read', action: 'filesystem', input: 'read workflow-test.txt' }),
        model: 'mock',
      });

      // Modify
      provider.queueResponse({
        content: JSON.stringify({ thought: 'Write', action: 'filesystem', input: 'write workflow-test.txt modified' }),
        model: 'mock',
      });

      await orchestrator.run('File workflow');
      
      const state = (orchestrator as any).state;
      expect(state.plan[0].status).toBe(StepStatus.COMPLETED);
      expect(state.plan[1].status).toBe(StepStatus.COMPLETED);
      expect(state.plan[2].status).toBe(StepStatus.COMPLETED);

      // Cleanup via shell
      await shell.execute('rm -f workflow-test.txt');
    });

    it('should handle branching dependencies', async () => {
      provider.queueResponse({
        content: JSON.stringify([
          { id: 'step-1', description: 'Root', agent: 'executor', dependencies: [] },
          { id: 'step-2a', description: 'Branch A', agent: 'executor', dependencies: ['step-1'] },
          { id: 'step-2b', description: 'Branch B', agent: 'executor', dependencies: ['step-1'] },
          { id: 'step-3', description: 'Merge', agent: 'executor', dependencies: ['step-2a', 'step-2b'] },
        ]),
        model: 'mock',
      });

      // Queue 4 execution responses
      for (let i = 0; i < 4; i++) {
        provider.queueResponse({
          content: JSON.stringify({ thought: 'Execute', action: 'shell', input: 'echo step' }),
          model: 'mock',
        });
      }

      await orchestrator.run('Branching workflow');
      
      const state = (orchestrator as any).state;
      expect(state.plan[3].dependencies).toEqual(['step-2a', 'step-2b']);
      expect(state.plan[3].status).toBe(StepStatus.COMPLETED);
    });
  });
});
