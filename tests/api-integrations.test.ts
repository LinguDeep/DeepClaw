import { 
  APIClient, 
  GitHubIntegration, 
  SlackIntegration, 
  GenericAPI, 
  WebhookHandler, 
  WebhookEvent,
  IntegrationRegistry, 
  getIntegrationRegistry 
} from '../src/api-integrations';

describe('APIClient', () => {
  it('should create an API client', () => {
    const client = new APIClient({
      name: 'test',
      baseUrl: 'https://api.example.com',
      credentials: { type: 'none' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(client).toBeTruthy();
  });

  it('should apply rate limiting config', () => {
    const client = new APIClient({
      name: 'rate-limited',
      baseUrl: 'https://api.example.com',
      credentials: { type: 'bearer', token: 'test' },
      rateLimitPerMinute: 10,
    });
    expect(client).toBeTruthy();
  });
});

describe('GitHubIntegration', () => {
  it('should create with token', () => {
    const gh = new GitHubIntegration('fake-token-123');
    expect(gh).toBeTruthy();
  });
});

describe('SlackIntegration', () => {
  it('should create with token', () => {
    const slack = new SlackIntegration('xoxb-fake-token');
    expect(slack).toBeTruthy();
  });
});

describe('GenericAPI', () => {
  it('should create with config', () => {
    const api = new GenericAPI({
      name: 'test-api',
      baseUrl: 'https://api.test.com',
      credentials: { type: 'bearer', token: 'test-token' },
    });
    expect(api).toBeTruthy();
  });
});

describe('WebhookHandler', () => {
  let handler: WebhookHandler;

  beforeEach(() => {
    handler = new WebhookHandler();
  });

  it('should register event handlers', () => {
    handler.on('test_event', async (_event: WebhookEvent) => {});
    expect(handler).toBeTruthy();
  });

  it('should process webhooks and trigger handlers', async () => {
    const received: WebhookEvent[] = [];
    handler.on('push', async (event: WebhookEvent) => {
      received.push(event);
    });

    await handler.process('github', 'push', { ref: 'refs/heads/main', commits: [] });

    expect(received.length).toBe(1);
    expect(received[0].payload.ref).toBe('refs/heads/main');
  });

  it('should support wildcard handlers', async () => {
    const allEvents: WebhookEvent[] = [];
    handler.on('*', async (event: WebhookEvent) => {
      allEvents.push(event);
    });

    await handler.process('test', 'push', { a: 1 });
    await handler.process('test', 'issue', { b: 2 });

    expect(allEvents.length).toBe(2);
  });

  it('should log events', async () => {
    await handler.process('ci', 'deploy', {});
    const log = handler.getRecentEvents();
    expect(log.length).toBe(1);
    expect(log[0].event).toBe('deploy');
  });
});

describe('IntegrationRegistry', () => {
  let registry: IntegrationRegistry;

  beforeEach(() => {
    registry = new IntegrationRegistry();
  });

  it('should start empty', () => {
    expect(registry.list().length).toBe(0);
  });

  it('should register GitHub integration', () => {
    const gh = registry.registerGitHub('fake-token');
    expect(gh).toBeTruthy();
    expect(registry.list()).toContain('github');
  });

  it('should register Slack integration', () => {
    const slack = registry.registerSlack('xoxb-fake');
    expect(slack).toBeTruthy();
    expect(registry.list()).toContain('slack');
  });

  it('should register generic API', () => {
    const api = registry.registerAPI('custom', {
      name: 'custom',
      baseUrl: 'https://api.custom.io',
      credentials: { type: 'bearer', token: 'tok' },
    });
    expect(api).toBeTruthy();
    expect(registry.list()).toContain('custom');
  });

  it('should retrieve registered integrations', () => {
    registry.registerGitHub('tok');
    const gh = registry.get('github');
    expect(gh).toBeTruthy();
  });

  it('should return undefined for unregistered', () => {
    const result = registry.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should list all registered integrations', () => {
    registry.registerGitHub('tok1');
    registry.registerSlack('tok2');
    registry.registerAPI('custom', {
      name: 'custom',
      baseUrl: 'https://x.com',
      credentials: { type: 'bearer', token: 'tok3' },
    });

    const list = registry.list();
    expect(list.length).toBe(3);
    expect(list).toContain('github');
    expect(list).toContain('slack');
    expect(list).toContain('custom');
  });
});

describe('getIntegrationRegistry singleton', () => {
  it('should return same instance', () => {
    const a = getIntegrationRegistry();
    const b = getIntegrationRegistry();
    expect(a).toBe(b);
  });
});
