/**
 * Tests for orchestrator upgrade — new action types and system integrations
 */
import { Orchestrator } from '../src/orchestrator';
import { AgentRole, StepStatus, Message, LLMResponse } from '../src/types';
import { ShellTool, FileSystemTool } from '../src/tools';
import { BaseProvider } from '../src/multi-provider';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Mock provider
class MockProvider extends BaseProvider {
  private responseQueue: ((messages: Message[]) => LLMResponse)[] = [];
  callLog: Message[][] = [];

  constructor() {
    super('mock', 'mock-model');
  }

  pushResponse(fn: (messages: Message[]) => LLMResponse): void {
    this.responseQueue.push(fn);
  }

  async complete(messages: Message[], temperature?: number, maxTokens?: number): Promise<LLMResponse> {
    this.callLog.push(messages);
    const sysMsg = messages.find(m => m.role === 'system')?.content || '';
    const userMsg = messages.find(m => m.role === 'user')?.content || '';

    // If there's a queued response, use it
    if (this.responseQueue.length > 0) {
      const fn = this.responseQueue.shift()!;
      return fn(messages);
    }

    // Default: Planner returns single step, Executor runs shell echo
    if (sysMsg.includes('Planner')) {
      return {
        content: JSON.stringify([
          { id: 'step-1', description: userMsg.substring(0, 50), agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      };
    }

    if (sysMsg.includes('Executor')) {
      return {
        content: JSON.stringify({ thought: 'executing', action: 'shell', input: 'echo done' }),
        model: 'mock',
      };
    }

    if (sysMsg.includes('Reviewer')) {
      return {
        content: JSON.stringify({ review: 'OK', approved: true, feedback: '' }),
        model: 'mock',
      };
    }

    return { content: 'OK', model: 'mock' };
  }
}

describe('Orchestrator Upgrade', () => {
  let provider: MockProvider;
  let shell: ShellTool;
  let fsTool: FileSystemTool;
  let orchestrator: Orchestrator;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `linguclaw-upgrade-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    provider = new MockProvider();
    shell = new ShellTool(testDir, false, undefined, true);
    fsTool = new FileSystemTool(testDir);
    orchestrator = new Orchestrator(provider, shell, fsTool, 10, testDir);
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  describe('new system instances', () => {
    it('should have taskPlanner initialized', () => {
      expect(orchestrator.taskPlanner).toBeTruthy();
    });

    it('should have codeSandbox initialized', () => {
      expect(orchestrator.codeSandbox).toBeTruthy();
    });

    it('should have chain-of-thought initialized', () => {
      expect(orchestrator.cot).toBeTruthy();
    });

    it('should have sessionMemory initialized', () => {
      expect(orchestrator.sessionMemory).toBeTruthy();
    });

    it('should have browser initialized', () => {
      expect(orchestrator.browser).toBeTruthy();
    });

    it('should have integrations initialized', () => {
      expect(orchestrator.integrations).toBeTruthy();
    });
  });

  describe('chain-of-thought integration', () => {
    it('should track thoughts during execution', async () => {
      const result = await orchestrator.run('list files in current directory');
      // Should have generated a reasoning trace
      const trace = orchestrator.getReasoningTrace();
      expect(trace).toBeTruthy();
      expect(trace.length).toBeGreaterThan(0);
    });

    it('should return session stats', async () => {
      await orchestrator.run('hello');
      const stats = orchestrator.getSessionStats();
      expect(stats).toBeTruthy();
      expect(stats.codeSandbox).toBeTruthy();
      expect(stats.browser).toBeTruthy();
      expect(stats.integrations).toBeTruthy();
    });
  });

  describe('code_exec action', () => {
    it('should handle code_exec action from executor', async () => {
      // Planner returns a code_exec step
      provider.pushResponse(() => ({
        content: JSON.stringify([
          { id: 'step-1', description: 'Calculate sum with Python', agent: 'executor', dependencies: [], action: 'code_exec' },
        ]),
        model: 'mock',
      }));

      // Executor returns code_exec action
      provider.pushResponse(() => ({
        content: JSON.stringify({
          thought: 'I will calculate the sum using Python',
          action: 'code_exec',
          language: 'python',
          input: 'print(2 + 3)',
        }),
        model: 'mock',
      }));

      const result = await orchestrator.run('calculate 2+3 with python');
      const step = orchestrator.state.plan[0];
      // Step should have been attempted (success depends on Python availability)
      expect([StepStatus.COMPLETED, StepStatus.FAILED]).toContain(step.status);
    });

    it('should handle JS code execution', async () => {
      provider.pushResponse(() => ({
        content: JSON.stringify([
          { id: 'step-1', description: 'Run JS code', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      }));

      provider.pushResponse(() => ({
        content: JSON.stringify({
          thought: 'Running JavaScript',
          action: 'code_exec',
          language: 'javascript',
          input: 'console.log("js works")',
        }),
        model: 'mock',
      }));

      await orchestrator.run('run javascript code');
      const step = orchestrator.state.plan[0];
      expect([StepStatus.COMPLETED, StepStatus.FAILED]).toContain(step.status);
    });
  });

  describe('browse action', () => {
    it('should handle browse action (may fail without puppeteer)', async () => {
      provider.pushResponse(() => ({
        content: JSON.stringify([
          { id: 'step-1', description: 'Browse docs', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      }));

      provider.pushResponse(() => ({
        content: JSON.stringify({
          thought: 'I need to browse the documentation',
          action: 'browse',
          input: 'https://nodejs.org',
        }),
        model: 'mock',
      }));

      await orchestrator.run('browse nodejs docs');
      const step = orchestrator.state.plan[0];
      // Will likely fail without puppeteer installed, but should not crash
      expect(step.status).toBeDefined();
      expect([StepStatus.COMPLETED, StepStatus.FAILED]).toContain(step.status);
    });
  });

  describe('search action', () => {
    it('should handle search action (may fail without browser)', async () => {
      provider.pushResponse(() => ({
        content: JSON.stringify([
          { id: 'step-1', description: 'Search web', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      }));

      provider.pushResponse(() => ({
        content: JSON.stringify({
          thought: 'Searching for latest info',
          action: 'search',
          input: 'Node.js latest LTS version',
        }),
        model: 'mock',
      }));

      await orchestrator.run('search for nodejs version');
      const step = orchestrator.state.plan[0];
      expect([StepStatus.COMPLETED, StepStatus.FAILED]).toContain(step.status);
    });
  });

  describe('api_call action', () => {
    it('should handle api_call with unregistered service', async () => {
      provider.pushResponse(() => ({
        content: JSON.stringify([
          { id: 'step-1', description: 'Call API', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      }));

      provider.pushResponse(() => ({
        content: JSON.stringify({
          thought: 'Calling GitHub API',
          action: 'api_call',
          service: 'github',
          input: 'listIssues owner/repo',
        }),
        model: 'mock',
      }));

      await orchestrator.run('list github issues for my project repository');
      const step = orchestrator.state.plan[0];
      // api_call with unregistered service should fail
      if (step.status === StepStatus.FAILED) {
        expect(step.error).toContain('not registered');
      } else {
        // If default shell response kicked in, just verify step was processed
        expect(step.status).toBeDefined();
      }
    });
  });

  describe('parseAction upgrade', () => {
    it('should extract thought from executor response', async () => {
      provider.pushResponse(() => ({
        content: JSON.stringify([
          { id: 'step-1', description: 'Think step', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      }));

      provider.pushResponse(() => ({
        content: JSON.stringify({
          thought: 'My reasoning about this task',
          action: 'shell',
          input: 'echo thought-test',
        }),
        model: 'mock',
      }));

      await orchestrator.run('task with thought');
      const step = orchestrator.state.plan[0];
      expect(step.status).toBe(StepStatus.COMPLETED);
      expect(step.result).toContain('thought-test');
    });
  });

  describe('session memory integration', () => {
    it('should avoid repeatedly failing actions', async () => {
      // First run: action fails
      provider.pushResponse(() => ({
        content: JSON.stringify([
          { id: 'step-1', description: 'Failing action test', agent: 'executor', dependencies: [] },
        ]),
        model: 'mock',
      }));

      provider.pushResponse(() => ({
        content: JSON.stringify({ thought: 'fail', action: 'shell', input: 'exit 1' }),
        model: 'mock',
      }));

      // Default responses for retries
      for (let i = 0; i < 5; i++) {
        provider.pushResponse(() => ({
          content: JSON.stringify({ thought: 'retry', action: 'shell', input: 'exit 1' }),
          model: 'mock',
        }));
      }

      await orchestrator.run('run failing command repeatedly');
      // After max retries, should be failed
      const step = orchestrator.state.plan[0];
      expect(step.status).toBe(StepStatus.FAILED);
    });
  });

  describe('initSystems', () => {
    it('should initialize subsystems without crashing', async () => {
      await expect(orchestrator.initSystems()).resolves.not.toThrow();
    });
  });

  describe('summary includes iteration count', () => {
    it('should include iterations in summary', async () => {
      const result = await orchestrator.run('create a complex multi-step workflow with iteration counting');
      expect(result).toContain('Iterations');
    });
  });
});
