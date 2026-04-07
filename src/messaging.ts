/**
 * Messaging platform integrations - Telegram, Discord, Slack, WhatsApp
 * Real implementations using HTTP APIs via axios
 */

import axios, { AxiosInstance } from 'axios';
import { MessagingPlatform, ChatMessage, ChatResponse } from './types';
import { getLogger } from './logger';

const logger = getLogger();

type MessageHandler = (msg: ChatMessage) => ChatResponse | null | Promise<ChatResponse | null>;

/** Split long text into chunks respecting word boundaries */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }
  return chunks;
}

/** Delay helper for backoff */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    if (!msg.content || msg.content.trim().length === 0) {
      logger.debug(`${this.platform}: ignoring empty message from ${msg.user_id}`);
      return null;
    }

    for (const handler of this.messageHandlers) {
      try {
        const response = await handler(msg);
        if (response) return response;
      } catch (error) {
        logger.error(`Handler error on ${this.platform}: ${error}`);
      }
    }
    return null;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(response: ChatResponse): Promise<void>;
}

/**
 * Telegram Bot - Uses Telegram Bot API via HTTP long polling
 * Requires: TELEGRAM_BOT_TOKEN from @BotFather
 */
export class TelegramBot extends BaseMessagingPlatform {
  private token: string;
  private allowedChats?: number[];
  private api: AxiosInstance;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastUpdateId: number = 0;

  constructor(token: string) {
    super(MessagingPlatform.TELEGRAM);
    this.token = token;
    this.api = axios.create({
      baseURL: `https://api.telegram.org/bot${token}`,
      timeout: 35000,
    });
  }

  allowChats(chatIds: number[]): void {
    this.allowedChats = chatIds;
  }

  async start(): Promise<void> {
    try {
      const me = await this.api.get('/getMe');
      logger.info(`Telegram bot started: @${me.data.result.username}`);
      this.running = true;
      this.poll();
    } catch (error: any) {
      logger.error(`Telegram start error: ${error.message}`);
    }
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const res = await this.api.get('/getUpdates', {
        params: { offset: this.lastUpdateId + 1, timeout: 30, allowed_updates: ['message'] },
        timeout: 35000,
      });

      const updates = res.data.result || [];
      for (const update of updates) {
        this.lastUpdateId = update.update_id;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        // Check allowed chats
        if (this.allowedChats && !this.allowedChats.includes(msg.chat.id)) {
          logger.warn(`Telegram: ignoring message from unauthorized chat ${msg.chat.id}`);
          continue;
        }

        const chatMsg: ChatMessage = {
          platform: MessagingPlatform.TELEGRAM,
          chat_id: String(msg.chat.id),
          user_id: String(msg.from?.id || ''),
          username: msg.from?.username || msg.from?.first_name || 'unknown',
          content: msg.text,
          timestamp: new Date(msg.date * 1000),
          metadata: {},
        };

        const response = await this.handleMessage(chatMsg);
        if (response) {
          await this.send(response);
        }
      }
    } catch (error: any) {
      if (!error.message?.includes('timeout')) {
        logger.error(`Telegram poll error: ${error.message}`);
      }
    }

    // Continue polling
    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), 500);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Telegram bot stopped');
  }

  async send(response: ChatResponse): Promise<void> {
    if (!response.content || !response.chat_id) {
      logger.warn('Telegram: send called with empty content or chat_id');
      return;
    }

    // Telegram max message length is 4096
    const chunks = splitMessage(response.content, 4096);
    for (const chunk of chunks) {
      try {
        await this.api.post('/sendMessage', {
          chat_id: response.chat_id,
          text: chunk,
          parse_mode: 'Markdown',
        });
      } catch (error: any) {
        // Retry without markdown if parse fails (error 400)
        try {
          await this.api.post('/sendMessage', {
            chat_id: response.chat_id,
            text: chunk,
          });
        } catch (retryError: any) {
          // Handle rate limit (429)
          if (retryError.response?.status === 429) {
            const retryAfter = retryError.response?.data?.parameters?.retry_after || 5;
            logger.warn(`Telegram rate limited, waiting ${retryAfter}s`);
            await delay(retryAfter * 1000);
            try {
              await this.api.post('/sendMessage', { chat_id: response.chat_id, text: chunk });
            } catch (e: any) {
              logger.error(`Telegram send error after rate limit retry: ${e.message}`);
            }
          } else {
            logger.error(`Telegram send error: ${retryError.message}`);
          }
        }
      }
      // Small delay between chunks to avoid rate limits
      if (chunks.length > 1) await delay(200);
    }
    logger.info(`Telegram: sent ${chunks.length} message(s) to ${response.chat_id}`);
  }
}

/**
 * Discord Bot - Uses Discord Gateway API for receiving, REST for sending
 * Requires: DISCORD_BOT_TOKEN from Discord Developer Portal
 */
export class DiscordBot extends BaseMessagingPlatform {
  private token: string;
  private api: AxiosInstance;
  private ws: any = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastSequence: number | null = null;
  private reconnectAttempts: number = 0;

  constructor(token: string) {
    super(MessagingPlatform.DISCORD);
    this.token = token;
    this.api = axios.create({
      baseURL: 'https://discord.com/api/v10',
      headers: { Authorization: `Bot ${token}` },
      timeout: 10000,
    });
  }

  async start(): Promise<void> {
    try {
      // Verify bot token
      const me = await this.api.get('/users/@me');
      logger.info(`Discord bot started: ${me.data.username}#${me.data.discriminator}`);
      this.running = true;

      // Connect to Discord Gateway via WebSocket
      this.connectGateway();
    } catch (error: any) {
      logger.error(`Discord start error: ${error.message}`);
    }
  }

  private connectGateway(): void {
    try {
      const WebSocket = require('ws');
      this.ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');

      this.ws.on('message', (data: any) => {
        const payload = JSON.parse(data.toString());
        this.handleGatewayEvent(payload);
      });

      this.ws.on('close', (code: number) => {
        logger.warn(`Discord gateway closed (code: ${code})`);
        if (this.running) {
          // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
          const backoff = Math.min(30000, 1000 * Math.pow(2, (this.reconnectAttempts || 0)));
          this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
          logger.info(`Discord: reconnecting in ${backoff / 1000}s (attempt ${this.reconnectAttempts})`);
          setTimeout(() => this.connectGateway(), backoff);
        }
      });

      this.ws.on('error', (err: any) => {
        logger.error(`Discord gateway error: ${err.message}`);
      });
    } catch (error: any) {
      logger.error(`Discord WebSocket error: ${error.message}`);
    }
  }

  private handleGatewayEvent(payload: any): void {
    if (payload.s) this.lastSequence = payload.s;

    switch (payload.op) {
      case 10: // Hello - start heartbeat
        const interval = payload.d.heartbeat_interval;
        this.heartbeatInterval = setInterval(() => {
          this.ws?.send(JSON.stringify({ op: 1, d: this.lastSequence }));
        }, interval);
        // Identify
        this.ws?.send(JSON.stringify({
          op: 2,
          d: {
            token: this.token,
            intents: 513, // GUILDS + GUILD_MESSAGES
            properties: { os: 'linux', browser: 'linguclaw', device: 'linguclaw' },
          },
        }));
        break;

      case 0: // Dispatch
        if (payload.t === 'MESSAGE_CREATE' && !payload.d.author?.bot) {
          const msg = payload.d;
          const chatMsg: ChatMessage = {
            platform: MessagingPlatform.DISCORD,
            chat_id: msg.channel_id,
            user_id: msg.author.id,
            username: msg.author.username,
            content: msg.content,
            timestamp: new Date(msg.timestamp),
            metadata: {},
          };
          this.handleMessage(chatMsg).then(response => {
            if (response) this.send(response);
          });
        }
        break;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.ws) this.ws.close();
    logger.info('Discord bot stopped');
  }

  async send(response: ChatResponse): Promise<void> {
    if (!response.content || !response.chat_id) {
      logger.warn('Discord: send called with empty content or chat_id');
      return;
    }

    // Discord max message length is 2000
    const chunks = splitMessage(response.content, 2000);
    for (const chunk of chunks) {
      try {
        await this.api.post(`/channels/${response.chat_id}/messages`, {
          content: chunk,
        });
      } catch (error: any) {
        // Handle rate limit (429)
        if (error.response?.status === 429) {
          const retryAfter = error.response?.data?.retry_after || 5;
          logger.warn(`Discord rate limited, waiting ${retryAfter}s`);
          await delay(retryAfter * 1000);
          try {
            await this.api.post(`/channels/${response.chat_id}/messages`, { content: chunk });
          } catch (e: any) {
            logger.error(`Discord send error after rate limit retry: ${e.message}`);
          }
        } else {
          logger.error(`Discord send error: ${error.message}`);
        }
      }
      if (chunks.length > 1) await delay(300);
    }
    logger.info(`Discord: sent ${chunks.length} message(s) to channel ${response.chat_id}`);
  }
}

/**
 * Slack Bot - Uses Slack Web API + Socket Mode for real-time events
 * Requires: SLACK_BOT_TOKEN (xoxb-...) and SLACK_APP_TOKEN (xapp-...)
 */
export class SlackBot extends BaseMessagingPlatform {
  private botToken: string;
  private appToken?: string;
  private api: AxiosInstance;
  private ws: any = null;

  constructor(botToken: string, appToken?: string) {
    super(MessagingPlatform.SLACK);
    this.botToken = botToken;
    this.appToken = appToken;
    this.api = axios.create({
      baseURL: 'https://slack.com/api',
      headers: { Authorization: `Bearer ${botToken}` },
      timeout: 10000,
    });
  }

  async start(): Promise<void> {
    try {
      const res = await this.api.post('/auth.test');
      if (!res.data.ok) throw new Error(res.data.error);
      logger.info(`Slack bot started: ${res.data.user} in ${res.data.team}`);
      this.running = true;

      // Connect Socket Mode if app token provided
      if (this.appToken) {
        this.connectSocketMode();
      }
    } catch (error: any) {
      logger.error(`Slack start error: ${error.message}`);
    }
  }

  private async connectSocketMode(): Promise<void> {
    try {
      const res = await axios.post('https://slack.com/api/apps.connections.open', null, {
        headers: { Authorization: `Bearer ${this.appToken}` },
      });
      if (!res.data.ok) throw new Error(res.data.error);

      const WebSocket = require('ws');
      this.ws = new WebSocket(res.data.url);

      this.ws.on('message', (data: any) => {
        const payload = JSON.parse(data.toString());
        if (payload.type === 'events_api' && payload.payload?.event?.type === 'message') {
          const event = payload.payload.event;
          if (event.subtype || event.bot_id) return; // Skip bot messages

          // Acknowledge the event
          this.ws?.send(JSON.stringify({ envelope_id: payload.envelope_id }));

          const chatMsg: ChatMessage = {
            platform: MessagingPlatform.SLACK,
            chat_id: event.channel,
            user_id: event.user,
            username: event.user,
            content: event.text,
            timestamp: new Date(parseFloat(event.ts) * 1000),
            metadata: {},
          };
          this.handleMessage(chatMsg).then(response => {
            if (response) this.send(response);
          });
        } else if (payload.type === 'hello') {
          logger.info('Slack Socket Mode connected');
        }
      });

      this.ws.on('close', () => {
        if (this.running) {
          setTimeout(() => this.connectSocketMode(), 5000);
        }
      });
    } catch (error: any) {
      logger.error(`Slack Socket Mode error: ${error.message}`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.ws) this.ws.close();
    logger.info('Slack bot stopped');
  }

  async send(response: ChatResponse): Promise<void> {
    if (!response.content || !response.chat_id) {
      logger.warn('Slack: send called with empty content or chat_id');
      return;
    }

    // Slack text limit is ~40000 but practical limit is lower for readability
    const chunks = splitMessage(response.content, 4000);
    for (const chunk of chunks) {
      try {
        const res = await this.api.post('/chat.postMessage', {
          channel: response.chat_id,
          text: chunk,
        });
        if (!res.data.ok) {
          // Handle rate limit
          if (res.data.error === 'ratelimited') {
            const retryAfter = parseInt(res.headers?.['retry-after'] || '5', 10);
            logger.warn(`Slack rate limited, waiting ${retryAfter}s`);
            await delay(retryAfter * 1000);
            await this.api.post('/chat.postMessage', { channel: response.chat_id, text: chunk });
          } else {
            throw new Error(res.data.error);
          }
        }
      } catch (error: any) {
        logger.error(`Slack send error: ${error.message}`);
      }
      if (chunks.length > 1) await delay(200);
    }
    logger.info(`Slack: sent ${chunks.length} message(s) to ${response.chat_id}`);
  }
}

/**
 * WhatsApp Bot - Uses Twilio API for sending/receiving messages
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 */
export class WhatsAppBot extends BaseMessagingPlatform {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;
  private api: AxiosInstance;

  constructor(accountSid?: string, authToken?: string, fromNumber?: string) {
    super(MessagingPlatform.WHATSAPP);
    this.accountSid = accountSid || process.env.TWILIO_ACCOUNT_SID || '';
    this.authToken = authToken || process.env.TWILIO_AUTH_TOKEN || '';
    this.fromNumber = fromNumber || process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
    this.api = axios.create({
      baseURL: `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}`,
      auth: { username: this.accountSid, password: this.authToken },
      timeout: 10000,
    });
  }

  async start(): Promise<void> {
    if (!this.accountSid || !this.authToken) {
      logger.warn('WhatsApp: Twilio credentials not configured');
      return;
    }

    try {
      // Verify credentials
      const res = await this.api.get('.json');
      logger.info(`WhatsApp (Twilio) started: ${res.data.friendly_name}`);
      this.running = true;
    } catch (error: any) {
      logger.error(`WhatsApp start error: ${error.message}`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info('WhatsApp bot stopped');
  }

  async send(response: ChatResponse): Promise<void> {
    if (!response.content || !response.chat_id) {
      logger.warn('WhatsApp: send called with empty content or chat_id');
      return;
    }

    // WhatsApp max is 65536 but practical limit is ~1600 per message
    const chunks = splitMessage(response.content, 1600);
    for (const chunk of chunks) {
      try {
        const toNumber = response.chat_id.startsWith('whatsapp:')
          ? response.chat_id
          : `whatsapp:${response.chat_id}`;

        const params = new URLSearchParams();
        params.append('To', toNumber);
        params.append('From', this.fromNumber);
        params.append('Body', chunk);

        await this.api.post('/Messages.json', params);
      } catch (error: any) {
        logger.error(`WhatsApp send error: ${error.message}`);
      }
      if (chunks.length > 1) await delay(500);
    }
    logger.info(`WhatsApp: sent ${chunks.length} message(s) to ${response.chat_id}`);
  }

  // Webhook handler for incoming messages (call from Express route)
  handleWebhook(body: Record<string, string>): ChatMessage | null {
    if (!body.Body || !body.From) return null;

    return {
      platform: MessagingPlatform.WHATSAPP,
      chat_id: body.From,
      user_id: body.From,
      username: body.ProfileName || body.From,
      content: body.Body,
      timestamp: new Date(),
      metadata: {},
    };
  }
}

/**
 * MessagingHub - Central manager for all messaging platforms
 */
export class MessagingHub {
  platforms: Map<MessagingPlatform, BaseMessagingPlatform>;
  private agentCallback?: MessageHandler;

  constructor() {
    this.platforms = new Map();
  }

  registerAgent(callback: MessageHandler): void {
    this.agentCallback = callback;
    // Register to existing platforms too
    for (const platform of this.platforms.values()) {
      platform.onMessage(callback);
    }
  }

  addPlatform(platform: BaseMessagingPlatform): void {
    this.platforms.set(platform.platform, platform);
    if (this.agentCallback) {
      platform.onMessage(this.agentCallback);
    }
  }

  async startAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.platforms.values()).map(p => p.start())
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.error(`Platform start failed: ${r.reason}`);
      }
    });
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.platforms.values()).map(p => p.stop())
    );
  }

  async sendToPlatform(platform: MessagingPlatform, response: ChatResponse): Promise<void> {
    const p = this.platforms.get(platform);
    if (p) {
      await p.send(response);
    } else {
      logger.warn(`Platform ${platform} not registered`);
    }
  }

  getStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    for (const [name, platform] of this.platforms) {
      status[name] = platform.running;
    }
    return status;
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
      platforms.push(new SlackBot(
        process.env.SLACK_BOT_TOKEN,
        process.env.SLACK_APP_TOKEN
      ));
      logger.info('Slack bot configured');
    }

    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      platforms.push(new WhatsAppBot());
      logger.info('WhatsApp (Twilio) configured');
    }

    return platforms;
  }
}

// Convenience functions
export function createTelegramBot(token: string, allowedChats?: number[]): TelegramBot {
  const bot = new TelegramBot(token);
  if (allowedChats) bot.allowChats(allowedChats);
  return bot;
}

export function createDiscordBot(token: string): DiscordBot {
  return new DiscordBot(token);
}

export function createSlackBot(botToken: string, appToken?: string): SlackBot {
  return new SlackBot(botToken, appToken);
}

export function createWhatsAppTwilio(): WhatsAppBot {
  return new WhatsAppBot();
}
