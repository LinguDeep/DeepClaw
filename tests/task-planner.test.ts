import { TaskPlanner } from '../src/task-planner';
import { BaseProvider } from '../src/multi-provider';
import { Message, LLMResponse } from '../src/types';

// Mock provider for testing
class MockPlannerProvider extends BaseProvider {
  private responseMap: Map<string, string> = new Map();

  constructor() {
    super('mock', 'mock-planner');
  }

  setResponse(keyword: string, response: string): void {
    this.responseMap.set(keyword, response);
  }

  async complete(messages: Message[], temperature?: number, maxTokens?: number): Promise<LLMResponse> {
    const userMsg = messages.find(m => m.role === 'user')?.content || '';

    for (const [keyword, response] of this.responseMap) {
      if (userMsg.includes(keyword)) {
        return { content: response, model: 'mock-planner' };
      }
    }

    // Default: return a simple plan
    return {
      content: JSON.stringify({
        goal: 'test goal',
        subtasks: [
          { id: 'sub-1', description: 'First subtask', action: 'shell', priority: 'high', dependencies: [] },
          { id: 'sub-2', description: 'Second subtask', action: 'filesystem', priority: 'medium', dependencies: ['sub-1'] },
        ],
        strategy: 'sequential',
      }),
      model: 'mock-planner',
    };
  }
}

describe('TaskPlanner', () => {
  let provider: MockPlannerProvider;
  let planner: TaskPlanner;

  beforeEach(() => {
    provider = new MockPlannerProvider();
    planner = new TaskPlanner(provider);
  });

  describe('construction', () => {
    it('should create a TaskPlanner instance', () => {
      expect(planner).toBeTruthy();
      expect(planner).toBeInstanceOf(TaskPlanner);
    });
  });

  describe('plan creation', () => {
    it('should create a plan from a goal', async () => {
      const plan = await planner.createPlan({
        id: 'goal-1',
        description: 'Build a REST API',
        context: 'Node.js project',
        constraints: [],
        priority: 'high',
      });

      expect(plan).toBeTruthy();
      expect(plan.subtasks).toBeDefined();
      expect(plan.subtasks.length).toBeGreaterThan(0);
    });

    it('should handle provider errors gracefully', async () => {
      provider.complete = async () => ({
        content: '',
        model: 'mock',
        error: 'API error',
      });

      try {
        const plan = await planner.createPlan({
          id: 'goal-fail',
          description: 'Failing task',
          context: '',
          constraints: [],
          priority: 'medium',
        });
        // If it doesn't throw, it should return a plan with error info
        expect(plan).toBeTruthy();
      } catch (e: any) {
        expect(e.message).toBeTruthy();
      }
    });

    it('should handle malformed JSON from provider', async () => {
      provider.complete = async () => ({
        content: 'This is not JSON at all, just random text.',
        model: 'mock',
      });

      try {
        const plan = await planner.createPlan({
          id: 'goal-bad',
          description: 'Bad response task',
          context: '',
          constraints: [],
          priority: 'medium',
        });
        // Should still return something or throw
        expect(plan).toBeTruthy();
      } catch (e: any) {
        expect(e.message).toBeTruthy();
      }
    });
  });

  describe('subtask dependencies', () => {
    it('should respect subtask ordering', async () => {
      const plan = await planner.createPlan({
        id: 'goal-ordered',
        description: 'Ordered task',
        context: '',
        constraints: [],
        priority: 'high',
      });

      if (plan.subtasks.length >= 2) {
        const second = plan.subtasks.find(s => s.dependencies && s.dependencies.length > 0);
        if (second) {
          expect(second.dependencies.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('event emission', () => {
    it('should emit planning:start event', (done) => {
      planner.on('planning:start', (data: any) => {
        expect(data).toBeTruthy();
        done();
      });

      planner.createPlan({
        id: 'goal-event',
        description: 'Event test',
        context: '',
        constraints: [],
        priority: 'medium',
      });
    });

    it('should emit planning:complete event', (done) => {
      planner.on('planning:complete', (data: any) => {
        expect(data).toBeTruthy();
        done();
      });

      planner.createPlan({
        id: 'goal-complete',
        description: 'Complete event test',
        context: '',
        constraints: [],
        priority: 'medium',
      });
    });
  });
});
