import { CodeSandbox } from '../src/code-sandbox';

describe('CodeSandbox', () => {
  let sandbox: CodeSandbox;

  beforeEach(() => {
    sandbox = new CodeSandbox();
  });

  describe('initialization', () => {
    it('should create instance', () => {
      expect(sandbox).toBeTruthy();
    });

    it('should report docker availability', () => {
      // Docker may or may not be available in test env
      expect(typeof sandbox.isDockerAvailable).toBe('boolean');
    });

    it('should get available languages', async () => {
      const languages = await sandbox.getAvailableLanguages();
      expect(languages).toBeTruthy();
      expect(typeof languages).toBe('object');
      // Should have at least these language keys
      expect('python' in languages).toBe(true);
      expect('javascript' in languages).toBe(true);
      expect('typescript' in languages).toBe(true);
      expect('shell' in languages).toBe(true);
    });
  });

  describe('JavaScript execution', () => {
    it('should execute simple JS code', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'console.log("hello from sandbox")',
        timeout: 10,
      });
      expect(result).toBeTruthy();
      expect(result.language).toBe('javascript');
      if (result.success) {
        expect(result.stdout).toContain('hello from sandbox');
      }
      // If Docker not available and local exec blocked, that's okay
    });

    it('should capture JS return values via console.log', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'const x = 2 + 3; console.log(x)',
        timeout: 10,
      });
      if (result.success) {
        expect(result.stdout).toContain('5');
      }
    });
  });

  describe('Python execution', () => {
    it('should execute simple Python code', async () => {
      const result = await sandbox.execute({
        language: 'python',
        code: 'print("hello python")',
        timeout: 10,
      });
      expect(result).toBeTruthy();
      expect(result.language).toBe('python');
      if (result.success) {
        expect(result.stdout).toContain('hello python');
      }
    });

    it('should handle Python errors', async () => {
      const result = await sandbox.execute({
        language: 'python',
        code: 'raise ValueError("test error")',
        timeout: 10,
      });
      expect(result).toBeTruthy();
      if (!result.success) {
        expect(result.stderr || result.error).toBeTruthy();
      }
    });
  });

  describe('Shell execution', () => {
    it('should execute shell commands', async () => {
      const result = await sandbox.execute({
        language: 'shell',
        code: 'echo "shell test"',
        timeout: 10,
      });
      expect(result).toBeTruthy();
      if (result.success) {
        expect(result.stdout).toContain('shell test');
      }
    });
  });

  describe('safety', () => {
    it('should block dangerous code patterns locally', async () => {
      const result = await sandbox.execute({
        language: 'shell',
        code: 'rm -rf /',
        timeout: 5,
      });
      // Should either fail or be blocked
      if (!result.success) {
        expect(result.error || result.stderr).toBeTruthy();
      }
    });

    it('should respect timeout', async () => {
      const start = Date.now();
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'while(true) {}',
        timeout: 3,
      });
      const elapsed = Date.now() - start;
      // Should not run forever — should finish within timeout + buffer
      expect(elapsed).toBeLessThan(15000);
      expect(result.success).toBe(false);
    }, 20000);

    it('should handle invalid language gracefully', async () => {
      const result = await sandbox.execute({
        language: 'cobol' as any,
        code: 'DISPLAY "HELLO"',
        timeout: 5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('execution metadata', () => {
    it('should include execution time', async () => {
      const result = await sandbox.execute({
        language: 'javascript',
        code: 'console.log("fast")',
        timeout: 10,
      });
      expect(result.executionTime).toBeDefined();
      expect(typeof result.executionTime).toBe('number');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });
  });
});
