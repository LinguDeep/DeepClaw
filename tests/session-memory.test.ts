import { SessionMemory, getSessionMemory } from '../src/session-memory';

describe('SessionMemory', () => {
  let mem: SessionMemory;

  beforeEach(() => {
    mem = new SessionMemory();
  });

  describe('session lifecycle', () => {
    it('should start a session', () => {
      const id = mem.startSession('test task');
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('should start session with custom ID', () => {
      const id = mem.startSession('test', 'custom-id-123');
      expect(id).toBe('custom-id-123');
    });

    it('should end a session', () => {
      const id = mem.startSession('test task');
      mem.endSession(id);
      const stats = mem.getStats(id);
      expect(stats.actions).toBe(0);
    });
  });

  describe('action recording', () => {
    it('should record successful actions', () => {
      const id = mem.startSession('action test');
      mem.recordAction(id, 'shell', 'echo hello', true, 'hello', undefined, 100);

      const history = mem.getActionHistory(id);
      expect(history.length).toBe(1);
      expect(history[0].success).toBe(true);
      expect(history[0].output).toBe('hello');
    });

    it('should record failed actions', () => {
      const id = mem.startSession('fail test');
      mem.recordAction(id, 'shell', 'bad cmd', false, undefined, 'command not found', 50);

      const history = mem.getActionHistory(id);
      expect(history.length).toBe(1);
      expect(history[0].success).toBe(false);
      expect(history[0].error).toBe('command not found');
    });

    it('should track multiple actions', () => {
      const id = mem.startSession('multi action');
      mem.recordAction(id, 'shell', 'echo 1', true, '1');
      mem.recordAction(id, 'shell', 'echo 2', true, '2');
      mem.recordAction(id, 'filesystem', 'read file.ts', true, 'content');

      const history = mem.getActionHistory(id);
      expect(history.length).toBe(3);
    });
  });

  describe('shouldAvoid', () => {
    it('should not avoid first attempt', () => {
      const id = mem.startSession('avoid test');
      const result = mem.shouldAvoid(id, 'shell', 'echo hello');
      expect(result.avoid).toBe(false);
      expect(result.attempts).toBe(0);
    });

    it('should flag repeated failures', () => {
      const id = mem.startSession('repeated fail');
      // Record same action failing multiple times
      for (let i = 0; i < 4; i++) {
        mem.recordAction(id, 'shell', 'failing-cmd', false, undefined, 'error');
      }

      const result = mem.shouldAvoid(id, 'shell', 'failing-cmd');
      expect(result.avoid).toBe(true);
      expect(result.attempts).toBeGreaterThanOrEqual(3);
    });
  });

  describe('context for LLM', () => {
    it('should generate context string', () => {
      const id = mem.startSession('context test');
      mem.recordAction(id, 'shell', 'echo hello', true, 'hello');
      mem.recordAction(id, 'shell', 'ls', true, 'files');

      const context = mem.getContextForLLM(id);
      expect(typeof context).toBe('string');
      expect(context.length).toBeGreaterThan(0);
    });

    it('should return empty for nonexistent session', () => {
      const context = mem.getContextForLLM('fake-id');
      expect(context).toBe('');
    });
  });

  describe('stats', () => {
    it('should return correct stats', () => {
      const id = mem.startSession('stats test');
      mem.recordAction(id, 'shell', 'echo 1', true, '1');
      mem.recordAction(id, 'shell', 'bad', false, undefined, 'err');
      mem.recordAction(id, 'shell', 'echo 2', true, '2');

      const stats = mem.getStats(id);
      expect(stats.actions).toBe(3);
      expect(stats.failedActions).toBe(1);
    });
  });

  describe('singleton', () => {
    it('getSessionMemory should return consistent instance', () => {
      const a = getSessionMemory();
      const b = getSessionMemory();
      expect(a).toBe(b);
    });
  });
});
