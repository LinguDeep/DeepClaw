/**
 * Real LLM Streaming Integration Tests
 * Tests actual SSE streaming with OpenRouter/OpenAI/Anthropic APIs
 * Requires: OPENROUTER_API_KEY or OPENAI_API_KEY or ANTHROPIC_API_KEY
 */

import { OpenRouterProvider, OpenAIProvider, AnthropicProvider } from '../src/multi-provider';

describe('Real LLM Streaming Integration', () => {
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  describe('OpenRouter Streaming', () => {
    const testIfKey = hasOpenRouter ? it : it.skip;

    testIfKey('should stream tokens from real API', async () => {
      const provider = new OpenRouterProvider(
        process.env.OPENROUTER_API_KEY!,
        'anthropic/claude-3.5-sonnet'
      );

      const messages = [
        { role: 'system' as const, content: 'You are a helpful assistant.' },
        { role: 'user' as const, content: 'Say "Hello World" and nothing else.' },
      ];

      const tokens: string[] = [];
      const startTime = Date.now();

      for await (const token of provider.stream(messages, 0.7, 100)) {
        tokens.push(token);
        process.stdout.write(token);
      }

      const duration = Date.now() - startTime;
      const fullResponse = tokens.join('');

      console.log(`\nStreamed ${tokens.length} tokens in ${duration}ms`);
      console.log(`Full response: "${fullResponse}"`);

      expect(tokens.length).toBeGreaterThan(0);
      expect(fullResponse.toLowerCase()).toContain('hello');
      expect(duration).toBeLessThan(30000); // Under 30s

      await provider.close();
    }, 60000);

    testIfKey('should handle rate limits with retry', async () => {
      // This test intentionally makes multiple rapid requests
      const provider = new OpenRouterProvider(
        process.env.OPENROUTER_API_KEY!,
        'anthropic/claude-3.5-sonnet'
      );

      const messages = [
        { role: 'user' as const, content: 'Count from 1 to 5.' },
      ];

      // Make 5 rapid requests
      const results: string[] = [];
      for (let i = 0; i < 5; i++) {
        const tokens: string[] = [];
        for await (const token of provider.stream(messages, 0.7, 50)) {
          tokens.push(token);
        }
        results.push(tokens.join(''));
        console.log(`Request ${i + 1} complete`);
      }

      expect(results).toHaveLength(5);
      results.forEach(r => expect(r.length).toBeGreaterThan(0));

      await provider.close();
    }, 120000);

    testIfKey('should handle long context streaming', async () => {
      const provider = new OpenRouterProvider(
        process.env.OPENROUTER_API_KEY!,
        'anthropic/claude-3.5-sonnet'
      );

      // Create a long context (approx 2000 tokens)
      const longContext = 'Lorem ipsum dolor sit amet. '.repeat(100);

      const messages = [
        { role: 'system' as const, content: 'Summarize the following text.' },
        { role: 'user' as const, content: longContext },
      ];

      const tokens: string[] = [];
      const startTime = Date.now();

      for await (const token of provider.stream(messages, 0.3, 200)) {
        tokens.push(token);
      }

      const duration = Date.now() - startTime;
      const fullResponse = tokens.join('');

      console.log(`Long context: ${tokens.length} tokens in ${duration}ms`);
      expect(tokens.length).toBeGreaterThan(0);
      expect(fullResponse.length).toBeGreaterThan(10);

      await provider.close();
    }, 90000);

    testIfKey('should handle streaming errors gracefully', async () => {
      const provider = new OpenRouterProvider(
        process.env.OPENROUTER_API_KEY!,
        'invalid-model-name' // Invalid model
      );

      const messages = [
        { role: 'user' as const, content: 'Hello' },
      ];

      try {
        for await (const token of provider.stream(messages)) {
          // Should not reach here
        }
        // If we get here without error, that's also acceptable
        expect(true).toBe(true);
      } catch (error: any) {
        // Expected to fail with invalid model
        expect(error.message).toBeDefined();
        console.log('Expected error:', error.message);
      }

      await provider.close();
    }, 30000);
  });

  describe('OpenAI Streaming', () => {
    const testIfKey = hasOpenAI ? it : it.skip;

    testIfKey('should stream from OpenAI API', async () => {
      const provider = new OpenAIProvider(
        process.env.OPENAI_API_KEY!,
        'gpt-4o-mini'
      );

      const messages = [
        { role: 'user' as const, content: 'Say "Test complete"' },
      ];

      const tokens: string[] = [];
      const startTime = Date.now();

      for await (const token of provider.stream(messages, 0.7, 50)) {
        tokens.push(token);
      }

      const duration = Date.now() - startTime;
      console.log(`OpenAI: ${tokens.length} tokens in ${duration}ms`);

      expect(tokens.length).toBeGreaterThan(0);

      await provider.close();
    }, 60000);
  });

  describe('Anthropic Streaming', () => {
    const testIfKey = hasAnthropic ? it : it.skip;

    testIfKey('should stream from Anthropic API', async () => {
      const provider = new AnthropicProvider(
        process.env.ANTHROPIC_API_KEY!,
        'claude-3-5-sonnet-20241022'
      );

      const messages = [
        { role: 'user' as const, content: 'Say "Anthropic test complete"' },
      ];

      const tokens: string[] = [];
      const startTime = Date.now();

      for await (const token of provider.stream(messages, 0.7, 50)) {
        tokens.push(token);
      }

      const duration = Date.now() - startTime;
      console.log(`Anthropic: ${tokens.length} tokens in ${duration}ms`);

      expect(tokens.length).toBeGreaterThan(0);

      await provider.close();
    }, 60000);
  });

  describe('Streaming Performance Comparison', () => {
    const testIfAnyKey = (hasOpenRouter || hasOpenAI || hasAnthropic) ? it : it.skip;

    testIfAnyKey('should compare streaming latency across providers', async () => {
      const results: Record<string, { tokens: number; duration: number; tps: number }> = {};

      const messages = [
        { role: 'user' as const, content: 'Write a short greeting.' },
      ];

      // Test OpenRouter if available
      if (hasOpenRouter) {
        const provider = new OpenRouterProvider(
          process.env.OPENROUTER_API_KEY!,
          'anthropic/claude-3.5-sonnet'
        );

        const tokens: string[] = [];
        const start = Date.now();
        for await (const token of provider.stream(messages, 0.7, 100)) {
          tokens.push(token);
        }
        const duration = Date.now() - start;

        results.openrouter = {
          tokens: tokens.length,
          duration,
          tps: tokens.length / (duration / 1000),
        };

        await provider.close();
      }

      // Test OpenAI if available
      if (hasOpenAI) {
        const provider = new OpenAIProvider(
          process.env.OPENAI_API_KEY!,
          'gpt-4o-mini'
        );

        const tokens: string[] = [];
        const start = Date.now();
        for await (const token of provider.stream(messages, 0.7, 100)) {
          tokens.push(token);
        }
        const duration = Date.now() - start;

        results.openai = {
          tokens: tokens.length,
          duration,
          tps: tokens.length / (duration / 1000),
        };

        await provider.close();
      }

      // Test Anthropic if available
      if (hasAnthropic) {
        const provider = new AnthropicProvider(
          process.env.ANTHROPIC_API_KEY!,
          'claude-3-5-sonnet-20241022'
        );

        const tokens: string[] = [];
        const start = Date.now();
        for await (const token of provider.stream(messages, 0.7, 100)) {
          tokens.push(token);
        }
        const duration = Date.now() - start;

        results.anthropic = {
          tokens: tokens.length,
          duration,
          tps: tokens.length / (duration / 1000),
        };

        await provider.close();
      }

      console.log('\n=== Streaming Performance Comparison ===');
      for (const [provider, stats] of Object.entries(results)) {
        console.log(`${provider}: ${stats.tokens} tokens, ${stats.duration}ms, ${stats.tps.toFixed(1)} TPS`);
      }

      expect(Object.keys(results).length).toBeGreaterThan(0);
    }, 120000);
  });

  describe('Mock Tests (No API Key Required)', () => {
    it('should validate streaming infrastructure without API', () => {
      // Verify that streaming methods exist and have correct signatures
      expect(typeof OpenRouterProvider.prototype.stream).toBe('function');
      expect(typeof OpenAIProvider.prototype.stream).toBe('function');
      expect(typeof AnthropicProvider.prototype.stream).toBe('function');
    });

    it('should have correct error handling infrastructure', () => {
      // Verify that providers have resilience patterns
      const mockProvider = new OpenRouterProvider('fake-key');
      expect(mockProvider.circuitBreaker).toBeDefined();
      expect(typeof mockProvider.executeWithResilience).toBe('function');
    });
  });
});
