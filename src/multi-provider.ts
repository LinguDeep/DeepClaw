/**
 * Multi-provider LLM support - OpenAI, Claude, Local LLMs, Ollama
 * TypeScript equivalent of Python multi_provider.py
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { Message, LLMResponse, ProviderType } from './types';
import { getLogger } from './logger';

export { ProviderType } from './types';

const logger = getLogger();

export abstract class BaseProvider {
  model: string;
  apiKey: string | null;
  baseUrl: string;
  client: AxiosInstance;

  constructor(model: string, apiKey: string | null = null, baseUrl: string | null = null) {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || '';
    this.client = axios.create({
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  abstract complete(messages: Message[], temperature?: number, maxTokens?: number): Promise<LLMResponse>;

  async *stream(messages: Message[], temperature: number = 0.7, maxTokens: number = 4096): AsyncGenerator<string> {
    const response = await this.complete(messages, temperature, maxTokens);
    yield response.content;
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
      logger.error(`OpenRouter error: ${error.message}`);
      return { content: '', error: error.message, model: '' };
    }
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
    // Priority: Ollama (local) > OpenRouter > OpenAI > Anthropic

    // Check Ollama (self-hosted, no API key needed)
    const ollama = new OllamaProvider();
    if (ollama.available) {
      logger.info('Using local Ollama provider');
      return ollama;
    }

    // Check LM Studio
    const lmstudio = new LMStudioProvider();
    if (lmstudio.available) {
      logger.info('Using local LM Studio provider');
      return lmstudio;
    }

    // Check cloud providers
    if (process.env.OPENROUTER_API_KEY) {
      const model = process.env.LINGUCLAW_MODEL || 'anthropic/claude-3.5-sonnet';
      return new OpenRouterProvider(process.env.OPENROUTER_API_KEY, model);
    }

    if (process.env.OPENAI_API_KEY) {
      const model = process.env.OPENAI_MODEL || 'gpt-4o';
      return new OpenAIProvider(process.env.OPENAI_API_KEY, model);
    }

    if (process.env.ANTHROPIC_API_KEY) {
      const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
      return new AnthropicProvider(process.env.ANTHROPIC_API_KEY, model);
    }

    logger.error('No LLM provider available. Set OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or run Ollama/LM Studio.');
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
      return new OpenRouterProvider(kwargs.api_key, kwargs.model || 'anthropic/claude-3.5-sonnet');
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
