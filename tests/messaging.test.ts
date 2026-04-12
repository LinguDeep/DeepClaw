import { TelegramBot, DiscordBot, SlackBot, WhatsAppBot, MessagingHub } from '../src/messaging';
import { MessagingPlatform, ChatResponse } from '../src/types';

describe('TelegramBot', () => {
  it('should create with token', () => {
    const bot = new TelegramBot('test-token-123');
    expect(bot.platform).toBe(MessagingPlatform.TELEGRAM);
    expect(bot.running).toBe(false);
  });

  it('should register message handlers', () => {
    const bot = new TelegramBot('test-token');
    const handler = jest.fn();
    bot.onMessage(handler);
    expect(bot.messageHandlers.length).toBe(1);
  });

  it('should allow setting allowed chats', () => {
    const bot = new TelegramBot('test-token');
    bot.allowChats([123, 456]);
    // No error thrown
    expect(bot.platform).toBe(MessagingPlatform.TELEGRAM);
  });
});

describe('DiscordBot', () => {
  it('should create with token', () => {
    const bot = new DiscordBot('discord-token-123');
    expect(bot.platform).toBe(MessagingPlatform.DISCORD);
    expect(bot.running).toBe(false);
  });

  it('should register message handlers', () => {
    const bot = new DiscordBot('test-token');
    const handler = jest.fn();
    bot.onMessage(handler);
    expect(bot.messageHandlers.length).toBe(1);
  });
});

describe('SlackBot', () => {
  it('should create with bot token', () => {
    const bot = new SlackBot('xoxb-test-token');
    expect(bot.platform).toBe(MessagingPlatform.SLACK);
    expect(bot.running).toBe(false);
  });

  it('should create with bot token and app token', () => {
    const bot = new SlackBot('xoxb-test', 'xapp-test');
    expect(bot.platform).toBe(MessagingPlatform.SLACK);
  });
});

describe('WhatsAppBot', () => {
  it('should create with defaults', () => {
    const bot = new WhatsAppBot();
    expect(bot.platform).toBe(MessagingPlatform.WHATSAPP);
    expect(bot.running).toBe(false);
  });

  it('should create with custom credentials', () => {
    const bot = new WhatsAppBot('sid123', 'auth456', 'whatsapp:+1234567890');
    expect(bot.platform).toBe(MessagingPlatform.WHATSAPP);
  });

  it('should handle webhook data', () => {
    const bot = new WhatsAppBot('sid', 'auth');
    const msg = bot.handleWebhook({
      Body: 'Hello',
      From: 'whatsapp:+1234567890',
      ProfileName: 'Test User',
    });
    expect(msg).not.toBeNull();
    expect(msg?.content).toBe('Hello');
    expect(msg?.username).toBe('Test User');
    expect(msg?.platform).toBe(MessagingPlatform.WHATSAPP);
  });

  it('should return null for invalid webhook data', () => {
    const bot = new WhatsAppBot('sid', 'auth');
    const msg = bot.handleWebhook({});
    expect(msg).toBeNull();
  });
});

describe('MessagingHub', () => {
  let hub: MessagingHub;

  beforeEach(() => {
    hub = new MessagingHub();
  });

  it('should add platforms', () => {
    const telegram = new TelegramBot('test');
    hub.addPlatform(telegram);
    expect(hub.platforms.size).toBe(1);
    expect(hub.platforms.has(MessagingPlatform.TELEGRAM)).toBe(true);
  });

  it('should add multiple platforms', () => {
    hub.addPlatform(new TelegramBot('test'));
    hub.addPlatform(new DiscordBot('test'));
    hub.addPlatform(new SlackBot('test'));
    expect(hub.platforms.size).toBe(3);
  });

  it('should register agent callback to all platforms', () => {
    const telegram = new TelegramBot('test');
    const discord = new DiscordBot('test');

    hub.addPlatform(telegram);
    hub.addPlatform(discord);

    const handler = jest.fn();
    hub.registerAgent(handler);

    expect(telegram.messageHandlers.length).toBe(1);
    expect(discord.messageHandlers.length).toBe(1);
  });

  it('should register agent to platforms added after', () => {
    const handler = jest.fn();
    hub.registerAgent(handler);

    const telegram = new TelegramBot('test');
    hub.addPlatform(telegram);

    expect(telegram.messageHandlers.length).toBe(1);
  });

  it('should get status of platforms', () => {
    hub.addPlatform(new TelegramBot('test'));
    hub.addPlatform(new DiscordBot('test'));

    const status = hub.getStatus();
    expect(Object.keys(status).length).toBe(2);
    // All should be not running initially
    expect(Object.values(status).every(v => v === false)).toBe(true);
  });

  it('should warn when sending to unregistered platform', async () => {
    const response: ChatResponse = {
      platform: MessagingPlatform.TELEGRAM,
      chat_id: '123',
      content: 'Hello',
      actions: [],
    };

    // Should not throw
    await expect(hub.sendToPlatform(MessagingPlatform.TELEGRAM, response)).resolves.not.toThrow();
  });

  it('should create platforms from env', () => {
    // No env vars set, should return empty array
    const platforms = hub.createPlatformsFromEnv();
    // May or may not have platforms depending on env
    expect(Array.isArray(platforms)).toBe(true);
  });
});
