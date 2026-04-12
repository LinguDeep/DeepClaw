import { ChainOfThought, getChainOfThought } from '../src/chain-of-thought';

describe('ChainOfThought', () => {
  let cot: ChainOfThought;

  beforeEach(() => {
    cot = new ChainOfThought({ enableStreaming: false, verboseLogging: false });
  });

  describe('session management', () => {
    it('should start a session and return session ID', () => {
      const id = cot.startSession('test task');
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('should track active session', () => {
      const id = cot.startSession('test task');
      expect(cot.getActiveSessionId()).toBe(id);
    });

    it('should end a session', () => {
      const id = cot.startSession('test task');
      cot.endSession(id, 'completed');
      // After ending, active session should be null
      expect(cot.getActiveSessionId()).toBeNull();
    });

    it('should generate session summary', () => {
      const id = cot.startSession('summarize this');
      cot.think(id, 'planning', 'Step 1');
      cot.think(id, 'reasoning', 'Step 2');
      const summary = cot.getSessionSummary(id);
      expect(summary).toBeTruthy();
      expect(summary!.task).toBe('summarize this');
      expect(summary!.totalThoughts).toBe(2);
    });
  });

  describe('thoughts', () => {
    it('should record thoughts', () => {
      const id = cot.startSession('think test');
      cot.think(id, 'planning', 'I will plan now');
      cot.think(id, 'reasoning', 'Analyzing the problem');
      
      const thoughts = cot.getThoughts(id);
      expect(thoughts.length).toBe(2);
      expect(thoughts[0].type).toBe('planning');
      expect(thoughts[0].content).toBe('I will plan now');
    });

    it('should filter thoughts by type', () => {
      const id = cot.startSession('filter test');
      cot.think(id, 'planning', 'Plan A');
      cot.think(id, 'reasoning', 'Reason A');
      cot.think(id, 'planning', 'Plan B');

      const planThoughts = cot.getThoughts(id, 'planning');
      expect(planThoughts.length).toBe(2);
    });

    it('should not record thoughts for invalid session', () => {
      cot.think('nonexistent-session', 'planning', 'Ghost thought');
      const thoughts = cot.getThoughts('nonexistent-session');
      expect(thoughts.length).toBe(0);
    });
  });

  describe('actions', () => {
    it('should start and complete actions', () => {
      const id = cot.startSession('action test');
      const action = cot.startAction(id, 'executor', 'shell', 'echo hello');
      expect(action).toBeTruthy();
      expect(action.id).toBeTruthy();
      expect(action.status).toBe('started');

      const startTime = Date.now();
      cot.completeAction(action.id, 'hello', startTime);

      const actions = cot.getActions(id);
      expect(actions.length).toBe(1);
      expect(actions[0].status).toBe('completed');
    });

    it('should handle failed actions', () => {
      const id = cot.startSession('fail test');
      const action = cot.startAction(id, 'shell', 'run', 'bad command');
      const startTime = Date.now();
      cot.failAction(action.id, 'command not found', startTime);

      const actions = cot.getActions(id);
      expect(actions[0].status).toBe('failed');
      expect(actions[0].error).toBe('command not found');
    });

    it('should filter actions by tool', () => {
      const id = cot.startSession('filter actions');
      cot.startAction(id, 'shell', 'run', 'echo 1');
      cot.startAction(id, 'filesystem', 'read', 'file.txt');
      cot.startAction(id, 'shell', 'run', 'echo 2');

      const shellActions = cot.getActions(id, 'shell');
      expect(shellActions.length).toBe(2);
    });
  });

  describe('reasoning chain', () => {
    it('should build a reasoning chain', () => {
      const id = cot.startSession('chain test');
      cot.think(id, 'planning', 'Plan step');
      cot.startAction(id, 'executor', 'shell', 'run command');
      cot.think(id, 'observation', 'Command succeeded');

      const chain = cot.getChain(id);
      expect(chain.length).toBeGreaterThanOrEqual(2);
      expect(chain[0].thought).toBeTruthy();
      expect(chain[0].thought.type).toBe('planning');
    });

    it('should generate readable trace', () => {
      const id = cot.startSession('trace test');
      cot.think(id, 'planning', 'I will analyze the code');
      cot.think(id, 'reasoning', 'Found a bug on line 42');

      const trace = cot.getReadableTrace(id);
      expect(trace).toContain('PLANNING');
      expect(trace).toContain('analyze the code');
    });

    it('should return empty trace for no session', () => {
      const trace = cot.getReadableTrace('nonexistent');
      expect(trace).toContain('No reasoning trace');
    });
  });

  describe('singleton', () => {
    it('getChainOfThought should return consistent instance', () => {
      const a = getChainOfThought();
      const b = getChainOfThought();
      expect(a).toBe(b);
    });
  });
});
