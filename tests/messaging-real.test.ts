/**
 * Messaging Integration Tests - Real API validation
 * Tests actual HTTP calls with mocked responses to verify logic
 */

import { TelegramBot, DiscordBot, SlackBot, WhatsAppBot, MessagingHub } from '../src/messaging';
import { ChatResponse, MessagingPlatform } from '../src/types';

// Mock axios for controlled testing
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
  })),
  post: jest.fn(),
}));

const mockAxios = require('axios') as jest.Mocked<typeof import('axios')>;

describe('Messaging Integrations - Real API Patterns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('TelegramBot', () => {
    it('should validate token on start', async () => {
      const bot = new TelegramBot('test-token');
      const mockGet = jest.fn().mockResolvedValue({
        data: { result: { username: 'testbot' } },
      });
      (bot as any).api.get = mockGet;

      await bot.start();
      expect(mockGet).toHaveBeenCalledWith('/getMe');
      expect(bot.running).toBe(true);
    });

    it('should handle rate limit with retry', async () => {
      const bot = new TelegramBot('test-token');
      const mockPost = jest.fn()
        .mockRejectedValueOnce({
          response: { status: 429, data: { parameters: { retry_after: 2 } } },
        })
        .mockResolvedValueOnce({ data: { ok: true } });
      (bot as any).api.post = mockPost;

      const response: ChatResponse = {
        platform: MessagingPlatform.TELEGRAM,
        chat_id: '123',
        content: 'Test message',
        actions: [],
      };

      await bot.send(response);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should split long messages (>4096 chars)', async () => {
      const bot = new TelegramBot('test-token');
      const mockPost = jest.fn().mockResolvedValue({ data: { ok: true } });
      (bot as any).api.post = mockPost;

      const longContent = 'A'.repeat(5000);
      const response: ChatResponse = {
        platform: MessagingPlatform.TELEGRAM,
        chat_id: '123',
        content: longContent,
        actions: [],
      };

      await bot.send(response);
      expect(mockPost).toHaveBeenCalledTimes(2); // Split into 2 chunks
    });

    it('should ignore empty messages', async () => {
      const bot = new TelegramBot('test-token');
      const handler = jest.fn();
      bot.onMessage(handler);

      const result = await (bot as any).handleMessage({
        platform: MessagingPlatform.TELEGRAM,
        chat_id: '123',
        user_id: '456',
        content: '   ',
        timestamp: new Date(),
      });

      expect(result).toBeNull();
      expect(handler).not.toHaveBeenCalled();
    });

    it('should filter unauthorized chats', async () => {
      const bot = new TelegramBot('test-token');
      bot.allowChats([100, 200]);
      const handler = jest.fn();
      bot.onMessage(handler);

      // Should process allowed chat (use number to match Telegram API)
      await (bot as any).handleMessage({
        platform: MessagingPlatform.TELEGRAM,
        chat_id: 100,
        user_id: '456',
        content: 'Hello',
        timestamp: new Date(),
      });
      expect(handler).toHaveBeenCalled();

      // Should skip unauthorized chat
      handler.mockClear();
      await (bot as any).handleMessage({
        platform: MessagingPlatform.TELEGRAM,
        chat_id: 999,
        user_id: '456',
        content: 'Hello',
        timestamp: new Date(),
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('DiscordBot', () => {
    it('should validate token on start', async () => {
      const bot = new DiscordBot('test-token');
      const mockGet = jest.fn().mockResolvedValue({
        data: { username: 'TestBot', discriminator: '1234' },
      });
      (bot as any).api.get = mockGet;

      // Mock WebSocket
      const mockWs = {
        on: jest.fn(),
        send: jest.fn(),
        close: jest.fn(),
      };
      jest.doMock('ws', () => jest.fn(() => mockWs));

      await bot.start();
      expect(mockGet).toHaveBeenCalledWith('/users/@me');
    });

    it('should handle rate limit with retry', async () => {
      const bot = new DiscordBot('test-token');
      const mockPost = jest.fn()
        .mockRejectedValueOnce({
          response: { status: 429, data: { retry_after: 1 } },
        })
        .mockResolvedValueOnce({ data: {} });
      (bot as any).api.post = mockPost;

      const response: ChatResponse = {
        platform: MessagingPlatform.DISCORD,
        chat_id: 'channel123',
        content: 'Test',
        actions: [],
      };

      await bot.send(response);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should split long messages (>2000 chars)', async () => {
      const bot = new DiscordBot('test-token');
      const mockPost = jest.fn().mockResolvedValue({ data: {} });
      (bot as any).api.post = mockPost;

      const longContent = 'A'.repeat(2500);
      const response: ChatResponse = {
        platform: MessagingPlatform.DISCORD,
        chat_id: 'channel123',
        content: longContent,
        actions: [],
      };

      await bot.send(response);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('SlackBot', () => {
    it('should validate token on start', async () => {
      const bot = new SlackBot('xoxb-test-token');
      const mockPost = jest.fn().mockResolvedValue({
        data: { ok: true, user: 'bot', team: 'workspace' },
      });
      (bot as any).api.post = mockPost;

      await bot.start();
      expect(mockPost).toHaveBeenCalledWith('/auth.test');
    });

    it('should handle rate limit', async () => {
      const bot = new SlackBot('xoxb-test-token');
      const mockPost = jest.fn()
        .mockResolvedValueOnce({
          data: { ok: false, error: 'ratelimited' },
          headers: { 'retry-after': '2' },
        })
        .mockResolvedValueOnce({ data: { ok: true } });
      (bot as any).api.post = mockPost;

      const response: ChatResponse = {
        platform: MessagingPlatform.SLACK,
        chat_id: 'C123',
        content: 'Test',
        actions: [],
      };

      await bot.send(response);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should split long messages (>4000 chars)', async () => {
      const bot = new SlackBot('xoxb-test-token');
      const mockPost = jest.fn().mockResolvedValue({ data: { ok: true } });
      (bot as any).api.post = mockPost;

      const longContent = 'A'.repeat(5000);
      const response: ChatResponse = {
        platform: MessagingPlatform.SLACK,
        chat_id: 'C123',
        content: longContent,
        actions: [],
      };

      await bot.send(response);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('WhatsAppBot (Twilio)', () => {
    it('should validate credentials on start', async () => {
      const bot = new WhatsAppBot('AC123', 'auth-token', 'whatsapp:+123');
      const mockGet = jest.fn().mockResolvedValue({
        data: { friendly_name: 'Test Account' },
      });
      (bot as any).api.get = mockGet;

      await bot.start();
      expect(mockGet).toHaveBeenCalledWith('.json');
      expect(bot.running).toBe(true);
    });

    it('should format phone numbers correctly', async () => {
      const bot = new WhatsAppBot('AC123', 'auth-token', 'whatsapp:+14155238886');
      const mockPost = jest.fn().mockResolvedValue({ data: {} });
      (bot as any).api.post = mockPost;

      const response: ChatResponse = {
        platform: MessagingPlatform.WHATSAPP,
        chat_id: '+905551234567',
        content: 'Test',
        actions: [],
      };

      await bot.send(response);
      const callArgs = mockPost.mock.calls[0];
      expect(callArgs[1].get('To')).toBe('whatsapp:+905551234567');
      expect(callArgs[1].get('From')).toBe('whatsapp:+14155238886');
    });

    it('should split long messages (>1600 chars)', async () => {
      const bot = new WhatsAppBot('AC123', 'auth-token');
      const mockPost = jest.fn().mockResolvedValue({ data: {} });
      (bot as any).api.post = mockPost;

      const longContent = 'A'.repeat(2000);
      const response: ChatResponse = {
        platform: MessagingPlatform.WHATSAPP,
        chat_id: '+1234567890',
        content: longContent,
        actions: [],
      };

      await bot.send(response);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should handle webhook correctly', () => {
      const bot = new WhatsAppBot('AC123', 'auth-token');
      const message = bot.handleWebhook({
        Body: 'Hello from WhatsApp',
        From: 'whatsapp:+1234567890',
        ProfileName: 'John Doe',
      });

      expect(message).not.toBeNull();
      expect(message?.content).toBe('Hello from WhatsApp');
      expect(message?.username).toBe('John Doe');
    });

    it('should skip webhook without body', () => {
      const bot = new WhatsAppBot('AC123', 'auth-token');
      const message = bot.handleWebhook({
        From: 'whatsapp:+1234567890',
      });

      expect(message).toBeNull();
    });
  });

  describe('MessagingHub', () => {
    it('should start all platforms with Promise.allSettled', async () => {
      const hub = new MessagingHub();
      const bot1 = new TelegramBot('token1');
      const bot2 = new DiscordBot('token2');
      
      // Mock starts
      bot1.start = jest.fn().mockResolvedValue(undefined);
      bot2.start = jest.fn().mockRejectedValue(new Error('Discord error'));
      
      hub.addPlatform(bot1);
      hub.addPlatform(bot2);
      
      await hub.startAll();
      
      expect(bot1.start).toHaveBeenCalled();
      expect(bot2.start).toHaveBeenCalled();
      // Should not throw despite bot2 failing
    });

    it('should route messages to agent callback', async () => {
      const hub = new MessagingHub();
      const agentHandler = jest.fn().mockReturnValue({
        platform: MessagingPlatform.TELEGRAM,
        chat_id: '123',
        content: 'Response',
        actions: [],
      });
      
      hub.registerAgent(agentHandler);
      
      const bot = new TelegramBot('token');
      bot.start = jest.fn().mockResolvedValue(undefined);
      hub.addPlatform(bot);
      
      // Verify agent was registered
      expect(bot['messageHandlers']).toContain(agentHandler);
    });

    it('should report platform status', () => {
      const hub = new MessagingHub();
      const bot = new TelegramBot('token');
      bot.running = true;
      
      hub.addPlatform(bot);
      const status = hub.getStatus();
      
      expect(status[MessagingPlatform.TELEGRAM]).toBe(true);
    });

    it('should create platforms from env vars', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      
      const hub = new MessagingHub();
      const platforms = hub.createPlatformsFromEnv();
      
      expect(platforms).toHaveLength(2);
      expect(platforms[0]).toBeInstanceOf(TelegramBot);
      expect(platforms[1]).toBeInstanceOf(DiscordBot);
      
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.DISCORD_BOT_TOKEN;
    });
  });
});
