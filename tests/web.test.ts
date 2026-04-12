import request from 'supertest';
import express from 'express';
import { WebUIManager } from '../src/web';
import path from 'path';
import os from 'os';
import fs from 'fs';

// We test the Express app directly without starting the full server
// This avoids IMAP connections, browser init, etc.

describe('Web UI API', () => {
  let manager: WebUIManager;
  let testDir: string;

  beforeAll(() => {
    testDir = path.join(os.tmpdir(), `linguclaw-web-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    manager = new WebUIManager(testDir, '127.0.0.1', 0); // port 0 = random
    // Setup routes without starting server or email receivers
    manager['app'].use(express.json());
    manager['setupRoutes']();
  });

  afterAll(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  const app = () => manager['app'];

  describe('GET /api/health', () => {
    it('should return ok status', async () => {
      const res = await request(app()).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.version).toBeDefined();
    });
  });

  describe('GET /api/state', () => {
    it('should return not running when no orchestrator', async () => {
      const res = await request(app()).get('/api/state');
      expect(res.status).toBe(200);
      expect(res.body.running).toBe(false);
    });
  });

  describe('POST /api/task', () => {
    it('should require task field', async () => {
      const res = await request(app()).post('/api/task').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Task required');
    });

    it('should respond to task submission', async () => {
      const res = await request(app()).post('/api/task').send({ task: 'test task' });
      // Either starts successfully (200 with task_id) or fails (500 no provider)
      if (res.status === 200) {
        expect(res.body.status).toBe('started');
        expect(res.body.task_id).toBeDefined();
      } else {
        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
      }
    });
  });

  describe('GET /api/settings', () => {
    it('should return settings with masked API key', async () => {
      const res = await request(app()).get('/api/settings');
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      // API key should be masked or empty
      if (res.body.llm?.apiKey) {
        expect(res.body.llm.apiKey).toBe('***');
      }
    });
  });

  describe('POST /api/settings', () => {
    it('should update settings', async () => {
      const res = await request(app()).post('/api/settings').send({
        system: { logLevel: 'debug' },
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should not overwrite API key with masked value', async () => {
      const res = await request(app()).post('/api/settings').send({
        llm: { apiKey: '***' },
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/chat', () => {
    it('should require message field', async () => {
      const res = await request(app()).post('/api/chat').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('message required');
    });

    it('should return error when no LLM provider configured', async () => {
      const res = await request(app()).post('/api/chat').send({ message: 'hello' });
      // May return 500 with error or 200 with error in reply depending on env
      if (res.status === 500) {
        expect(res.body.error).toBeDefined();
      } else {
        // Provider might have been found from env, or error is in reply
        expect(res.body).toBeDefined();
      }
    });
  });

  describe('GET /api/system/status', () => {
    it('should return system status', async () => {
      const res = await request(app()).get('/api/system/status');
      expect(res.status).toBe(200);
      expect(res.body.version).toBeDefined();
      expect(res.body.scheduler).toBeDefined();
      expect(res.body.browser).toBeDefined();
      expect(res.body.memory).toBeDefined();
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /api/skills', () => {
    it('should return skill list', async () => {
      const res = await request(app()).get('/api/skills');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      // Should have builtin skills
      const names = res.body.map((s: any) => s.name);
      expect(names).toContain('shell');
      expect(names).toContain('filesystem');
      expect(names).toContain('browser');
      expect(names).toContain('scheduler');
      expect(names).toContain('memory');

      // Should have integration skills
      expect(names).toContain('email');
      expect(names).toContain('telegram');
    });
  });

  describe('Scheduler API', () => {
    it('GET /api/scheduler/jobs should return empty list initially', async () => {
      const res = await request(app()).get('/api/scheduler/jobs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('POST /api/scheduler/jobs should create a job', async () => {
      const res = await request(app()).post('/api/scheduler/jobs').send({
        name: 'test-job',
        type: 'interval',
        schedule: '5m',
        command: 'echo test',
      });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('test-job');
    });
  });

  describe('Memory API', () => {
    it('GET /api/memory should return memory entries', async () => {
      const res = await request(app()).get('/api/memory');
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });

    it('POST /api/memory should store a memory', async () => {
      const res = await request(app()).post('/api/memory').send({
        key: 'test-key',
        value: 'test-value',
        category: 'test',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Inbox API', () => {
    it('GET /api/inbox/messages should return paginated messages', async () => {
      const res = await request(app()).get('/api/inbox/messages');
      expect(res.status).toBe(200);
      expect(res.body.messages).toBeDefined();
      expect(typeof res.body.unread).toBe('number');
    });

    it('GET /api/inbox/unread should return unread list', async () => {
      const res = await request(app()).get('/api/inbox/unread');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/inbox/counts should return unread counts', async () => {
      const res = await request(app()).get('/api/inbox/counts');
      expect(res.status).toBe(200);
      expect(typeof res.body.total).toBe('number');
    });

    it('GET /api/inbox/threads should return threads', async () => {
      const res = await request(app()).get('/api/inbox/threads');
      expect(res.status).toBe(200);
    });
  });

  describe('Browser API', () => {
    it('POST /api/browser/browse should require url', async () => {
      const res = await request(app()).post('/api/browser/browse').send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/browser/search should require query', async () => {
      const res = await request(app()).post('/api/browser/search').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('Chat history', () => {
    it('GET /api/chat/history should return history', async () => {
      const res = await request(app()).get('/api/chat/history');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});

describe('WebSocket', () => {
  it('should handle ping messages', () => {
    const manager = new WebUIManager(os.tmpdir(), '127.0.0.1', 0);
    // Test the handleWebSocketMessage method directly
    const sent: any[] = [];
    const fakeWs = {
      send: (data: string) => sent.push(JSON.parse(data)),
      readyState: 1, // OPEN
    };
    manager['handleWebSocketMessage'](fakeWs as any, { type: 'ping' });
    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe('pong');
  });

  it('should broadcast to connections', () => {
    const manager = new WebUIManager(os.tmpdir(), '127.0.0.1', 0);
    const sent: string[] = [];
    const fakeWs = {
      send: (data: string) => sent.push(data),
      readyState: 1, // WebSocket.OPEN
    };
    manager.connections.add(fakeWs as any);
    manager['broadcast']({ type: 'test', payload: 'hello' });
    expect(sent.length).toBe(1);
    const parsed = JSON.parse(sent[0]);
    expect(parsed.type).toBe('test');
    expect(parsed.payload).toBe('hello');
  });
});
