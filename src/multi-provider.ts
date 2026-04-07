/**
 * Multi-provider LLM support - OpenAI, Claude, Local LLMs, Ollama
 * TypeScript equivalent of Python multi_provider.py
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { Message, LLMResponse, ProviderType } from './types';
import { getLogger } from './logger';
import { getConfig } from './config';
import { withRetry, CircuitBreaker, withTimeout, getAdaptiveRetryConfig } from './resilience';

export { ProviderType } from './types';

const logger = getLogger();

export abstract class BaseProvider {
  model: string;
  apiKey: string | null;
  baseUrl: string;
  client: AxiosInstance;
  circuitBreaker: CircuitBreaker;

  constructor(model: string, apiKey: string | null = null, baseUrl: string | null = null) {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || '';
    this.circuitBreaker = new CircuitBreaker(5, 30000, model);
    this.client = axios.create({
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  abstract complete(messages: Message[], temperature?: number, maxTokens?: number): Promise<LLMResponse>;

  async *stream(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): AsyncGenerator<string> {
    // Default fallback: yield complete response as single chunk
    const response = await this.complete(messages, temperature, maxTokens);
    yield response.content;
  }

  /**
   * Execute with resilience patterns (retry + circuit breaker)
   */
  protected async executeWithResilience<T>(
    fn: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return this.circuitBreaker.execute(() =>
      withRetry(fn, { maxRetries: 3, baseDelayMs: 1000 }, operationName)
    );
  }

  /**
   * Helper for OpenAI-compatible SSE streaming (used by OpenRouter, OpenAI, LMStudio)
   */
  protected async *streamOpenAICompat(
    url: string,
    headers: Record<string, string>,
    messages: Message[],
    model: string,
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<string> {
    const payload = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
      stream: true,
    };

    // Retry with exponential backoff for rate limits
    let retries = 0;
    const maxRetries = 3;
    let response: any;

    while (retries < maxRetries) {
      try {
        response = await this.client.post(url, payload, {
          headers,
          responseType: 'stream',
          timeout: 120000,
          validateStatus: (status: number) => status < 500 || status === 429,
        });
        break; // Success, exit retry loop
      } catch (error: any) {
        const status = error.response?.status;
        if (status === 429 && retries < maxRetries - 1) {
          const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
          logger.warn(`Rate limit hit, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          retries++;
        } else {
          throw error;
        }
      }
    }

    if (!response) {
      throw new Error('Failed to get streaming response after retries');
    }

    const stream = response.data;
    let buffer = '';

    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  }

  async close(): Promise<void> {
    // Axios doesn't require explicit cleanup, but we keep this for API consistency
  }
}

export class OpenRouterProvider extends BaseProvider {
  headers: Record<string, string>;

  constructor(apiKey: string, model: string = 'anthropic/claude-3.5-sonnet') {
    super(model, apiKey, 'https://openrouter.ai/api/v1');
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://linguclaw.local',
      'X-Title': 'LinguClaw',
    };
  }

  async complete(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): Promise<LLMResponse> {
    try {
      const payload = {
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature,
        max_tokens: maxTokens,
      };

      const response: AxiosResponse = await this.client.post(
        `${this.baseUrl}/chat/completions`,
        payload,
        { headers: this.headers }
      );

      const data = response.data;
      return {
        content: data.choices[0].message.content,
        usage: data.usage || {},
        model: data.model || this.model,
        finish_reason: data.choices[0].finish_reason,
      };
    } catch (error: any) {
      // Log full error details for debugging
      console.error('=== OpenRouter API Error ===');
      console.error('Error message:', error.message);
      console.error('Error code:', error.code);
      console.error('Error response:', error.response?.data);
      console.error('Status:', error.response?.status);
      logger.error(`OpenRouter error: ${error.message}`);
      return { content: '', error: error.message, model: '' };
    }
  }

  async *stream(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): AsyncGenerator<string> {
    yield* this.streamOpenAICompat(
      `${this.baseUrl}/chat/completions`,
      this.headers,
      messages, this.model, temperature, maxTokens
    );
  }
}

export class OpenAIProvider extends BaseProvider {
  headers: Record<string, string>;

  constructor(apiKey: string, model: string = 'gpt-4o') {
    super(model, apiKey, 'https://api.openai.com/v1');
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async complete(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): Promise<LLMResponse> {
    try {
      const payload = {
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature,
        max_tokens: maxTokens,
      };

      const response: AxiosResponse = await this.client.post(
        `${this.baseUrl}/chat/completions`,
        payload,
        { headers: this.headers }
      );

      const data = response.data;
      return {
        content: data.choices[0].message.content,
        usage: data.usage || {},
        model: data.model || this.model,
        finish_reason: data.choices[0].finish_reason,
      };
    } catch (error: any) {
      logger.error(`OpenAI error: ${error.message}`);
      return { content: '', error: error.message, model: '' };
    }
  }

  async *stream(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): AsyncGenerator<string> {
    yield* this.streamOpenAICompat(
      `${this.baseUrl}/chat/completions`,
      this.headers,
      messages, this.model, temperature, maxTokens
    );
  }
}

export class AnthropicProvider extends BaseProvider {
  headers: Record<string, string>;

  constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20241022') {
    super(model, apiKey, 'https://api.anthropic.com/v1');
    this.headers = {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
  }

  async complete(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): Promise<LLMResponse> {
    try {
      // Convert messages to Anthropic format
      let systemMsg = '';
      const userMsgs: Array<{ role: string; content: string }> = [];
      
      for (const m of messages) {
        if (m.role === 'system') {
          systemMsg = m.content;
        } else {
          userMsgs.push({ role: m.role, content: m.content });
        }
      }

      const payload: any = {
        model: this.model,
        max_tokens: maxTokens,
        temperature,
        messages: userMsgs,
      };
      
      if (systemMsg) {
        payload.system = systemMsg;
      }

      const response: AxiosResponse = await this.client.post(
        `${this.baseUrl}/messages`,
        payload,
        { headers: this.headers }
      );

      const data = response.data;
      return {
        content: data.content[0].text,
        usage: data.usage || {},
        model: data.model || this.model,
        finish_reason: data.stop_reason,
      };
    } catch (error: any) {
      logger.error(`Anthropic error: ${error.message}`);
      return { content: '', error: error.message, model: '' };
    }
  }

  async *stream(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): AsyncGenerator<string> {
    let systemMsg = '';
    const userMsgs: Array<{ role: string; content: string }> = [];
    for (const m of messages) {
      if (m.role === 'system') systemMsg = m.content;
      else userMsgs.push({ role: m.role, content: m.content });
    }

    const payload: any = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: userMsgs,
      stream: true,
    };
    if (systemMsg) payload.system = systemMsg;

    const response = await this.client.post(
      `${this.baseUrl}/messages`,
      payload,
      { headers: this.headers, responseType: 'stream', timeout: 120000 }
    );

    let buffer = '';
    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            yield parsed.delta.text;
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }
}

export class OllamaProvider extends BaseProvider {
  available: boolean;

  constructor(model: string = 'llama3.2', baseUrl: string = 'http://localhost:11434') {
    super(model, null, baseUrl);
    this.available = this.checkAvailability();
  }

  private checkAvailability(): boolean {
    try {
      // Note: In a real implementation, this would be async
      // For now, we assume availability is checked elsewhere
      return true;
    } catch {
      return false;
    }
  }

  async complete(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): Promise<LLMResponse> {
    if (!this.available) {
      return { content: '', error: "Ollama not available. Run 'ollama serve' first.", model: '' };
    }

    try {
      const prompt = this.formatMessages(messages);

      const payload = {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      };

      const response: AxiosResponse = await this.client.post(
        `${this.baseUrl}/api/generate`,
        payload
      );

      const data = response.data;
      return {
        content: data.response || '',
        model: this.model,
        usage: {
          prompt_tokens: data.prompt_eval_count || 0,
          completion_tokens: data.eval_count || 0,
        },
      };
    } catch (error: any) {
      logger.error(`Ollama error: ${error.message}`);
      return { content: '', error: error.message, model: '' };
    }
  }

  private formatMessages(messages: Message[]): string {
    const parts: string[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        parts.push(`System: ${m.content}`);
      } else if (m.role === 'user') {
        parts.push(`User: ${m.content}`);
      } else if (m.role === 'assistant') {
        parts.push(`Assistant: ${m.content}`);
      }
    }
    parts.push('Assistant:');
    return parts.join('\n\n');
  }
}

export class LMStudioProvider extends BaseProvider {
  available: boolean;

  constructor(baseUrl: string = 'http://localhost:1234') {
    super('local', null, baseUrl);
    this.available = this.checkAvailability();
  }

  private checkAvailability(): boolean {
    try {
      return true;
    } catch {
      return false;
    }
  }

  async complete(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): Promise<LLMResponse> {
    if (!this.available) {
      return { content: '', error: 'LM Studio not available. Start the server first.', model: '' };
    }

    try {
      const payload = {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature,
        max_tokens: maxTokens,
      };

      const response: AxiosResponse = await this.client.post(
        `${this.baseUrl}/v1/chat/completions`,
        payload
      );

      const data = response.data;
      return {
        content: data.choices[0].message.content,
        usage: data.usage || {},
        model: 'local',
      };
    } catch (error: any) {
      logger.error(`LM Studio error: ${error.message}`);
      return { content: '', error: error.message, model: '' };
    }
  }
}

export class ProviderManager {
  providers: Map<string, BaseProvider>;
  primaryProvider: string | null;

  constructor() {
    this.providers = new Map();
    this.primaryProvider = null;
  }

  addProvider(name: string, provider: BaseProvider, primary: boolean = false): void {
    this.providers.set(name, provider);
    if (primary || this.primaryProvider === null) {
      this.primaryProvider = name;
    }
  }

  createFromEnv(): BaseProvider | null {
    // Read from config system (includes env var overrides from loadEnvConfig)
    const config = getConfig();
    const llmConfig = config.getLLM();

    // If config has a specific provider + apiKey, use that directly
    if (llmConfig.apiKey && llmConfig.apiKey.length > 0) {
      const provider = llmConfig.provider;
      const model = llmConfig.model;
      const apiKey = llmConfig.apiKey;

      logger.info(`Using configured provider: ${provider}, model: ${model}`);

      switch (provider) {
        case 'openrouter':
          return new OpenRouterProvider(apiKey, model);
        case 'openai':
          return new OpenAIProvider(apiKey, model);
        case 'anthropic':
          return new AnthropicProvider(apiKey, model);
        case 'ollama':
          return new OllamaProvider(model, llmConfig.baseUrl || 'http://localhost:11434');
        case 'lmstudio':
          return new LMStudioProvider(llmConfig.baseUrl || 'http://localhost:1234');
      }
    }

    // Fallback: Check local providers
    const ollama = new OllamaProvider();
    if (ollama.available) {
      logger.info('Using local Ollama provider');
      return ollama;
    }

    const lmstudio = new LMStudioProvider();
    if (lmstudio.available) {
      logger.info('Using local LM Studio provider');
      return lmstudio;
    }

    // Fallback: Check environment variables directly
    if (process.env.OPENROUTER_API_KEY) {
      return new OpenRouterProvider(process.env.OPENROUTER_API_KEY, process.env.LINGUCLAW_MODEL || 'anthropic/claude-3.5-sonnet');
    }
    if (process.env.OPENAI_API_KEY) {
      return new OpenAIProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL || 'gpt-4o');
    }
    if (process.env.ANTHROPIC_API_KEY) {
      return new AnthropicProvider(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022');
    }

    logger.error('No LLM provider available. Set API key in Settings or env vars (OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY), or run Ollama/LM Studio.');
    return null;
  }

  async complete(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096, provider?: string): Promise<LLMResponse> {
    const provName = provider || this.primaryProvider;
    if (!provName || !this.providers.has(provName)) {
      return { content: '', error: 'No provider available', model: '' };
    }

    const prov = this.providers.get(provName)!;
    return await prov.complete(messages, temperature, maxTokens);
  }

  async closeAll(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.close();
    }
  }
}

// Factory function for easy provider creation
export function createProvider(providerType: ProviderType, kwargs: Record<string, any> = {}): BaseProvider {
  switch (providerType) {
    case ProviderType.OPENROUTER:
      return new OpenRouterProvider(kwargs.api_key, kwargs.model || 'openai/gpt-3.5-turbo');
    case ProviderType.OPENAI:
      return new OpenAIProvider(kwargs.api_key, kwargs.model || 'gpt-4o');
    case ProviderType.ANTHROPIC:
      return new AnthropicProvider(kwargs.api_key, kwargs.model || 'claude-3-5-sonnet-20241022');
    case ProviderType.OLLAMA:
      return new OllamaProvider(kwargs.model || 'llama3.2', kwargs.base_url || 'http://localhost:11434');
    case ProviderType.LMSTUDIO:
      return new LMStudioProvider(kwargs.base_url || 'http://localhost:1234');
    default:
      throw new Error(`Unknown provider type: ${providerType}`);
  }
}
