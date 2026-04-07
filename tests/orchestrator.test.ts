import { Orchestrator } from '../src/orchestrator';
import { AgentRole, StepStatus, Message, LLMResponse } from '../src/types';
import { ShellTool, FileSystemTool } from '../src/tools';
import { BaseProvider } from '../src/multi-provider';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Mock provider that returns predictable responses
class MockProvider extends BaseProvider {
  private responses: Map<string, string> = new Map();
  callLog: { messages: Message[]; temperature: number }[] = [];

  constructor() {
    super('mock', 'mock-model');
  }

  setResponse(keyword: string, response: string): void {
    this.responses.set(keyword, response);
  }

  async complete(messages: Message[], temperature?: number, maxTokens?: number): Promise<LLMResponse> {
    this.callLog.push({ messages, temperature: temperature || 0.7 });
    
    const userMsg = messages.find(m => m.role === 'user')?.content || '';
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';

    // Match response based on keywords
    for (const [keyword, response] of this.responses) {
      if (userMsg.includes(keyword) || systemMsg.includes(keyword)) {
        return { content: response, model: 'mock-model' };
      }
    }

    // Default responses based on agent role
    if (systemMsg.includes('Planner')) {
      return {
        content: JSON.stringify([
          { id: 'step-1', description: 'Run: echo hello', agent: 'executor', dependencies: [] },
          { id: 'step-2', description: 'Review the output', agent: 'reviewer', dependencies: ['step-1'] },
        ]),
        model: 'mock-model',
      };
    }

    if (systemMsg.includes('Executor')) {
      return {
        content: JSON.stringify({ thought: 'Execute command', action: 'shell', input: 'echo test-output' }),
        model: 'mock-model',
      };
    }

    if (systemMsg.includes('Reviewer')) {
      return {
        content: JSON.stringify({ review: 'Looks good', approved: true, feedback: '' }),
        model: 'mock-model',
      };
    }

    return { content: 'Default response', model: 'mock-model' };
  }
}

describe('Orchestrator', () => {
  let provider: MockProvider;
  let shell: ShellTool;
  let fsTool: FileSystemTool;
  let orchestrator: Orchestrator;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `linguclaw-orch-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    
    provider = new MockProvider();
    shell = new ShellTool(testDir, false, undefined, true);
    fsTool = new FileSystemTool(testDir);
    orchestrator = new Orchestrator(provider, shell, fsTool, 10);
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  describe('simple tasks', () => {
    it('should handle greetings directly', async () => {
      provider.setResponse('LinguClaw', 'Hello! How can I help you?');
      const result = await orchestrator.run('hello');
      expect(result).toContain('Hello');
      expect(orchestrator.state.plan.length).toBe(0); // No plan for simple tasks
    });

    it('should handle "merhaba" as simple task', async () => {
      provider.setResponse('LinguClaw', 'Merhaba! Size nasıl yardımcı olabilirim?');
      const result = await orchestrator.run('merhaba');
      expect(result).toBeTruthy();
    });
  });

  describe('plan parsing', () => {
    it('should parse JSON array plans', async () => {
      const result = await orchestrator.run('list all files');
      // Should have created a plan and executed it
      expect(orchestrator.state.plan.length).toBeGreaterThan(0);
    });

    it('should handle malformed plan gracefully', async () => {
      provider.complete = async (messages: Message[]) => {
        const sysMsg = messages.find(m => m.role === 'system')?.content || '';
        if (sysMsg.includes('Planner')) {
          return { content: 'Just do the thing, no JSON here at all', model: 'mock' };
        }
        if (sysMsg.includes('Executor')) {
          return { content: JSON.stringify({ thought: 'ok', action: 'shell', input: 'echo done' }), model: 'mock' };
        }
        return { content: 'ok', model: 'mock' };
      };
      await orchestrator.run('do something really complex now');
      // Should fallback to single step
      expect(orchestrator.state.plan.length).toBe(1);
    });

    it('should parse individual JSON objects as fallback', async () => {
      provider.setResponse('Create a plan', 'Here are the steps:\n{"id": "s1", "description": "step one", "agent": "executor", "dependencies": []}\n{"id": "s2", "description": "step two", "agent": "executor", "dependencies": ["s1"]}');
      const result = await orchestrator.run('multi step task');
      expect(orchestrator.state.plan.length).toBe(2);
    });
  });

  describe('step execution', () => {
    it('should execute shell commands', async () => {
      // Override complete to control exact responses per agent role
      provider.complete = async (messages: Message[]) => {
        const sysMsg = messages.find(m => m.role === 'system')?.content || '';
        if (sysMsg.includes('Planner')) {
          return {
            content: JSON.stringify([{ id: 'step-1', description: 'echo hello', agent: 'executor', dependencies: [] }]),
            model: 'mock',
          };
        }
        if (sysMsg.includes('Executor')) {
          return {
            content: JSON.stringify({ thought: 'Run echo', action: 'shell', input: 'echo hello-world' }),
            model: 'mock',
          };
        }
        return { content: 'ok', model: 'mock' };
      };

      await orchestrator.run('run echo command');
      expect(orchestrator.state.plan[0].status).toBe(StepStatus.COMPLETED);
      expect(orchestrator.state.plan[0].result).toContain('hello-world');
    });

    it('should handle failed shell commands', async () => {
      provider.setResponse('Create a plan', JSON.stringify([
        { id: 'step-1', description: 'Run failing command', agent: 'executor', dependencies: [] },
      ]));
      provider.setResponse('Run failing command', JSON.stringify({
        thought: 'This will fail', action: 'shell', input: 'exit 1',
      }));

      const result = await orchestrator.run('run failing command');
      // After retries, should be failed or retrying
      const step = orchestrator.state.plan[0];
      expect([StepStatus.FAILED, StepStatus.RETRYING]).toContain(step.status);
    });

    it('should respect step dependencies', async () => {
      provider.setResponse('Create a plan', JSON.stringify([
        { id: 'step-1', description: 'First step', agent: 'executor', dependencies: [] },
        { id: 'step-2', description: 'Depends on first', agent: 'executor', dependencies: ['step-1'] },
      ]));

      await orchestrator.run('ordered task');
      // Both steps should have been attempted
      expect(provider.callLog.length).toBeGreaterThanOrEqual(3); // plan + at least 2 executions
    });

    it('should skip steps with unmet dependencies', async () => {
      // Use very low max iterations so retries exhaust quickly
      const limitedShell = new ShellTool(testDir, false, undefined, true);
      const limitedOrch = new Orchestrator(provider, limitedShell, fsTool, 4);
      provider.complete = async (messages: Message[]) => {
        const sysMsg = messages.find(m => m.role === 'system')?.content || '';
        if (sysMsg.includes('Planner')) {
          return {
            content: JSON.stringify([
              { id: 'step-1', description: 'Fail deliberately', agent: 'executor', dependencies: [] },
              { id: 'step-2', description: 'Depends on step-1', agent: 'executor', dependencies: ['step-1'] },
            ]),
            model: 'mock',
          };
        }
        if (sysMsg.includes('Executor')) {
          return {
            content: JSON.stringify({ thought: 'fail', action: 'shell', input: 'exit 1' }),
            model: 'mock',
          };
        }
        return { content: 'ok', model: 'mock' };
      };

      await limitedOrch.run('dependency test task now');
      const plan = limitedOrch.state.plan;
      expect(plan.length).toBe(2);
      // step-2 should still be pending since step-1 never completed
      expect(plan[1].status).toBe(StepStatus.PENDING);
    });
  });

  describe('review step', () => {
    it('should include execution results in review context', async () => {
      provider.setResponse('Create a plan', JSON.stringify([
        { id: 'step-1', description: 'Do work', agent: 'executor', dependencies: [] },
        { id: 'step-2', description: 'Review work', agent: 'reviewer', dependencies: ['step-1'] },
      ]));

      await orchestrator.run('task with review');
      // Reviewer should have been called with execution context
      const reviewCall = provider.callLog.find(c =>
        c.messages.some(m => m.role === 'system' && m.content.includes('Reviewer'))
      );
      if (reviewCall) {
        const userMsg = reviewCall.messages.find(m => m.role === 'user');
        expect(userMsg?.content).toContain('Execution Results');
      }
    });
  });

  describe('iteration limits', () => {
    it('should respect max iterations', async () => {
      const limitedOrchestrator = new Orchestrator(provider, shell, fsTool, 2);
      
      provider.setResponse('Create a plan', JSON.stringify([
        { id: 'step-1', description: 'Step 1', agent: 'executor', dependencies: [] },
        { id: 'step-2', description: 'Step 2', agent: 'executor', dependencies: [] },
        { id: 'step-3', description: 'Step 3', agent: 'executor', dependencies: [] },
        { id: 'step-4', description: 'Step 4', agent: 'executor', dependencies: [] },
      ]));

      await limitedOrchestrator.run('many steps task');
      // Should stop after max_iterations
      const completed = limitedOrchestrator.state.plan.filter(s => s.status === StepStatus.COMPLETED).length;
      expect(completed).toBeLessThanOrEqual(2);
    });
  });

  describe('summary generation', () => {
    it('should generate proper summary', async () => {
      const result = await orchestrator.run('test task for summary');
      expect(result).toContain('Execution Summary');
      expect(result).toContain('test task for summary');
    });
  });

  describe('error handling', () => {
    it('should handle provider errors gracefully', async () => {
      const errorProvider = new MockProvider();
      // Override complete to return error
      errorProvider.complete = async () => ({
        content: '',
        model: 'mock',
        error: 'API key invalid',
      });

      const orch = new Orchestrator(errorProvider, shell, fsTool);
      const result = await orch.run('complex task');
      expect(result).toContain('failed');
    });

    it('should handle empty LLM response', async () => {
      const emptyProvider = new MockProvider();
      emptyProvider.complete = async () => ({
        content: '',
        model: 'mock',
      });

      const orch = new Orchestrator(emptyProvider, shell, fsTool);
      const result = await orch.run('complex task');
      expect(result).toContain('empty response');
    });
  });
});
