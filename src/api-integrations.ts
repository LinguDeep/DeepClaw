/**
 * API Integration Framework - Connect to external services
 * 
 * Core capabilities:
 * - GitHub: Repository management, issues, PRs, code search
 * - Slack: Send messages, read channels
 * - Google Calendar: Create/read events
 * - Generic REST API: Call any HTTP endpoint
 * - Webhook: Receive and send webhooks
 * - Rate limiting and retry built-in
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { getLogger } from './logger';
import { withRetry } from './resilience';

const logger = getLogger();

// ==================== Types ====================

export interface APICredentials {
  type: 'bearer' | 'basic' | 'api_key' | 'oauth2' | 'none';
  token?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  apiKeyHeader?: string;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
  duration?: number;
}

export interface IntegrationConfig {
  name: string;
  baseUrl: string;
  credentials: APICredentials;
  timeout?: number;
  retries?: number;
  rateLimitPerMinute?: number;
  headers?: Record<string, string>;
}

// ==================== Rate Limiter ====================

class RateLimiter {
  private timestamps: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(requestsPerMinute: number) {
    this.limit = requestsPerMinute;
    this.windowMs = 60000;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

    if (this.timestamps.length >= this.limit) {
      const waitMs = this.windowMs - (now - this.timestamps[0]);
      logger.debug(`[RateLimiter] Waiting ${waitMs}ms`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    this.timestamps.push(Date.now());
  }
}

// ==================== Base API Client ====================

export class APIClient {
  private client: AxiosInstance;
  private config: IntegrationConfig;
  private rateLimiter: RateLimiter | null;

  constructor(config: IntegrationConfig) {
    this.config = config;
    this.rateLimiter = config.rateLimitPerMinute
      ? new RateLimiter(config.rateLimitPerMinute)
      : null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'LinguClaw/0.4.3',
      ...config.headers,
    };

    // Apply credentials
    if (config.credentials.type === 'bearer' && config.credentials.token) {
      headers['Authorization'] = `Bearer ${config.credentials.token}`;
    } else if (config.credentials.type === 'api_key' && config.credentials.apiKey) {
      headers[config.credentials.apiKeyHeader || 'X-API-Key'] = config.credentials.apiKey;
    } else if (config.credentials.type === 'basic' && config.credentials.username) {
      const encoded = Buffer.from(`${config.credentials.username}:${config.credentials.password || ''}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    }

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers,
    });
  }

  async request<T = any>(method: string, path: string, data?: any, extraHeaders?: Record<string, string>): Promise<APIResponse<T>> {
    if (this.rateLimiter) await this.rateLimiter.acquire();

    const startTime = Date.now();

    try {
      const response = await withRetry(
        () => this.client.request<T>({
          method,
          url: path,
          data,
          headers: extraHeaders,
        }),
        { maxRetries: this.config.retries || 2 },
        `${this.config.name}:${method}:${path}`
      );

      return {
        success: true,
        data: response.data,
        status: response.status,
        headers: response.headers as Record<string, string>,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        status: error.response?.status,
        error: error.response?.data?.message || error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async get<T = any>(path: string, params?: Record<string, any>): Promise<APIResponse<T>> {
    const query = params ? '?' + new URLSearchParams(params as any).toString() : '';
    return this.request<T>('GET', path + query);
  }

  async post<T = any>(path: string, data?: any): Promise<APIResponse<T>> {
    return this.request<T>('POST', path, data);
  }

  async put<T = any>(path: string, data?: any): Promise<APIResponse<T>> {
    return this.request<T>('PUT', path, data);
  }

  async delete<T = any>(path: string): Promise<APIResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  async patch<T = any>(path: string, data?: any): Promise<APIResponse<T>> {
    return this.request<T>('PATCH', path, data);
  }
}

// ==================== GitHub Integration ====================

export class GitHubIntegration {
  private client: APIClient;

  constructor(token: string) {
    this.client = new APIClient({
      name: 'GitHub',
      baseUrl: 'https://api.github.com',
      credentials: { type: 'bearer', token },
      rateLimitPerMinute: 30,
      retries: 2,
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
  }

  async getRepo(owner: string, repo: string): Promise<APIResponse> {
    return this.client.get(`/repos/${owner}/${repo}`);
  }

  async listIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<APIResponse> {
    return this.client.get(`/repos/${owner}/${repo}/issues`, { state, per_page: '30' });
  }

  async createIssue(owner: string, repo: string, title: string, body: string, labels?: string[]): Promise<APIResponse> {
    return this.client.post(`/repos/${owner}/${repo}/issues`, { title, body, labels });
  }

  async searchCode(query: string): Promise<APIResponse> {
    return this.client.get('/search/code', { q: query });
  }

  async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<APIResponse> {
    const params: Record<string, string> = {};
    if (ref) params.ref = ref;
    return this.client.get(`/repos/${owner}/${repo}/contents/${path}`, params);
  }

  async createPullRequest(owner: string, repo: string, title: string, body: string, head: string, base: string): Promise<APIResponse> {
    return this.client.post(`/repos/${owner}/${repo}/pulls`, { title, body, head, base });
  }

  async listPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<APIResponse> {
    return this.client.get(`/repos/${owner}/${repo}/pulls`, { state, per_page: '30' });
  }
}

// ==================== Slack Integration ====================

export class SlackIntegration {
  private client: APIClient;

  constructor(token: string) {
    this.client = new APIClient({
      name: 'Slack',
      baseUrl: 'https://slack.com/api',
      credentials: { type: 'bearer', token },
      rateLimitPerMinute: 50,
      retries: 1,
    });
  }

  async sendMessage(channel: string, text: string, blocks?: any[]): Promise<APIResponse> {
    return this.client.post('/chat.postMessage', { channel, text, blocks });
  }

  async listChannels(): Promise<APIResponse> {
    return this.client.get('/conversations.list', { types: 'public_channel,private_channel', limit: '100' });
  }

  async getChannelHistory(channel: string, limit: number = 20): Promise<APIResponse> {
    return this.client.get('/conversations.history', { channel, limit: limit.toString() });
  }

  async uploadFile(channel: string, content: string, filename: string, title?: string): Promise<APIResponse> {
    return this.client.post('/files.upload', { channels: channel, content, filename, title });
  }
}

// ==================== Generic REST API ====================

export class GenericAPI {
  private client: APIClient;

  constructor(config: IntegrationConfig) {
    this.client = new APIClient(config);
  }

  async call(method: string, path: string, data?: any, headers?: Record<string, string>): Promise<APIResponse> {
    return this.client.request(method, path, data, headers);
  }

  async get(path: string, params?: Record<string, any>): Promise<APIResponse> {
    return this.client.get(path, params);
  }

  async post(path: string, data?: any): Promise<APIResponse> {
    return this.client.post(path, data);
  }
}

// ==================== Webhook Handler ====================

export interface WebhookEvent {
  id: string;
  source: string;
  event: string;
  payload: any;
  timestamp: Date;
  headers: Record<string, string>;
}

export class WebhookHandler {
  private handlers: Map<string, ((event: WebhookEvent) => Promise<void>)[]> = new Map();
  private eventLog: WebhookEvent[] = [];
  private maxLogSize: number = 100;

  /**
   * Register a handler for a specific event type
   */
  on(eventType: string, handler: (event: WebhookEvent) => Promise<void>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  /**
   * Process an incoming webhook
   */
  async process(source: string, event: string, payload: any, headers: Record<string, string> = {}): Promise<void> {
    const webhookEvent: WebhookEvent = {
      id: `wh-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      source,
      event,
      payload,
      timestamp: new Date(),
      headers,
    };

    this.eventLog.push(webhookEvent);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    const handlers = this.handlers.get(event) || [];
    const wildcardHandlers = this.handlers.get('*') || [];

    for (const handler of [...handlers, ...wildcardHandlers]) {
      try {
        await handler(webhookEvent);
      } catch (error: any) {
        logger.error(`[Webhook] Handler error for ${event}: ${error.message}`);
      }
    }

    logger.info(`[Webhook] Processed: ${source}/${event}`);
  }

  /**
   * Get recent webhook events
   */
  getRecentEvents(limit: number = 20): WebhookEvent[] {
    return this.eventLog.slice(-limit);
  }

  /**
   * Send a webhook to an external URL
   */
  async send(url: string, payload: any, headers?: Record<string, string>): Promise<APIResponse> {
    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'LinguClaw-Webhook/0.4.3',
          ...headers,
        },
        timeout: 10000,
      });

      return { success: true, status: response.status, data: response.data };
    } catch (error: any) {
      return { success: false, error: error.message, status: error.response?.status };
    }
  }
}

// ==================== Integration Registry ====================

export class IntegrationRegistry {
  private integrations: Map<string, APIClient | GitHubIntegration | SlackIntegration | GenericAPI> = new Map();
  private webhookHandler: WebhookHandler = new WebhookHandler();

  /**
   * Register a GitHub integration
   */
  registerGitHub(token: string): GitHubIntegration {
    const integration = new GitHubIntegration(token);
    this.integrations.set('github', integration);
    logger.info('[Integrations] GitHub registered');
    return integration;
  }

  /**
   * Register a Slack integration
   */
  registerSlack(token: string): SlackIntegration {
    const integration = new SlackIntegration(token);
    this.integrations.set('slack', integration);
    logger.info('[Integrations] Slack registered');
    return integration;
  }

  /**
   * Register a generic API integration
   */
  registerAPI(name: string, config: IntegrationConfig): GenericAPI {
    const integration = new GenericAPI(config);
    this.integrations.set(name, integration);
    logger.info(`[Integrations] ${name} registered`);
    return integration;
  }

  /**
   * Get an integration by name
   */
  get<T = any>(name: string): T | undefined {
    return this.integrations.get(name) as T | undefined;
  }

  /**
   * Get the webhook handler
   */
  getWebhookHandler(): WebhookHandler {
    return this.webhookHandler;
  }

  /**
   * List all registered integrations
   */
  list(): string[] {
    return Array.from(this.integrations.keys());
  }

  /**
   * Auto-register integrations from environment variables
   */
  autoRegister(): string[] {
    const registered: string[] = [];

    if (process.env.GITHUB_TOKEN) {
      this.registerGitHub(process.env.GITHUB_TOKEN);
      registered.push('github');
    }

    if (process.env.SLACK_BOT_TOKEN) {
      this.registerSlack(process.env.SLACK_BOT_TOKEN);
      registered.push('slack');
    }

    if (registered.length > 0) {
      logger.info(`[Integrations] Auto-registered: ${registered.join(', ')}`);
    }

    return registered;
  }
}

// ==================== Singleton ====================

let registryInstance: IntegrationRegistry | null = null;

export function getIntegrationRegistry(): IntegrationRegistry {
  if (!registryInstance) {
    registryInstance = new IntegrationRegistry();
  }
  return registryInstance;
}
