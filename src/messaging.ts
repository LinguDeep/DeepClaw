/**
 * Messaging platform integrations - Telegram, Discord, Slack, WhatsApp
 * TypeScript equivalent of Python messaging.py
 */

import { MessagingPlatform, ChatMessage, ChatResponse } from './types';
import { getLogger } from './logger';

const logger = getLogger();

type MessageHandler = (msg: ChatMessage) => ChatResponse | null | Promise<ChatResponse | null>;

export abstract class BaseMessagingPlatform {
  platform: MessagingPlatform;
  messageHandlers: MessageHandler[];
  running: boolean;

  constructor(platform: MessagingPlatform) {
    this.platform = platform;
    this.messageHandlers = [];
    this.running = false;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  protected async handleMessage(msg: ChatMessage): Promise<ChatResponse | null> {
    for (const handler of this.messageHandlers) {
      try {
        const response = await handler(msg);
        if (response) return response;
      } catch (error) {
        logger.error(`Handler error: ${error}`);
      }
    }
    return null;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(response: ChatResponse): Promise<void>;
}

export class TelegramBot extends BaseMessagingPlatform {
  private token: string;
  private allowedChats?: number[];

  constructor(token: string) {
    super(MessagingPlatform.TELEGRAM);
    this.token = token;
  }

  allowChats(chatIds: number[]): void {
    this.allowedChats = chatIds;
  }

  async start(): Promise<void> {
    try {
      // In real implementation, use node-telegram-bot-api
      logger.info('Telegram bot started (mock)');
      this.running = true;
    } catch (error) {
      logger.error(`Telegram error: ${error}`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info('Telegram bot stopped');
  }

  async send(response: ChatResponse): Promise<void> {
    logger.info(`Sending Telegram message to ${response.chat_id}: ${response.content.slice(0, 50)}...`);
  }
}

export class DiscordBot extends BaseMessagingPlatform {
  private token: string;

  constructor(token: string) {
    super(MessagingPlatform.DISCORD);
    this.token = token;
  }

  async start(): Promise<void> {
    try {
      // In real implementation, use discord.js
      logger.info('Discord bot started (mock)');
      this.running = true;
    } catch (error) {
      logger.error(`Discord error: ${error}`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info('Discord bot stopped');
  }

  async send(response: ChatResponse): Promise<void> {
    logger.info(`Sending Discord message to ${response.chat_id}: ${response.content.slice(0, 50)}...`);
  }
}

export class SlackBot extends BaseMessagingPlatform {
  private botToken: string;
  private signingSecret?: string;

  constructor(botToken: string, signingSecret?: string) {
    super(MessagingPlatform.SLACK);
    this.botToken = botToken;
    this.signingSecret = signingSecret;
  }

  async start(): Promise<void> {
    try {
      // In real implementation, use @slack/bolt
      logger.info('Slack bot started (mock)');
      this.running = true;
    } catch (error) {
      logger.error(`Slack error: ${error}`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info('Slack bot stopped');
  }

  async send(response: ChatResponse): Promise<void> {
    logger.info(`Sending Slack message to ${response.chat_id}: ${response.content.slice(0, 50)}...`);
  }
}

export class WhatsAppBot extends BaseMessagingPlatform {
  private method: string;

  constructor(method: string = 'twilio') {
    super(MessagingPlatform.WHATSAPP);
    this.method = method;
  }

  async start(): Promise<void> {
    if (this.method === 'twilio') {
      logger.info('WhatsApp (Twilio) client ready');
      this.running = true;
    } else {
      logger.error(`WhatsApp method '${this.method}' not supported`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info('WhatsApp stopped');
  }

  async send(response: ChatResponse): Promise<void> {
    logger.info(`Sending WhatsApp message to ${response.chat_id}: ${response.content.slice(0, 50)}...`);
  }
}

export class MessagingHub {
  platforms: Map<MessagingPlatform, BaseMessagingPlatform>;
  private agentCallback?: MessageHandler;

  constructor() {
    this.platforms = new Map();
  }

  registerAgent(callback: MessageHandler): void {
    this.agentCallback = callback;
  }

  addPlatform(platform: BaseMessagingPlatform): void {
    this.platforms.set(platform.platform, platform);

    // Register agent handler
    if (this.agentCallback) {
      platform.onMessage(this.agentCallback);
    }
  }

  async startAll(): Promise<void> {
    const promises = Array.from(this.platforms.values()).map(p => p.start());
    await Promise.all(promises);
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.platforms.values()).map(p => p.stop());
    await Promise.all(promises);
  }

  async sendToPlatform(platform: MessagingPlatform, response: ChatResponse): Promise<void> {
    const p = this.platforms.get(platform);
    if (p) {
      await p.send(response);
    }
  }

  createPlatformsFromEnv(): BaseMessagingPlatform[] {
    const platforms: BaseMessagingPlatform[] = [];

    if (process.env.TELEGRAM_BOT_TOKEN) {
      const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
      if (process.env.TELEGRAM_ALLOWED_CHATS) {
        bot.allowChats(process.env.TELEGRAM_ALLOWED_CHATS.split(',').map(Number));
      }
      platforms.push(bot);
      logger.info('Telegram bot configured');
    }

    if (process.env.DISCORD_BOT_TOKEN) {
      platforms.push(new DiscordBot(process.env.DISCORD_BOT_TOKEN));
      logger.info('Discord bot configured');
    }

    if (process.env.SLACK_BOT_TOKEN) {
      platforms.push(new SlackBot(process.env.SLACK_BOT_TOKEN, process.env.SLACK_SIGNING_SECRET));
      logger.info('Slack bot configured');
    }

    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      platforms.push(new WhatsAppBot('twilio'));
      logger.info('WhatsApp (Twilio) configured');
    }

    return platforms;
  }
}

// Convenience functions
export function createTelegramBot(token: string, allowedChats?: number[]): TelegramBot {
  const bot = new TelegramBot(token);
  if (allowedChats) {
    bot.allowChats(allowedChats);
  }
  return bot;
}

export function createDiscordBot(token: string): DiscordBot {
  return new DiscordBot(token);
}

export function createSlackBot(botToken: string, signingSecret?: string): SlackBot {
  return new SlackBot(botToken, signingSecret);
}

export function createWhatsAppTwilio(): WhatsAppBot {
  return new WhatsAppBot('twilio');
}
