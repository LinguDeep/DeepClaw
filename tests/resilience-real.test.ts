/**
 * Resilience Integration Tests - Circuit breaker, retry, timeout patterns
 * Validates error recovery under real network failure conditions
 */

import { withRetry, CircuitBreaker, withTimeout, getAdaptiveRetryConfig } from '../src/resilience';

describe('Resilience Patterns - Real Error Scenarios', () => {
  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      const result = await withRetry(fn, { maxRetries: 3 }, 'test-op');
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error (rate limit)', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce({ message: 'rate limit exceeded', response: { status: 429 } })
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }, 'test-op');
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should retry on network errors', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'Connection reset' })
        .mockRejectedValueOnce({ code: 'ECONNREFUSED', message: 'Connection refused' })
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(fn, { maxRetries: 5, baseDelayMs: 10 }, 'test-op');
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should retry on timeout errors', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce({ message: 'timeout' })
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }, 'test-op');
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 4xx client errors (except 429)', async () => {
      const error = { message: 'Bad request', response: { status: 400 } };
      const fn = jest.fn().mockRejectedValue(error);
      
      await expect(withRetry(fn, { maxRetries: 3 }, 'test-op')).rejects.toEqual(error);
      expect(fn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should not retry on auth errors (401)', async () => {
      const error = { message: 'Unauthorized', response: { status: 401 } };
      const fn = jest.fn().mockRejectedValue(error);
      
      await expect(withRetry(fn, { maxRetries: 3 }, 'test-op')).rejects.toEqual(error);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on 5xx server errors', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce({ message: 'Server error', response: { status: 500 } })
        .mockRejectedValueOnce({ message: 'Bad gateway', response: { status: 502 } })
        .mockRejectedValueOnce({ message: 'Unavailable', response: { status: 503 } })
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(fn, { maxRetries: 5, baseDelayMs: 10 }, 'test-op');
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(4);
    });

    it('should fail after maxRetries', async () => {
      const error = { message: 'Persistent failure' };
      const fn = jest.fn().mockRejectedValue(error);
      
      await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }, 'test-op')).rejects.toEqual(error);
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should use exponential backoff', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: any, ms: number) => {
        delays.push(ms);
        return originalSetTimeout(fn, 0);
      }) as any;

      const fn = jest.fn()
        .mockRejectedValueOnce({ message: 'error1' })
        .mockRejectedValueOnce({ message: 'error2' })
        .mockResolvedValueOnce('success');

      await withRetry(fn, { maxRetries: 2, baseDelayMs: 100, backoffMultiplier: 2, jitter: false }, 'test-op');

      global.setTimeout = originalSetTimeout;

      expect(delays[0]).toBe(100); // First retry: 100ms
      expect(delays[1]).toBe(200); // Second retry: 200ms
    });

    it('should respect maxDelayMs cap', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: any, ms: number) => {
        delays.push(ms);
        return originalSetTimeout(fn, 0);
      }) as any;

      const fn = jest.fn()
        .mockRejectedValueOnce({ message: 'e1' })
        .mockRejectedValueOnce({ message: 'e2' })
        .mockRejectedValueOnce({ message: 'e3' })
        .mockRejectedValueOnce({ message: 'e4' })
        .mockResolvedValueOnce('success');

      await withRetry(fn, { 
        maxRetries: 4, 
        baseDelayMs: 1000, 
        maxDelayMs: 3000, 
        backoffMultiplier: 2, 
        jitter: false 
      }, 'test-op');

      global.setTimeout = originalSetTimeout;

      expect(delays[0]).toBe(1000); // 1000 * 2^0 = 1000
      expect(delays[1]).toBe(2000); // 1000 * 2^1 = 2000
      expect(delays[2]).toBe(3000); // 1000 * 2^2 = 4000, capped at 3000
      expect(delays[3]).toBe(3000); // Still capped
    });

    it('should apply jitter to avoid thundering herd', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: any, ms: number) => {
        delays.push(ms);
        return originalSetTimeout(fn, 0);
      }) as any;

      const fn = jest.fn()
        .mockRejectedValueOnce({ message: 'e1' })
        .mockResolvedValueOnce('success');

      await withRetry(fn, { maxRetries: 1, baseDelayMs: 1000, jitter: true }, 'test-op');

      global.setTimeout = originalSetTimeout;

      // With jitter, delay should be 1000 ± 250 (25%)
      expect(delays[0]).toBeGreaterThanOrEqual(750);
      expect(delays[0]).toBeLessThanOrEqual(1250);
    });
  });

  describe('CircuitBreaker', () => {
    it('should allow requests when closed', async () => {
      const cb = new CircuitBreaker(5, 30000, 'test');
      const fn = jest.fn().mockResolvedValue('success');

      const result = await cb.execute(fn);

      expect(result).toBe('success');
      expect(cb.getState()).toBe('closed');
    });

    it('should open after failure threshold', async () => {
      const cb = new CircuitBreaker(3, 30000, 'test');
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      // Fail 3 times
      await expect(cb.execute(fn)).rejects.toThrow('fail');
      await expect(cb.execute(fn)).rejects.toThrow('fail');
      await expect(cb.execute(fn)).rejects.toThrow('fail');

      // Circuit should be open now
      expect(cb.getState()).toBe('open');
      
      // Next request should fail immediately
      await expect(cb.execute(fn)).rejects.toThrow('Circuit breaker test is open');
    });

    it('should enter half-open after timeout', async () => {
      const cb = new CircuitBreaker(2, 100, 'test'); // 100ms timeout
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      await expect(cb.execute(fn)).rejects.toThrow();
      await expect(cb.execute(fn)).rejects.toThrow();
      expect(cb.getState()).toBe('open');

      // Wait for timeout
      await new Promise(r => setTimeout(r, 150));

      // Next request should try (half-open)
      const successFn = jest.fn().mockResolvedValue('success');
      await cb.execute(successFn);

      expect(cb.getState()).toBe('closed');
    });

    it('should close after successful half-open request', async () => {
      const cb = new CircuitBreaker(2, 100, 'test');
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      const successFn = jest.fn().mockResolvedValue('success');

      // Open circuit
      await expect(cb.execute(failFn)).rejects.toThrow();
      await expect(cb.execute(failFn)).rejects.toThrow();
      expect(cb.getState()).toBe('open');

      // Wait for timeout
      await new Promise(r => setTimeout(r, 150));

      // Success in half-open should close circuit
      await cb.execute(successFn);
      expect(cb.getState()).toBe('closed');
    });

    it('should reopen after failure in half-open', async () => {
      const cb = new CircuitBreaker(2, 100, 'test');
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));

      // Open circuit
      await expect(cb.execute(failFn)).rejects.toThrow();
      await expect(cb.execute(failFn)).rejects.toThrow();
      expect(cb.getState()).toBe('open');

      // Wait for timeout
      await new Promise(r => setTimeout(r, 150));

      // Another failure should reopen
      await expect(cb.execute(failFn)).rejects.toThrow();
      expect(cb.getState()).toBe('open');
    });

    it('should decrement failure count on success', async () => {
      const cb = new CircuitBreaker(3, 30000, 'test');
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      const successFn = jest.fn().mockResolvedValue('success');

      // One failure
      await expect(cb.execute(failFn)).rejects.toThrow();

      // Then success should reduce failure count
      await cb.execute(successFn);
      await cb.execute(successFn);

      // Now we need 3 more failures to open
      await expect(cb.execute(failFn)).rejects.toThrow();
      await expect(cb.execute(failFn)).rejects.toThrow();
      await expect(cb.execute(failFn)).rejects.toThrow();

      expect(cb.getState()).toBe('open');
    });
  });

  describe('withTimeout', () => {
    it('should resolve if promise completes in time', async () => {
      const promise = Promise.resolve('success');
      const result = await withTimeout(promise, 1000, 'test');
      expect(result).toBe('success');
    });

    it('should reject if promise exceeds timeout', async () => {
      const promise = new Promise(resolve => setTimeout(() => resolve('late'), 200));
      
      await expect(withTimeout(promise, 100, 'test')).rejects.toThrow('test timed out after 100ms');
    });

    it('should handle already rejected promises', async () => {
      const error = new Error('original error');
      const promise = Promise.reject(error);
      
      await expect(withTimeout(promise, 1000, 'test')).rejects.toThrow('original error');
    });

    it('should work with complex operations', async () => {
      const slowOperation = async () => {
        await new Promise(r => setTimeout(r, 50));
        return 'completed';
      };

      const result = await withTimeout(slowOperation(), 200, 'slow-op');
      expect(result).toBe('completed');
    });
  });

  describe('getAdaptiveRetryConfig', () => {
    it('should return aggressive config for rate limit errors', () => {
      const config = getAdaptiveRetryConfig({ response: { status: 429 } });
      expect(config.maxRetries).toBe(5);
      expect(config.baseDelayMs).toBe(2000);
    });

    it('should return moderate config for server errors', () => {
      const config = getAdaptiveRetryConfig({ response: { status: 500 } });
      expect(config.maxRetries).toBe(3);
      expect(config.baseDelayMs).toBe(1000);
    });

    it('should return aggressive config for network errors', () => {
      const config = getAdaptiveRetryConfig({ code: 'ECONNRESET' });
      expect(config.maxRetries).toBe(5);
      expect(config.baseDelayMs).toBe(500);
    });

    it('should return empty config for unknown errors', () => {
      const config = getAdaptiveRetryConfig({ message: 'unknown' });
      expect(Object.keys(config).length).toBe(0);
    });
  });

  describe('Integration: Retry + Circuit Breaker', () => {
    it('should use circuit breaker with retry', async () => {
      const cb = new CircuitBreaker(5, 30000, 'integrated');
      const fn = jest.fn()
        .mockRejectedValueOnce({ message: 'error', response: { status: 503 } })
        .mockRejectedValueOnce({ message: 'error', response: { status: 503 } })
        .mockResolvedValueOnce('success');

      const result = await cb.execute(() => 
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }, 'inner-op')
      );

      expect(result).toBe('success');
      expect(cb.getState()).toBe('closed');
    });

    it('should open circuit after all retries exhausted', async () => {
      const cb = new CircuitBreaker(2, 30000, 'integrated');
      const fn = jest.fn().mockRejectedValue({ response: { status: 503 } });

      // First attempt: 3 retries, all fail (circuit sees 1 failure)
      await expect(
        cb.execute(() => withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }, 'inner-op'))
      ).rejects.toThrow();

      // Second attempt: circuit sees 2nd failure then opens
      await expect(
        cb.execute(() => withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }, 'inner-op'))
      ).rejects.toThrow();

      // Third attempt: circuit is now open
      await expect(
        cb.execute(() => withRetry(fn, { maxRetries: 2 }, 'inner-op'))
      ).rejects.toThrow('Circuit breaker integrated is open');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle cascading failures', async () => {
      const services = [
        { name: 'service-a', failures: 0 },
        { name: 'service-b', failures: 0 },
        { name: 'service-c', failures: 0 },
      ];

      const cbs = services.map(s => new CircuitBreaker(3, 1000, s.name));

      // Simulate cascading failure
      for (let i = 0; i < 3; i++) {
        for (const [idx, service] of services.entries()) {
          const failFn = jest.fn().mockRejectedValue(new Error(`${service.name} down`));
          try {
            await cbs[idx].execute(failFn);
          } catch {
            service.failures++;
          }
        }
      }

      // All circuits should be open
      for (const cb of cbs) {
        expect(cb.getState()).toBe('open');
      }
    });

    it('should recover from temporary outage', async () => {
      const cb = new CircuitBreaker(2, 50, 'recover-test');
      let attempts = 0;

      const flakyService = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('temporarily down'));
        }
        return Promise.resolve('recovered');
      });

      // Initial failures
      await expect(cb.execute(flakyService)).rejects.toThrow();
      await expect(cb.execute(flakyService)).rejects.toThrow();
      expect(cb.getState()).toBe('open');

      // Wait for reset timeout
      await new Promise(r => setTimeout(r, 100));

      // Should succeed now
      const result = await cb.execute(flakyService);
      expect(result).toBe('recovered');
      expect(cb.getState()).toBe('closed');
    });

    it('should handle mixed success/failure patterns', async () => {
      const cb = new CircuitBreaker(5, 30000, 'mixed');
      const pattern = [false, false, true, false, true, true, true]; // Failure/success pattern
      let index = 0;

      const mixedFn = jest.fn().mockImplementation(() => {
        const shouldSucceed = pattern[index++];
        return shouldSucceed 
          ? Promise.resolve('success')
          : Promise.reject(new Error('fail'));
      });

      for (let i = 0; i < pattern.length; i++) {
        try {
          await cb.execute(mixedFn);
        } catch {
          // Expected
        }
      }

      // Circuit should still be closed due to successes between failures
      expect(cb.getState()).toBe('closed');
    });
  });
});
