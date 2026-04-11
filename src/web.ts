/**
 * Web UI server using Express
 * TypeScript equivalent of Python web.py
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Orchestrator } from './orchestrator';
import { SharedState, Message } from './types';
import { RAGMemory } from './memory';
import { LongTermMemory } from './longterm-memory';
import { ShellTool, FileSystemTool } from './tools';
import { BaseProvider, ProviderManager } from './multi-provider';
import { BrowserAutomation } from './browser';
import { TaskScheduler } from './scheduler';
import { getConfig, loadEnvConfig } from './config';
import { getLogger } from './logger';
import { InboxManager } from './inbox';
import { EmailReceiver } from './email-receiver';
import { MessagingHub, TelegramBot, DiscordBot, SlackBot, WhatsAppBot } from './messaging';
import { SemanticMemory, getSemanticMemory } from './semantic-memory';
import { WorkflowEngine, getWorkflowEngine } from './workflow-engine';

const logger = getLogger();

// Load config
loadEnvConfig();

interface TaskRequest {
  task: string;
  model?: string;
  max_steps?: number;
}

export class WebUIManager {
  projectRoot: string;
  host: string;
  port: number;
  app: express.Application;
  server: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  orchestrator: Orchestrator | null;
  connections: Set<WebSocket>;
  memory: LongTermMemory;
  scheduler: TaskScheduler;
  browser: BrowserAutomation;
  chatHistory: { role: string; content: string; timestamp: string }[];
  private providerManager: ProviderManager;
  inbox: InboxManager;
  emailReceiver: EmailReceiver;
  messagingHub: MessagingHub;
  semanticMemory: SemanticMemory;

  constructor(projectRoot: string, host: string = '0.0.0.0', port: number = 8080) {
    this.projectRoot = projectRoot;
    this.host = host;
    this.port = port;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.orchestrator = null;
    this.connections = new Set();
    this.memory = new LongTermMemory();
    this.scheduler = new TaskScheduler();
    this.browser = new BrowserAutomation();
    this.chatHistory = [];
    this.providerManager = new ProviderManager();
    this.inbox = new InboxManager(this.memory);
    this.emailReceiver = new EmailReceiver(this.inbox);
    this.messagingHub = new MessagingHub();
    this.semanticMemory = getSemanticMemory();
  }

  /**
   * Initialize and start the web server
   */
  async start(): Promise<void> {
    // Setup middleware
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'static')));

    // Setup routes
    this.setupRoutes();
    this.setupWebSocket();

    // Start email receivers if configured
    this.startEmailReceivers();

    // Start server
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        logger.info(`Web UI server started at http://${this.host}:${this.port}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', version: '0.3.0' });
    });

    // Get current state
    this.app.get('/api/state', (req: Request, res: Response) => {
      if (!this.orchestrator) {
        res.json({ running: false });
        return;
      }
      res.json({
        running: true,
        state: this.orchestrator.state,
      });
    });

    // Start new task
    this.app.post('/api/task', async (req: Request, res: Response) => {
      const body = req.body as TaskRequest;
      
      if (!body.task) {
        res.status(400).json({ error: 'Task required' });
        return;
      }

      try {
        // Initialize provider
        const manager = new ProviderManager();
        const provider = manager.createFromEnv();
        
        if (!provider) {
          res.status(500).json({ error: 'No LLM provider available' });
          return;
        }

        // Initialize tools
        const shell = new ShellTool(this.projectRoot);
        await shell.init();
        const fs = new FileSystemTool(this.projectRoot);
        const memory = new RAGMemory(this.projectRoot);
        await memory.init();

        // Create orchestrator
        this.orchestrator = new Orchestrator(
          provider,
          shell,
          fs,
          body.max_steps || 15
        );

        // Run task asynchronously
        this.runTask(body.task);

        res.json({ task_id: Date.now().toString(), status: 'started' });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Settings endpoints
    this.app.get('/api/settings', (_req: Request, res: Response) => {
      const config = getConfig();
      const cfg = config.get();
      const safeConfig = { ...cfg, llm: { ...cfg.llm, apiKey: cfg.llm.apiKey ? '***' : '' } };
      res.json(safeConfig);
    });

    this.app.post('/api/settings', (req: Request, res: Response) => {
      const config = getConfig();
      const settings = req.body;
      try {
        if (settings.llm) {
          if (!settings.llm.apiKey || settings.llm.apiKey === '***' || settings.llm.apiKey.trim() === '') {
            delete settings.llm.apiKey;
          }
          config.updateLLM(settings.llm);
        }
        if (settings.system) config.updateSystem(settings.system);
        if (settings.webui) config.updateWebUI(settings.webui);
        if (settings.user) config.updateUser(settings.user);
        res.json({ success: true });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    // ============ CHAT API ============
    // Helper: execute a messaging action from parsed JSON
    const execMessagingAction = async (action: any): Promise<{ success: boolean; message: string }> => {
      const platform = (action.platform || '').toLowerCase();
      try {
        if (platform === 'email') {
          const ints = loadIntegrations(); const cfg = ints['email'] || {};
          const host = cfg.host || process.env.EMAIL_HOST || 'smtp.gmail.com';
          const port = parseInt(cfg.port || process.env.EMAIL_PORT || '587', 10);
          const username = cfg.username || process.env.EMAIL_USERNAME;
          const password = cfg.password || process.env.EMAIL_PASSWORD;
          if (!username || !password) return { success: false, message: 'Email not configured. Go to Skills → Email → Configure.' };
          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: username, pass: password } });
          await transporter.sendMail({ from: `LinguClaw <${username}>`, to: action.to, subject: action.subject || 'Message from LinguClaw', text: action.body || '', html: action.body ? `<div style="font-family:sans-serif">${(action.body || '').replace(/\n/g, '<br>')}</div>` : '' });
          return { success: true, message: `✅ Email sent to ${action.to}` };
        } else if (platform === 'telegram') {
          const ints = loadIntegrations(); const cfg = ints['telegram'] || {};
          const token = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN;
          const chatId = action.chatId || cfg.chatId || process.env.TELEGRAM_CHAT_ID;
          if (!token) return { success: false, message: 'Telegram not configured.' };
          if (!chatId) return { success: false, message: 'Telegram Chat ID not set.' };
          const https = require('https');
          const pd = JSON.stringify({ chat_id: chatId, text: action.message || action.body, parse_mode: 'HTML' });
          const result: any = await new Promise((resolve, reject) => { const r = https.request({ hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pd) } }, (resp: any) => { let d = ''; resp.on('data', (c: any) => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } }); }); r.on('error', reject); r.write(pd); r.end(); });
          return result.ok ? { success: true, message: `✅ Telegram message sent` } : { success: false, message: 'Telegram error: ' + (result.description || 'unknown') };
        } else if (platform === 'discord') {
          const ints = loadIntegrations(); const cfg = ints['discord'] || {};
          const token = cfg.botToken || process.env.DISCORD_BOT_TOKEN;
          if (!token) return { success: false, message: 'Discord not configured.' };
          if (!action.channelId) return { success: false, message: 'Discord channelId required.' };
          const https = require('https');
          const pd = JSON.stringify({ content: action.message || action.body });
          const result: any = await new Promise((resolve, reject) => { const r = https.request({ hostname: 'discord.com', path: `/api/v10/channels/${action.channelId}/messages`, method: 'POST', headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pd) } }, (resp: any) => { let d = ''; resp.on('data', (c: any) => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); }); r.on('error', reject); r.write(pd); r.end(); });
          return result.id ? { success: true, message: `✅ Discord message sent` } : { success: false, message: 'Discord error: ' + (result.message || 'unknown') };
        } else if (platform === 'slack') {
          const ints = loadIntegrations(); const cfg = ints['slack'] || {};
          const token = cfg.botToken || process.env.SLACK_BOT_TOKEN;
          const channel = action.channel || cfg.channel || '#general';
          if (!token) return { success: false, message: 'Slack not configured.' };
          const https = require('https');
          const pd = JSON.stringify({ channel, text: action.message || action.body });
          const result: any = await new Promise((resolve, reject) => { const r = https.request({ hostname: 'slack.com', path: '/api/chat.postMessage', method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pd) } }, (resp: any) => { let d = ''; resp.on('data', (c: any) => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } }); }); r.on('error', reject); r.write(pd); r.end(); });
          return result.ok ? { success: true, message: `✅ Slack message sent to ${channel}` } : { success: false, message: 'Slack error: ' + (result.error || 'unknown') };
        } else if (platform === 'whatsapp') {
          const ints = loadIntegrations(); const cfg = ints['whatsapp'] || {};
          const sid = cfg.accountSid || process.env.TWILIO_ACCOUNT_SID;
          const authToken = cfg.authToken || process.env.TWILIO_AUTH_TOKEN;
          const from = cfg.phoneNumber || process.env.TWILIO_PHONE_NUMBER;
          if (!sid || !authToken || !from) return { success: false, message: 'WhatsApp not configured.' };
          if (!action.to) return { success: false, message: 'WhatsApp "to" phone number required.' };
          const https = require('https');
          const pd = `To=whatsapp:${action.to}&From=whatsapp:${from}&Body=${encodeURIComponent(action.message || action.body || '')}`;
          const auth = Buffer.from(`${sid}:${authToken}`).toString('base64');
          const result: any = await new Promise((resolve, reject) => { const r = https.request({ hostname: 'api.twilio.com', path: `/2010-04-01/Accounts/${sid}/Messages.json`, method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(pd) } }, (resp: any) => { let d = ''; resp.on('data', (c: any) => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); }); r.on('error', reject); r.write(pd); r.end(); });
          return result.sid ? { success: true, message: `✅ WhatsApp message sent to ${action.to}` } : { success: false, message: 'WhatsApp error: ' + (result.message || 'unknown') };
        }
        return { success: false, message: 'Unknown platform: ' + platform };
      } catch (e: any) { return { success: false, message: e.message }; }
    };

    this.app.post('/api/chat', async (req: Request, res: Response) => {
      const { message } = req.body;
      if (!message) { res.status(400).json({ error: 'message required' }); return; }
      try {
        const provider = this.providerManager.createFromEnv();
        if (!provider) { res.status(500).json({ error: 'No LLM provider configured. Go to Settings to add your API key.' }); return; }
        this.chatHistory.push({ role: 'user', content: message, timestamp: new Date().toISOString() });

        // Build context from both memory systems
        const recentMemories = this.memory.search(message, undefined, 5);
        const memCtx = recentMemories.length > 0 ? '\nRelevant memories: ' + recentMemories.map((m: any) => m.value).join('; ') : '';

        // Semantic memory: find related past conversations and knowledge
        const semanticResults = this.semanticMemory.search(message, 5, undefined, 0.1);
        const semanticCtx = semanticResults.length > 0
          ? '\n\nRelated knowledge from memory:\n' + semanticResults.map((r, i) => `${i + 1}. [${r.category}] ${r.content.substring(0, 200)}`).join('\n')
          : '';

        // Inbox context - show unread messages to AI
        const unreadMessages = this.inbox.getUnread();
        let inboxCtx = '';
        if (unreadMessages.length > 0) {
          inboxCtx = `\n\n📬 INBOX: You have ${unreadMessages.length} unread message(s).\nRecent unread:\n` + 
            unreadMessages.slice(0, 3).map((m: any, i: number) => 
              `${i + 1}. [${m.platform}] From: ${m.from} | Subject: ${m.subject || '(no subject)'} | Body: ${(m.body || '').substring(0, 100)}...`
            ).join('\n');
        } else {
          inboxCtx = '\n\n📬 INBOX: No unread messages.';
        }

        // Check which integrations are configured
        const ints = loadIntegrations();
        const available: string[] = [];
        if (ints['email'] && ints['email'].username) available.push('email');
        if (ints['telegram'] && ints['telegram'].botToken) available.push('telegram');
        if (ints['discord'] && ints['discord'].botToken) available.push('discord');
        if (ints['slack'] && ints['slack'].botToken) available.push('slack');
        if (ints['whatsapp'] && ints['whatsapp'].accountSid) available.push('whatsapp');

        const toolsInfo = available.length > 0 ? `\n\nYou have these messaging integrations configured: ${available.join(', ')}.\n\nMESSAGING RULES — follow these strictly:\n1. When the user asks to send a message, FIRST check what information is missing (to, subject, body for email; message for telegram, etc).\n2. If the user provides all details including body/content, use what they provided.\n3. If the user says things like "send an email to John about the meeting", generate a suitable email body content intelligently.\n4. Once you have ALL required info, show a PREVIEW of what will be sent. Format it clearly like:\n   📧 Email Preview:\n   To: user@example.com\n   Subject: Hello\n   Body: Your message text here\n\n   Then ask: "Should I send this?"\n5. When the user CONFIRMS (says yes, send it, go, gönder, tamam, etc), THEN respond with ONLY the JSON action object:\n   {"action":"send","platform":"email","to":"user@example.com","subject":"Hello","body":"Message text"}\n   {"action":"send","platform":"telegram","message":"Hello!"}\n   {"action":"send","platform":"discord","channelId":"123","message":"Hello!"}\n   {"action":"send","platform":"slack","channel":"#general","message":"Hello!"}\n   {"action":"send","platform":"whatsapp","to":"+1234567890","message":"Hello!"}\n6. The JSON must be the ONLY content in your response — no extra text.\n7. For everything else (questions, conversation), respond normally in natural language.` : '\n\nNo messaging integrations are configured yet. If the user asks to send messages, tell them to configure integrations in the Skills panel first.';

        const sysPrompt = 'You are LinguClaw 🦀, a powerful personal AI assistant. You can send emails, Telegram/Discord/Slack/WhatsApp messages, browse the web, manage files, schedule jobs, and more. Be helpful and conversational. When a user wants to send a message, always ask for missing details, show a preview, and wait for confirmation before sending.' + memCtx + semanticCtx + inboxCtx + toolsInfo;

        const messages: Message[] = [
          { role: 'system', content: sysPrompt },
          ...this.chatHistory.slice(-20).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ];
        const response = await provider.complete(messages, 0.7, 2048);
        if (response.error) { res.json({ reply: 'Error: ' + response.error }); return; }
        let reply = response.content || 'No response';

        // Check if the LLM returned a JSON action
        let actionExecuted = false;
        try {
          const trimmed = reply.trim();
          if (trimmed.startsWith('{') && trimmed.includes('"action"')) {
            const action = JSON.parse(trimmed);
            if (action.action === 'send' && action.platform) {
              const result = await execMessagingAction(action);
              // Build a detailed summary of what was sent
              let details = '';
              if (action.platform === 'email') {
                details = `\n\n📧 Email Details:\nTo: ${action.to}\nSubject: ${action.subject || 'Message from LinguClaw'}\nBody: ${action.body || '(empty)'}`;
              } else if (action.platform === 'telegram') {
                details = `\n\n📨 Telegram Message:\n${action.message || action.body}`;
              } else if (action.platform === 'discord') {
                details = `\n\n💬 Discord Message (Channel: ${action.channelId}):\n${action.message || action.body}`;
              } else if (action.platform === 'slack') {
                details = `\n\n💬 Slack Message (${action.channel || '#general'}):\n${action.message || action.body}`;
              } else if (action.platform === 'whatsapp') {
                details = `\n\n📱 WhatsApp Message (To: ${action.to}):\n${action.message || action.body}`;
              }
              reply = result.message + details;
              actionExecuted = true;
            }
          }
        } catch (parseErr: any) { logger.debug(`Chat reply JSON parse attempt: ${parseErr.message}`); }

        this.chatHistory.push({ role: 'assistant', content: reply, timestamp: new Date().toISOString() });

        // Auto-save important info to memory
        if (message.toLowerCase().includes('remember') || message.toLowerCase().includes('hatırla') || message.toLowerCase().includes('hatirla')) {
          this.memory.store('chat_' + Date.now(), message, 'chat');
        }

        // Save conversation turn to semantic memory for cross-session recall
        const turnId = `chat_${Date.now()}`;
        this.semanticMemory.store(turnId, `User: ${message}\nAssistant: ${reply.substring(0, 500)}`, 'conversation', {
          timestamp: new Date().toISOString(),
          actionExecuted,
        });

        res.json({ reply, model: response.model, actionExecuted });
      } catch (error: any) {
        res.json({ reply: 'Error: ' + error.message });
      }
    });

    // ============ STREAMING CHAT (SSE) ============
    this.app.post('/api/chat/stream', async (req: Request, res: Response) => {
      const { message } = req.body;
      if (!message) { res.status(400).json({ error: 'message required' }); return; }

      try {
        const provider = this.providerManager.createFromEnv();
        if (!provider) { res.status(500).json({ error: 'No LLM provider configured.' }); return; }

        this.chatHistory.push({ role: 'user', content: message, timestamp: new Date().toISOString() });

        // Build context (same as non-streaming)
        const recentMemories = this.memory.search(message, undefined, 5);
        const memCtx = recentMemories.length > 0 ? '\nRelevant memories: ' + recentMemories.map((m: any) => m.value).join('; ') : '';
        const semanticResults = this.semanticMemory.search(message, 5, undefined, 0.1);
        const semanticCtx = semanticResults.length > 0
          ? '\n\nRelated knowledge from memory:\n' + semanticResults.map((r, i) => `${i + 1}. [${r.category}] ${r.content.substring(0, 200)}`).join('\n')
          : '';
        const unreadMessages = this.inbox.getUnread();
        const inboxCtx = unreadMessages.length > 0
          ? `\n\n📬 INBOX: ${unreadMessages.length} unread.`
          : '\n\n📬 INBOX: No unread messages.';

        const sysPrompt = 'You are LinguClaw 🦀, a powerful personal AI assistant. Be helpful and conversational.' + memCtx + semanticCtx + inboxCtx;

        const messages: Message[] = [
          { role: 'system', content: sysPrompt },
          ...this.chatHistory.slice(-20).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ];

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        let fullReply = '';

        try {
          for await (const chunk of provider.stream(messages, 0.7, 2048)) {
            fullReply += chunk;
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        } catch (streamErr: any) {
          // If streaming fails, fall back to complete
          logger.warn(`Streaming failed, falling back: ${streamErr.message}`);
          const response = await provider.complete(messages, 0.7, 2048);
          fullReply = response.content || '';
          res.write(`data: ${JSON.stringify({ chunk: fullReply })}\n\n`);
        }

        // Send done event
        res.write(`data: ${JSON.stringify({ done: true, model: provider.model })}\n\n`);
        res.end();

        // Save to history and semantic memory
        this.chatHistory.push({ role: 'assistant', content: fullReply, timestamp: new Date().toISOString() });
        this.semanticMemory.store(`chat_${Date.now()}`, `User: ${message}\nAssistant: ${fullReply.substring(0, 500)}`, 'conversation', {
          timestamp: new Date().toISOString(),
        });

        if (message.toLowerCase().includes('remember') || message.toLowerCase().includes('hatırla') || message.toLowerCase().includes('hatirla')) {
          this.memory.store('chat_' + Date.now(), message, 'chat');
        }
      } catch (error: any) {
        if (!res.headersSent) {
          res.status(500).json({ error: error.message });
        } else {
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        }
      }
    });

    this.app.get('/api/chat/history', (_req: Request, res: Response) => {
      res.json(this.chatHistory.slice(-100));
    });

    this.app.delete('/api/chat/history', (_req: Request, res: Response) => {
      this.chatHistory = [];
      res.json({ success: true });
    });

    // ============ MEMORY API ============
    this.app.get('/api/memory', (_req: Request, res: Response) => {
      try {
        const stats = this.memory.getStats();
        const all = this.memory.search('', undefined, 100);
        res.json({ entries: all, stats });
      } catch (e: any) { res.json([]); }
    });

    this.app.post('/api/memory', (req: Request, res: Response) => {
      const { key, value, category, tags } = req.body;
      if (!key || !value) { res.status(400).json({ error: 'key and value required' }); return; }
      try {
        this.memory.store(key, value, category || 'general', tags || []);
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    this.app.delete('/api/memory/:key', (req: Request, res: Response) => {
      try {
        this.memory.delete(req.params.key);
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // ============ SCHEDULER API ============
    this.app.get('/api/scheduler/jobs', (_req: Request, res: Response) => {
      res.json(this.scheduler.getJobs());
    });

    this.app.post('/api/scheduler/jobs', (req: Request, res: Response) => {
      const { name, type, schedule, command, tags } = req.body;
      if (!name || !type || !schedule || !command) {
        res.status(400).json({ error: 'name, type, schedule, command required' }); return;
      }
      const job = this.scheduler.addJob({ name, type, schedule, command, enabled: true, tags: tags || [] });
      res.json(job);
    });

    this.app.delete('/api/scheduler/jobs/:id', (req: Request, res: Response) => {
      const ok = this.scheduler.removeJob(req.params.id);
      res.json({ success: ok });
    });

    this.app.post('/api/scheduler/jobs/:id/toggle', (req: Request, res: Response) => {
      const job = this.scheduler.toggleJob(req.params.id);
      res.json(job || { error: 'Job not found' });
    });

    this.app.get('/api/scheduler/results', (_req: Request, res: Response) => {
      res.json(this.scheduler.getResults());
    });

    // ============ BROWSER API ============
    this.app.post('/api/browser/browse', async (req: Request, res: Response) => {
      const { url } = req.body;
      if (!url) { res.status(400).json({ error: 'url required' }); return; }
      if (!this.browser.isAvailable) await this.browser.init();
      const result = await this.browser.browse(url);
      res.json(result);
    });

    this.app.post('/api/browser/screenshot', async (req: Request, res: Response) => {
      const { url } = req.body;
      if (!this.browser.isAvailable) await this.browser.init();
      const result = await this.browser.screenshot(url);
      res.json(result);
    });

    this.app.post('/api/browser/extract', async (req: Request, res: Response) => {
      const { selector } = req.body;
      if (!selector) { res.status(400).json({ error: 'selector required' }); return; }
      const result = await this.browser.extract(selector);
      res.json(result);
    });

    // AI-powered browser helpers
    const getBrowserPageContent = async (): Promise<{ content: string; title: string; url: string } | null> => {
      if (!this.browser.isAvailable) return null;
      try {
        const result = await this.browser.evaluate('(() => { const b = document.body; if (!b) return ""; const c = b.cloneNode(true); c.querySelectorAll("script,style,noscript,svg,img").forEach(e => e.remove()); return c.innerText.substring(0, 8000); })()');
        const title = await this.browser.evaluate('document.title');
        const url = await this.browser.evaluate('window.location.href');
        return { content: result.data || '', title: title.data || '', url: url.data || '' };
      } catch (err: any) { logger.warn(`getBrowserPageContent error: ${err.message}`); return null; }
    };

    this.app.post('/api/browser/summarize', async (req: Request, res: Response) => {
      try {
        const provider = this.providerManager.createFromEnv();
        if (!provider) { res.status(500).json({ error: 'No LLM provider configured' }); return; }
        const page = await getBrowserPageContent();
        if (!page || !page.content) { res.status(400).json({ error: 'No page loaded. Browse a URL first.' }); return; }
        const lang = req.body.language || 'English';
        const messages: Message[] = [
          { role: 'system', content: 'You are a helpful assistant that summarizes web pages clearly and concisely.' },
          { role: 'user', content: `Summarize the following web page in ${lang}. Include key points, main topic, and any important details.\n\nPage title: ${page.title}\nURL: ${page.url}\n\nContent:\n${page.content}` }
        ];
        const response = await provider.complete(messages, 0.3, 1500);
        res.json({ success: true, summary: response.content || 'No summary generated', title: page.title, url: page.url, model: response.model });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/browser/ask', async (req: Request, res: Response) => {
      const { question } = req.body;
      if (!question) { res.status(400).json({ error: 'question required' }); return; }
      try {
        const provider = this.providerManager.createFromEnv();
        if (!provider) { res.status(500).json({ error: 'No LLM provider configured' }); return; }
        const page = await getBrowserPageContent();
        if (!page || !page.content) { res.status(400).json({ error: 'No page loaded. Browse a URL first.' }); return; }
        const messages: Message[] = [
          { role: 'system', content: 'You are a helpful assistant. Answer questions about the given web page content accurately and concisely. If the answer is not in the content, say so.' },
          { role: 'user', content: `Page: ${page.title} (${page.url})\n\nContent:\n${page.content}\n\n---\nQuestion: ${question}` }
        ];
        const response = await provider.complete(messages, 0.3, 1500);
        res.json({ success: true, answer: response.content || 'No answer generated', question, title: page.title, model: response.model });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/browser/smart-extract', async (req: Request, res: Response) => {
      const { prompt } = req.body;
      if (!prompt) { res.status(400).json({ error: 'prompt required (e.g. "extract all prices", "find email addresses")' }); return; }
      try {
        const provider = this.providerManager.createFromEnv();
        if (!provider) { res.status(500).json({ error: 'No LLM provider configured' }); return; }
        const page = await getBrowserPageContent();
        if (!page || !page.content) { res.status(400).json({ error: 'No page loaded. Browse a URL first.' }); return; }
        const messages: Message[] = [
          { role: 'system', content: 'You are a data extraction assistant. Extract the requested data from the web page content. Return the data in a clean, structured format. Use JSON when appropriate.' },
          { role: 'user', content: `Extract from this page: ${prompt}\n\nPage: ${page.title} (${page.url})\n\nContent:\n${page.content}` }
        ];
        const response = await provider.complete(messages, 0.2, 2000);
        res.json({ success: true, extracted: response.content || 'Nothing extracted', prompt, title: page.title, model: response.model });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/browser/search', async (req: Request, res: Response) => {
      const { query } = req.body;
      if (!query) { res.status(400).json({ error: 'query required' }); return; }
      try {
        if (!this.browser.isAvailable) await this.browser.init();
        const searchUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
        const result = await this.browser.browse(searchUrl);
        if (!result.success) { res.json(result); return; }
        const provider = this.providerManager.createFromEnv();
        if (provider && result.content) {
          const messages: Message[] = [
            { role: 'system', content: 'You are a helpful search assistant. Based on the search results below, provide a clear, informative answer to the user\'s query. Cite relevant sources when possible.' },
            { role: 'user', content: `Search query: ${query}\n\nSearch results:\n${result.content}` }
          ];
          const response = await provider.complete(messages, 0.4, 1500);
          res.json({ success: true, query, answer: response.content, rawContent: result.content, links: result.links, model: response.model });
        } else {
          res.json({ success: true, query, rawContent: result.content, links: result.links });
        }
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // ============ SYSTEM STATUS API ============
    this.app.get('/api/system/status', (_req: Request, res: Response) => {
      const config = getConfig();
      const cfg = config.get();
      res.json({
        version: cfg.version || '0.3.0',
        provider: cfg.llm.provider,
        model: cfg.llm.model,
        hasApiKey: !!(cfg.llm.apiKey && cfg.llm.apiKey.length > 0),
        scheduler: { jobs: this.scheduler.getJobs().length, running: true },
        browser: { available: this.browser.isAvailable },
        memory: { entries: this.memory.getStats().total_entries },
        chat: { messages: this.chatHistory.length },
        connections: this.connections.size,
        uptime: process.uptime(),
      });
    });

    // ============ SKILLS API ============
    const integrationsPath = path.join(require('os').homedir(), '.linguclaw', 'integrations.json');
    const loadIntegrations = (): Record<string, Record<string, string>> => {
      try { return JSON.parse(require('fs').readFileSync(integrationsPath, 'utf8')); } catch (e: any) { logger.debug(`loadIntegrations: ${e.message}`); return {}; }
    };
    const saveIntegrations = (data: Record<string, Record<string, string>>) => {
      const dir = path.dirname(integrationsPath);
      if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
      require('fs').writeFileSync(integrationsPath, JSON.stringify(data, null, 2));
    };
    const isIntEnabled = (name: string, envKey: string): boolean => {
      const ints = loadIntegrations();
      return !!(process.env[envKey] || (ints[name] && Object.values(ints[name]).some(v => v && v.length > 0)));
    };

    this.app.get('/api/skills', (_req: Request, res: Response) => {
      res.json([
        // Built-in skills
        { name: 'shell', description: 'Execute shell commands', type: 'builtin', enabled: true, category: 'system' },
        { name: 'filesystem', description: 'Read/write files', type: 'builtin', enabled: true, category: 'system' },
        { name: 'browser', description: 'Browse websites & extract data', type: 'builtin', enabled: this.browser.isAvailable, category: 'system' },
        { name: 'scheduler', description: 'Schedule background tasks', type: 'builtin', enabled: true, category: 'system' },
        { name: 'memory', description: 'Persistent memory storage', type: 'builtin', enabled: true, category: 'system' },
        { name: 'inbox', description: 'Track and reply to messages', type: 'builtin', enabled: true, category: 'system' },
        
        // Messaging - Mainstream
        { name: 'email', description: 'Send/receive emails via IMAP', type: 'integration', enabled: isIntEnabled('email', 'EMAIL_USERNAME'), category: 'messaging',
          configFields: [
            { key: 'host', label: 'IMAP Host', placeholder: 'imap.gmail.com' },
            { key: 'port', label: 'IMAP Port', placeholder: '993' },
            { key: 'username', label: 'Email', placeholder: 'you@gmail.com' },
            { key: 'password', label: 'App Password', placeholder: '••••••••', secret: true },
            { key: 'folders', label: 'Folders to Monitor', placeholder: 'INBOX, Sent, Drafts, Trash' },
            { key: 'useIdle', label: 'Real-time IDLE', placeholder: 'true' },
            { key: 'pollInterval', label: 'Poll Interval (minutes)', placeholder: '1' },
          ]},
        { name: 'telegram', description: 'Telegram bot integration', type: 'integration', enabled: isIntEnabled('telegram', 'TELEGRAM_BOT_TOKEN'), category: 'messaging',
          configFields: [
            { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...', secret: true },
            { key: 'chatId', label: 'Chat ID (optional)', placeholder: '123456789' },
          ]},
        { name: 'discord', description: 'Discord bot integration', type: 'integration', enabled: isIntEnabled('discord', 'DISCORD_BOT_TOKEN'), category: 'messaging',
          configFields: [
            { key: 'botToken', label: 'Bot Token', placeholder: 'MTIz...', secret: true },
            { key: 'guildId', label: 'Server ID (optional)', placeholder: '123456789' },
          ]},
        { name: 'slack', description: 'Slack bot integration', type: 'integration', enabled: isIntEnabled('slack', 'SLACK_BOT_TOKEN'), category: 'messaging',
          configFields: [
            { key: 'botToken', label: 'Bot Token', placeholder: 'xoxb-...', secret: true },
            { key: 'channel', label: 'Channel', placeholder: '#general' },
          ]},
        { name: 'whatsapp', description: 'WhatsApp via Twilio', type: 'integration', enabled: isIntEnabled('whatsapp', 'TWILIO_ACCOUNT_SID'), category: 'messaging',
          configFields: [
            { key: 'accountSid', label: 'Account SID', placeholder: 'AC...', secret: true },
            { key: 'authToken', label: 'Auth Token', placeholder: '••••••••', secret: true },
            { key: 'phoneNumber', label: 'Twilio Phone', placeholder: '+1234567890' },
          ]},
        
        // Messaging - Privacy & Enterprise
        { name: 'signal', description: 'Signal via signal-cli', type: 'integration', enabled: isIntEnabled('signal', 'SIGNAL_CLI_PATH'), category: 'messaging',
          configFields: [
            { key: 'cliPath', label: 'signal-cli Path', placeholder: '/usr/bin/signal-cli' },
            { key: 'phoneNumber', label: 'Your Phone Number', placeholder: '+1234567890' },
          ]},
        { name: 'imessage', description: 'iMessage via BlueBubbles', type: 'integration', enabled: isIntEnabled('imessage', 'BLUEBUBBLES_URL'), category: 'messaging',
          configFields: [
            { key: 'url', label: 'BlueBubbles URL', placeholder: 'http://localhost:1234' },
            { key: 'password', label: 'Password', placeholder: '••••••••', secret: true },
          ]},
        { name: 'teams', description: 'Microsoft Teams integration', type: 'integration', enabled: isIntEnabled('teams', 'MS_TEAMS_WEBHOOK'), category: 'messaging',
          configFields: [
            { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://outlook.office.com/webhook/...', secret: true },
            { key: 'tenantId', label: 'Tenant ID (optional)', placeholder: '...' },
          ]},
        { name: 'matrix', description: 'Matrix protocol integration', type: 'integration', enabled: isIntEnabled('matrix', 'MATRIX_HOMESERVER'), category: 'messaging',
          configFields: [
            { key: 'homeserver', label: 'Homeserver URL', placeholder: 'https://matrix.org' },
            { key: 'userId', label: 'User ID', placeholder: '@user:matrix.org' },
            { key: 'accessToken', label: 'Access Token', placeholder: '••••••••', secret: true },
          ]},
        { name: 'nostr', description: 'Nostr NIP-04 messages', type: 'integration', enabled: isIntEnabled('nostr', 'NOSTR_PRIVATE_KEY'), category: 'messaging',
          configFields: [
            { key: 'privateKey', label: 'Private Key (nsec)', placeholder: 'nsec1...', secret: true },
            { key: 'relay', label: 'Relay URL', placeholder: 'wss://relay.damus.io' },
          ]},
        { name: 'zalo', description: 'Zalo bot integration', type: 'integration', enabled: isIntEnabled('zalo', 'ZALO_APP_ID'), category: 'messaging',
          configFields: [
            { key: 'appId', label: 'App ID', placeholder: '123456' },
            { key: 'appSecret', label: 'App Secret', placeholder: '••••••••', secret: true },
            { key: 'accessToken', label: 'Access Token', placeholder: '••••••••', secret: true },
          ]},
        
        // AI Models - Cloud
        { name: 'openai', description: 'OpenAI GPT-4, o1, GPT-5', type: 'integration', enabled: isIntEnabled('openai', 'OPENAI_API_KEY'), category: 'ai',
          configFields: [
            { key: 'apiKey', label: 'API Key', placeholder: 'sk-...', secret: true },
            { key: 'model', label: 'Model', placeholder: 'gpt-4o' },
          ]},
        { name: 'anthropic', description: 'Anthropic Claude 3.5/4', type: 'integration', enabled: isIntEnabled('anthropic', 'ANTHROPIC_API_KEY'), category: 'ai',
          configFields: [
            { key: 'apiKey', label: 'API Key', placeholder: 'sk-ant-...', secret: true },
            { key: 'model', label: 'Model', placeholder: 'claude-3-5-sonnet' },
          ]},
        { name: 'google', description: 'Google Gemini 1.5/2.5', type: 'integration', enabled: isIntEnabled('google', 'GOOGLE_API_KEY'), category: 'ai',
          configFields: [
            { key: 'apiKey', label: 'API Key', placeholder: 'AIza...', secret: true },
            { key: 'model', label: 'Model', placeholder: 'gemini-1.5-pro' },
          ]},
        { name: 'xai', description: 'xAI Grok', type: 'integration', enabled: isIntEnabled('xai', 'XAI_API_KEY'), category: 'ai',
          configFields: [
            { key: 'apiKey', label: 'API Key', placeholder: 'xai-...', secret: true },
            { key: 'model', label: 'Model', placeholder: 'grok-2' },
          ]},
        { name: 'mistral', description: 'Mistral AI models', type: 'integration', enabled: isIntEnabled('mistral', 'MISTRAL_API_KEY'), category: 'ai',
          configFields: [
            { key: 'apiKey', label: 'API Key', placeholder: '••••••••', secret: true },
            { key: 'model', label: 'Model', placeholder: 'mistral-large' },
          ]},
        { name: 'deepseek', description: 'DeepSeek V3 & R1', type: 'integration', enabled: isIntEnabled('deepseek', 'DEEPSEEK_API_KEY'), category: 'ai',
          configFields: [
            { key: 'apiKey', label: 'API Key', placeholder: 'sk-...', secret: true },
            { key: 'model', label: 'Model', placeholder: 'deepseek-chat' },
          ]},
        { name: 'perplexity', description: 'Perplexity Search-augmented', type: 'integration', enabled: isIntEnabled('perplexity', 'PERPLEXITY_API_KEY'), category: 'ai',
          configFields: [
            { key: 'apiKey', label: 'API Key', placeholder: 'pplx-...', secret: true },
            { key: 'model', label: 'Model', placeholder: 'sonar' },
          ]},
        
        // AI Local
        { name: 'ollama', description: 'Ollama local models', type: 'integration', enabled: isIntEnabled('ollama', 'OLLAMA_URL'), category: 'ai',
          configFields: [
            { key: 'url', label: 'Ollama URL', placeholder: 'http://localhost:11434' },
            { key: 'model', label: 'Model', placeholder: 'llama3.1' },
          ]},
        { name: 'lmstudio', description: 'LM Studio local models', type: 'integration', enabled: isIntEnabled('lmstudio', 'LMSTUDIO_URL'), category: 'ai',
          configFields: [
            { key: 'url', label: 'LM Studio URL', placeholder: 'http://localhost:1234' },
            { key: 'model', label: 'Model', placeholder: 'local-model' },
          ]},
        
        // Productivity & Workspace
        { name: 'notion', description: 'Notion pages & databases', type: 'integration', enabled: isIntEnabled('notion', 'NOTION_TOKEN'), category: 'productivity',
          configFields: [
            { key: 'token', label: 'Integration Token', placeholder: 'secret_...', secret: true },
            { key: 'databaseId', label: 'Database ID (optional)', placeholder: '...' },
          ]},
        { name: 'trello', description: 'Trello boards & cards', type: 'integration', enabled: isIntEnabled('trello', 'TRELLO_API_KEY'), category: 'productivity',
          configFields: [
            { key: 'apiKey', label: 'API Key', placeholder: '••••••••', secret: true },
            { key: 'token', label: 'Token', placeholder: '••••••••', secret: true },
            { key: 'boardId', label: 'Board ID', placeholder: '...' },
          ]},
        { name: 'github', description: 'GitHub repos, issues, PRs', type: 'integration', enabled: isIntEnabled('github', 'GITHUB_TOKEN'), category: 'productivity',
          configFields: [
            { key: 'token', label: 'Personal Access Token', placeholder: 'ghp_...', secret: true },
            { key: 'owner', label: 'Default Owner', placeholder: 'username' },
            { key: 'repo', label: 'Default Repo', placeholder: 'repo-name' },
          ]},
        { name: 'obsidian', description: 'Obsidian vault access', type: 'integration', enabled: isIntEnabled('obsidian', 'OBSIDIAN_VAULT_PATH'), category: 'productivity',
          configFields: [
            { key: 'vaultPath', label: 'Vault Path', placeholder: '/home/user/Obsidian' },
          ]},
        { name: 'apple-notes', description: 'Apple Notes (macOS)', type: 'integration', enabled: isIntEnabled('apple-notes', 'APPLE_NOTES_ENABLED'), category: 'productivity',
          configFields: [
            { key: 'enabled', label: 'Enabled', placeholder: 'true' },
          ]},
        
        // Smart Home & Media
        { name: 'home-assistant', description: 'Home Assistant hub', type: 'integration', enabled: isIntEnabled('home-assistant', 'HASS_URL'), category: 'smart-home',
          configFields: [
            { key: 'url', label: 'Home Assistant URL', placeholder: 'http://homeassistant:8123' },
            { key: 'token', label: 'Long-Lived Access Token', placeholder: '••••••••', secret: true },
          ]},
        { name: 'hue', description: 'Philips Hue lighting', type: 'integration', enabled: isIntEnabled('hue', 'HUE_BRIDGE_IP'), category: 'smart-home',
          configFields: [
            { key: 'bridgeIp', label: 'Bridge IP', placeholder: '192.168.1.100' },
            { key: 'username', label: 'API Key', placeholder: '••••••••', secret: true },
          ]},
        { name: 'spotify', description: 'Spotify control', type: 'integration', enabled: isIntEnabled('spotify', 'SPOTIFY_CLIENT_ID'), category: 'smart-home',
          configFields: [
            { key: 'clientId', label: 'Client ID', placeholder: '...' },
            { key: 'clientSecret', label: 'Client Secret', placeholder: '••••••••', secret: true },
            { key: 'refreshToken', label: 'Refresh Token', placeholder: '••••••••', secret: true },
          ]},
        { name: 'sonos', description: 'Sonos multi-room audio', type: 'integration', enabled: isIntEnabled('sonos', 'SONOS_IP'), category: 'smart-home',
          configFields: [
            { key: 'ip', label: 'Speaker IP', placeholder: '192.168.1.101' },
          ]},
        
        // Utilities
        { name: 'weather', description: 'Weather forecasts', type: 'integration', enabled: isIntEnabled('weather', 'OPENWEATHER_API_KEY'), category: 'utility',
          configFields: [
            { key: 'apiKey', label: 'OpenWeather API Key', placeholder: '••••••••', secret: true },
            { key: 'city', label: 'Default City', placeholder: 'London' },
          ]},
        { name: 'webhooks', description: 'HTTP webhook triggers', type: 'integration', enabled: isIntEnabled('webhooks', 'WEBHOOK_SECRET'), category: 'utility',
          configFields: [
            { key: 'secret', label: 'Webhook Secret', placeholder: '••••••••', secret: true },
            { key: 'port', label: 'Port', placeholder: '8081' },
          ]},
        { name: 'image-gen', description: 'AI Image Generation', type: 'integration', enabled: isIntEnabled('image-gen', 'IMAGE_API_KEY'), category: 'utility',
          configFields: [
            { key: 'provider', label: 'Provider', placeholder: 'openai, stability, replicate' },
            { key: 'apiKey', label: 'API Key', placeholder: '••••••••', secret: true },
          ]},
        { name: '1password', description: '1Password secrets', type: 'integration', enabled: isIntEnabled('1password', 'OP_SERVICE_ACCOUNT_TOKEN'), category: 'utility',
          configFields: [
            { key: 'serviceAccountToken', label: 'Service Account Token', placeholder: 'ops_...', secret: true },
            { key: 'vault', label: 'Vault Name', placeholder: 'Private' },
          ]},
        { name: 'gmail', description: 'Gmail Pub/Sub triggers', type: 'integration', enabled: isIntEnabled('gmail', 'GMAIL_REFRESH_TOKEN'), category: 'utility',
          configFields: [
            { key: 'clientId', label: 'Client ID', placeholder: '...' },
            { key: 'clientSecret', label: 'Client Secret', placeholder: '••••••••', secret: true },
            { key: 'refreshToken', label: 'Refresh Token', placeholder: '••••••••', secret: true },
          ]},
      ]);
    });

    this.app.get('/api/skills/config/:name', (req: Request, res: Response) => {
      const ints = loadIntegrations();
      const cfg = ints[req.params.name] || {};
      // Mask secret values
      const masked: Record<string, string> = {};
      for (const [k, v] of Object.entries(cfg)) {
        masked[k] = v && v.length > 4 ? v.substring(0, 3) + '•'.repeat(v.length - 3) : v ? '••••' : '';
      }
      res.json({ name: req.params.name, config: masked, hasConfig: Object.keys(cfg).length > 0 });
    });

    this.app.post('/api/skills/config/:name', (req: Request, res: Response) => {
      try {
        const ints = loadIntegrations();
        const existing = ints[req.params.name] || {};
        const incoming = req.body.config || {};
        // Only overwrite non-empty values (preserve existing if field left empty)
        for (const [k, v] of Object.entries(incoming) as [string, string][]) {
          if (v && v.length > 0 && !v.includes('•')) existing[k] = v;
        }
        ints[req.params.name] = existing;
        saveIntegrations(ints);
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    this.app.delete('/api/skills/config/:name', (req: Request, res: Response) => {
      try {
        const ints = loadIntegrations();
        delete ints[req.params.name];
        saveIntegrations(ints);
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // ============ DIRECT EMAIL API ============
    this.app.post('/api/email/send', async (req: Request, res: Response) => {
      try {
        const { to, subject, body } = req.body;
        if (!to || !subject) { res.status(400).json({ error: 'to and subject are required' }); return; }
        const ints = loadIntegrations();
        const cfg = ints['email'] || {};
        const host = cfg.host || process.env.EMAIL_HOST || 'smtp.gmail.com';
        const port = parseInt(cfg.port || process.env.EMAIL_PORT || '587', 10);
        const username = cfg.username || process.env.EMAIL_USERNAME;
        const password = cfg.password || process.env.EMAIL_PASSWORD;
        if (!username || !password) { res.status(400).json({ error: 'Email not configured. Go to Skills → Email → Configure first.' }); return; }
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: username, pass: password } });
        await transporter.sendMail({
          from: `LinguClaw <${username}>`,
          to,
          subject,
          text: body || '',
          html: body ? `<div style="font-family:sans-serif;line-height:1.6">${body.replace(/\n/g, '<br>')}</div>` : ''
        });
        res.json({ success: true, message: `Email sent to ${to}` });
      } catch (e: any) {
        const msg = e.message || '';
        let hint = '';
        if (msg.includes('EAUTH') || msg.includes('Invalid login')) hint = ' — Check credentials. For Gmail use App Password.';
        else if (msg.includes('ECONNREFUSED')) hint = ' — Cannot connect to SMTP server.';
        res.status(500).json({ error: 'Send failed: ' + msg + hint });
      }
    });

    // ============ TELEGRAM API ============
    this.app.post('/api/telegram/send', async (req: Request, res: Response) => {
      try {
        const { chatId, message } = req.body;
        if (!message) { res.status(400).json({ error: 'message required' }); return; }
        const ints = loadIntegrations();
        const cfg = ints['telegram'] || {};
        const token = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN;
        const target = chatId || cfg.chatId || process.env.TELEGRAM_CHAT_ID;
        if (!token) { res.status(400).json({ error: 'Telegram not configured. Go to Skills → Telegram → Configure.' }); return; }
        if (!target) { res.status(400).json({ error: 'Chat ID required. Set it in Skills → Telegram → Configure or provide chatId.' }); return; }
        const https = require('https');
        const postData = JSON.stringify({ chat_id: target, text: message, parse_mode: 'HTML' });
        const result: any = await new Promise((resolve, reject) => {
          const r = https.request({ hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } }, (resp: any) => {
            let d = ''; resp.on('data', (c: any) => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false, description: d }); } });
          }); r.on('error', reject); r.write(postData); r.end();
        });
        if (result.ok) res.json({ success: true, message: `Telegram message sent to ${target}` });
        else res.status(500).json({ error: 'Telegram error: ' + (result.description || JSON.stringify(result)) });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // ============ DISCORD API ============
    this.app.post('/api/discord/send', async (req: Request, res: Response) => {
      try {
        const { channelId, message } = req.body;
        if (!message) { res.status(400).json({ error: 'message required' }); return; }
        const ints = loadIntegrations();
        const cfg = ints['discord'] || {};
        const token = cfg.botToken || process.env.DISCORD_BOT_TOKEN;
        if (!token) { res.status(400).json({ error: 'Discord not configured. Go to Skills → Discord → Configure.' }); return; }
        if (!channelId) { res.status(400).json({ error: 'channelId required.' }); return; }
        const https = require('https');
        const postData = JSON.stringify({ content: message });
        const result: any = await new Promise((resolve, reject) => {
          const r = https.request({ hostname: 'discord.com', path: `/api/v10/channels/${channelId}/messages`, method: 'POST', headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } }, (resp: any) => {
            let d = ''; resp.on('data', (c: any) => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: d }); } });
          }); r.on('error', reject); r.write(postData); r.end();
        });
        if (result.id) res.json({ success: true, message: `Discord message sent to channel ${channelId}` });
        else res.status(500).json({ error: 'Discord error: ' + (result.message || JSON.stringify(result)) });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // ============ SLACK API ============
    this.app.post('/api/slack/send', async (req: Request, res: Response) => {
      try {
        const { channel, message } = req.body;
        if (!message) { res.status(400).json({ error: 'message required' }); return; }
        const ints = loadIntegrations();
        const cfg = ints['slack'] || {};
        const token = cfg.botToken || process.env.SLACK_BOT_TOKEN;
        const target = channel || cfg.channel || '#general';
        if (!token) { res.status(400).json({ error: 'Slack not configured. Go to Skills → Slack → Configure.' }); return; }
        const https = require('https');
        const postData = JSON.stringify({ channel: target, text: message });
        const result: any = await new Promise((resolve, reject) => {
          const r = https.request({ hostname: 'slack.com', path: '/api/chat.postMessage', method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } }, (resp: any) => {
            let d = ''; resp.on('data', (c: any) => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false, error: d }); } });
          }); r.on('error', reject); r.write(postData); r.end();
        });
        if (result.ok) res.json({ success: true, message: `Slack message sent to ${target}` });
        else res.status(500).json({ error: 'Slack error: ' + (result.error || JSON.stringify(result)) });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // ============ WHATSAPP API (Twilio) ============
    this.app.post('/api/whatsapp/send', async (req: Request, res: Response) => {
      try {
        const { to, message } = req.body;
        if (!to || !message) { res.status(400).json({ error: 'to and message required' }); return; }
        const ints = loadIntegrations();
        const cfg = ints['whatsapp'] || {};
        const sid = cfg.accountSid || process.env.TWILIO_ACCOUNT_SID;
        const authToken = cfg.authToken || process.env.TWILIO_AUTH_TOKEN;
        const from = cfg.phoneNumber || process.env.TWILIO_PHONE_NUMBER;
        if (!sid || !authToken || !from) { res.status(400).json({ error: 'WhatsApp not configured. Go to Skills → WhatsApp → Configure.' }); return; }
        const https = require('https');
        const postData = `To=whatsapp:${to}&From=whatsapp:${from}&Body=${encodeURIComponent(message)}`;
        const auth = Buffer.from(`${sid}:${authToken}`).toString('base64');
        const result: any = await new Promise((resolve, reject) => {
          const r = https.request({ hostname: 'api.twilio.com', path: `/2010-04-01/Accounts/${sid}/Messages.json`, method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, (resp: any) => {
            let d = ''; resp.on('data', (c: any) => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: d }); } });
          }); r.on('error', reject); r.write(postData); r.end();
        });
        if (result.sid) res.json({ success: true, message: `WhatsApp message sent to ${to}` });
        else res.status(500).json({ error: 'WhatsApp error: ' + (result.message || JSON.stringify(result)) });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // ============ INBOX API ============
    // Use the class inbox instance (this.inbox) that was created in constructor

    // Get unread messages
    this.app.get('/api/inbox/unread', (_req: Request, res: Response) => {
      res.json(this.inbox.getUnread());
    });

    // Get all messages (paginated)
    this.app.get('/api/inbox/messages', (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      res.json({
        messages: this.inbox.getMessages(limit, offset),
        unread: this.inbox.getUnreadCount()
      });
    });

    // Get message threads
    this.app.get('/api/inbox/threads', (_req: Request, res: Response) => {
      res.json(this.inbox.getThreads());
    });

    // Get single thread
    this.app.get('/api/inbox/threads/:id', (req: Request, res: Response) => {
      const thread = this.inbox.getThread(req.params.id);
      if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }
      res.json(thread);
    });

    // Mark message as read
    this.app.post('/api/inbox/messages/:id/read', (req: Request, res: Response) => {
      this.inbox.markAsRead(req.params.id);
      res.json({ success: true });
    });

    // Mark thread as read
    this.app.post('/api/inbox/threads/:id/read', (req: Request, res: Response) => {
      this.inbox.markThreadAsRead(req.params.id);
      res.json({ success: true });
    });

    // Get unread counts
    this.app.get('/api/inbox/counts', (_req: Request, res: Response) => {
      res.json({
        total: this.inbox.getUnreadCount(),
        byPlatform: this.inbox.getUnreadByPlatform()
      });
    });

    // Receive incoming message (webhook endpoint)
    this.app.post('/api/inbox/receive', async (req: Request, res: Response) => {
      try {
        const { platform, from, to, subject, body, threadId, inReplyTo } = req.body;
        if (!platform || !from || !to || !body) {
          res.status(400).json({ error: 'platform, from, to, body required' });
          return;
        }

        // Store message
        const msg = this.inbox.addMessage({
          platform,
          from,
          to,
          subject,
          body,
          threadId,
          inReplyTo
        });

        if (!msg) {
          res.status(409).json({ error: 'Duplicate message' });
          return;
        }

        // AI Analysis of incoming message
        try {
          const provider = this.providerManager.createFromEnv();
          if (provider) {
            const analysisMessages: Message[] = [
              { role: 'system', content: 'You are an assistant that analyzes incoming messages and provides a brief summary and suggested reply. Respond in JSON format: { "summary": "...", "suggestedReply": "..." }' },
              { role: 'user', content: `Analyze this ${platform} message from ${from}${subject ? ` about "${subject}"` : ''}:

${body}

Provide a brief summary and suggested reply.` }
            ];
            const response = await provider.complete(analysisMessages, 0.3, 500);
            if (response.content) {
              try {
                const analysis = JSON.parse(response.content);
                this.inbox.setAnalysis(msg.id, analysis.summary, analysis.suggestedReply);
              } catch (parseErr: any) {
                logger.debug(`Inbox analysis JSON parse failed: ${parseErr.message}`);
                this.inbox.setAnalysis(msg.id, response.content.substring(0, 200), undefined);
              }
            }
          }
        } catch (e) {
          // AI analysis failed, but message is still stored
          logger.warn('AI analysis failed for incoming message:', e);
        }

        // Broadcast to WebSocket clients
        this.broadcast({
          type: 'inbox_new',
          payload: { message: msg, unreadCount: this.inbox.getUnreadCount() }
        });

        res.json({ success: true, id: msg.id });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // Poll for new messages (for platforms that support polling)
    this.app.post('/api/inbox/poll/:platform', async (req: Request, res: Response) => {
      const platform = req.params.platform;
      try {
        // This would integrate with platform-specific APIs to poll for new messages
        // For now, return success - actual implementation would vary by platform
        res.json({ success: true, polled: platform, newMessages: 0 });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // Reply to a message (chat command integration)
    this.app.post('/api/inbox/reply', async (req: Request, res: Response) => {
      try {
        const { threadId, message, platform, to } = req.body;
        if (!threadId || !message) {
          res.status(400).json({ error: 'threadId and message required' });
          return;
        }

        // Get thread to find recipient
        const thread = this.inbox.getThread(threadId);
        if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

        // Send reply via appropriate platform
        const targetPlatform = platform || thread.platform;
        const targetTo = to || thread.participants.find((p: string) => p !== 'me') || thread.participants[0];

        // Execute messaging action
        const action = {
          action: 'send',
          platform: targetPlatform,
          to: targetTo,
          message,
          channelId: req.body.channelId,
          channel: req.body.channel
        };
        const result = await execMessagingAction(action);

        // Add sent message to thread
        this.inbox.addMessage({
          platform: targetPlatform,
          from: 'me',
          to: targetTo,
          body: message,
          threadId
        });

        res.json(result);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // Mark all messages as read
    this.app.post('/api/inbox/mark-all-read', (_req: Request, res: Response) => {
      const messages = this.inbox.getMessages(1000);
      messages.forEach(m => {
        if (!m.read) this.inbox.markAsRead(m.id);
      });
      res.json({ success: true, marked: messages.filter(m => !m.read).length });
    });

    // Delete message
    this.app.delete('/api/inbox/messages/:id', (req: Request, res: Response) => {
      // Note: InboxManager doesn't have delete method, we'll add a simple version
      this.inbox['messages'] = this.inbox['messages'].filter((m: any) => m.id !== req.params.id);
      this.inbox['saveToMemory']();
      res.json({ success: true });
    });

    // Manual check for new emails
    this.app.post('/api/inbox/check', async (_req: Request, res: Response) => {
      try {
        // Trigger IMAP poll if configured
        const integrationsPath = path.join(require('os').homedir(), '.linguclaw', 'integrations.json');
        let ints: Record<string, any> = {};
        try {
          ints = JSON.parse(require('fs').readFileSync(integrationsPath, 'utf8'));
        } catch (e: any) { logger.debug(`No integrations file: ${e.message}`); }
        
        const emailCfg = ints['email'];
        if (!emailCfg || !emailCfg.host) {
          res.status(400).json({ error: 'Email not configured' });
          return;
        }
        
        // Trigger manual poll via email receiver
        const folders = emailCfg.folders ? emailCfg.folders.split(',').map((f: string) => f.trim()) : ['INBOX'];
        
        // Force a poll by stopping and restarting
        this.emailReceiver.stop();
        setTimeout(() => {
          this.emailReceiver.startIMAP({
            host: emailCfg.host,
            port: parseInt(emailCfg.port || '993', 10),
            username: emailCfg.username,
            password: emailCfg.password,
            tls: true,
            pollInterval: 1,
            folders: folders,
            useIdle: false // Use polling for manual check
          });
        }, 100);
        
        res.json({ success: true, checked: folders.length, folders });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Serve main HTML - use static dashboard or fallback to inline
    // ============ WORKFLOW API ============
    const workflowEngine = getWorkflowEngine();

    this.app.get('/api/workflows/node-definitions', (_req: Request, res: Response) => {
      res.json(workflowEngine.getNodeDefinitions());
    });

    this.app.get('/api/workflows', (_req: Request, res: Response) => {
      res.json(workflowEngine.listWorkflows());
    });

    this.app.post('/api/workflows', (req: Request, res: Response) => {
      const { name, description } = req.body;
      if (!name) { res.status(400).json({ error: 'name required' }); return; }
      const wf = workflowEngine.createWorkflow(name, description || '');
      res.json(wf);
    });

    this.app.get('/api/workflows/:id', (req: Request, res: Response) => {
      const wf = workflowEngine.getWorkflow(req.params.id);
      if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
      res.json(wf);
    });

    this.app.put('/api/workflows/:id', (req: Request, res: Response) => {
      const wf = workflowEngine.updateWorkflow(req.params.id, req.body);
      if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
      res.json(wf);
    });

    this.app.delete('/api/workflows/:id', (req: Request, res: Response) => {
      const ok = workflowEngine.deleteWorkflow(req.params.id);
      res.json({ success: ok });
    });

    this.app.post('/api/workflows/:id/duplicate', (req: Request, res: Response) => {
      const wf = workflowEngine.duplicateWorkflow(req.params.id);
      if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
      res.json(wf);
    });

    this.app.post('/api/workflows/:id/execute', async (req: Request, res: Response) => {
      try {
        const provider = this.providerManager.createFromEnv();
        const result = await workflowEngine.executeWorkflow(req.params.id, req.body.triggerData, {
          provider,
          memory: this.memory,
        });
        res.json(result);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/workflows/:id/toggle', (req: Request, res: Response) => {
      const wf = workflowEngine.getWorkflow(req.params.id);
      if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
      const updated = workflowEngine.updateWorkflow(req.params.id, { active: !wf.active });
      res.json(updated);
    });

    this.app.get('/', (_req: Request, res: Response) => {
      const landingPath = path.join(__dirname, 'static', 'index.html');
      if (require('fs').existsSync(landingPath)) {
        res.sendFile(landingPath);
      } else {
        res.send(this.generateHTML());
      }
    });

    this.app.get('/dashboard', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'static', 'dashboard.html'));
    });

    this.app.get('/hub', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'static', 'hub.html'));
    });
  }

  /**
   * Setup WebSocket for real-time updates
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('WebSocket client connected');
      this.connections.add(ws);

      ws.on('close', () => {
        this.connections.delete(ws);
        logger.info('WebSocket client disconnected');
      });

      ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(ws, message);
        } catch (error) {
          logger.error('Invalid WebSocket message');
        }
      });
    });
  }

  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(ws: WebSocket, message: any): void {
    if (message.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  /**
   * Run task and broadcast updates
   */
  private async runTask(task: string): Promise<void> {
    if (!this.orchestrator) return;

    try {
      this.broadcast({
        type: 'state_update',
        payload: { task, running: true },
      });

      const result = await this.orchestrator.run(task);

      this.broadcast({
        type: 'complete',
        payload: { result },
      });
    } catch (error: any) {
      this.broadcast({
        type: 'error',
        payload: { error: error.message },
      });
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(message: any): void {
    const data = JSON.stringify(message);
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Start email and messaging receivers - all messages go to inbox
   */
  private startEmailReceivers(): void {
    const integrationsPath = path.join(require('os').homedir(), '.linguclaw', 'integrations.json');
    let ints: Record<string, any> = {};
    try {
      ints = JSON.parse(require('fs').readFileSync(integrationsPath, 'utf8'));
    } catch (e: any) { logger.debug(`No integrations file yet: ${e.message}`); }

    // Check for IMAP email configuration
    const emailCfg = ints['email'];
    if (emailCfg && emailCfg.host && emailCfg.username && emailCfg.password) {
      logger.info('Starting IMAP email receiver for ' + emailCfg.username);
      
      // Parse folders (comma-separated list)
      const folders = emailCfg.folders ? emailCfg.folders.split(',').map((f: string) => f.trim()) : ['INBOX'];
      
      this.emailReceiver.startIMAP({
        host: emailCfg.host,
        port: parseInt(emailCfg.port || '993', 10),
        username: emailCfg.username,
        password: emailCfg.password,
        tls: true,
        pollInterval: parseFloat(emailCfg.pollInterval || '1'),
        folders: folders,
        useIdle: emailCfg.useIdle !== 'false' // Default true for real-time
      });
    }

    // Check for Gmail API configuration
    const gmailCfg = ints['gmail'];
    if (gmailCfg && gmailCfg.clientId && gmailCfg.clientSecret && gmailCfg.refreshToken) {
      logger.info('Starting Gmail API receiver');
      this.emailReceiver.startGmail({
        clientId: gmailCfg.clientId,
        clientSecret: gmailCfg.clientSecret,
        refreshToken: gmailCfg.refreshToken
      });
    }

    // ========== TELEGRAM ==========
    const telegramCfg = ints['telegram'];
    if (telegramCfg && telegramCfg.botToken) {
      logger.info('Starting Telegram bot');
      const telegramBot = new TelegramBot(telegramCfg.botToken);
      if (telegramCfg.chatId) {
        telegramBot.allowChats([parseInt(telegramCfg.chatId)]);
      }
      // Route incoming messages to inbox
      telegramBot.onMessage((msg: any) => {
        const inboxMsg = this.inbox.addMessage({
          platform: 'telegram',
          from: msg.from || 'unknown',
          to: 'me',
          subject: msg.subject || `Telegram from ${msg.from}`,
          body: msg.body || msg.message || '',
          threadId: msg.chatId || msg.from
        });
        // Broadcast to WebSocket clients
        this.broadcast({
          type: 'inbox_new',
          payload: { message: inboxMsg, unreadCount: this.inbox.getUnreadCount() }
        });
        return null;
      });
      this.messagingHub.addPlatform(telegramBot);
      telegramBot.start();
    }

    // ========== DISCORD ==========
    const discordCfg = ints['discord'];
    if (discordCfg && discordCfg.botToken) {
      logger.info('Starting Discord bot');
      const discordBot = new DiscordBot(discordCfg.botToken);
      discordBot.onMessage((msg: any) => {
        const inboxMsg = this.inbox.addMessage({
          platform: 'discord',
          from: msg.from || 'unknown',
          to: 'me',
          subject: msg.subject || `Discord from ${msg.from}`,
          body: msg.body || msg.message || '',
          threadId: msg.channelId || msg.from
        });
        this.broadcast({
          type: 'inbox_new',
          payload: { message: inboxMsg, unreadCount: this.inbox.getUnreadCount() }
        });
        return null;
      });
      this.messagingHub.addPlatform(discordBot);
      discordBot.start();
    }

    // ========== SLACK ==========
    const slackCfg = ints['slack'];
    if (slackCfg && slackCfg.botToken) {
      logger.info('Starting Slack bot');
      const slackBot = new SlackBot(slackCfg.botToken);
      slackBot.onMessage((msg: any) => {
        const inboxMsg = this.inbox.addMessage({
          platform: 'slack',
          from: msg.from || 'unknown',
          to: 'me',
          subject: msg.subject || `Slack from ${msg.from}`,
          body: msg.body || msg.message || '',
          threadId: msg.channel || msg.from
        });
        this.broadcast({
          type: 'inbox_new',
          payload: { message: inboxMsg, unreadCount: this.inbox.getUnreadCount() }
        });
        return null;
      });
      this.messagingHub.addPlatform(slackBot);
      slackBot.start();
    }

    // ========== WHATSAPP ==========
    const whatsappCfg = ints['whatsapp'];
    if (whatsappCfg && whatsappCfg.accountSid && whatsappCfg.authToken) {
      logger.info('Starting WhatsApp (Twilio)');
      const whatsappBot = new WhatsAppBot('twilio');
      whatsappBot.onMessage((msg: any) => {
        const inboxMsg = this.inbox.addMessage({
          platform: 'whatsapp',
          from: msg.from || 'unknown',
          to: 'me',
          subject: msg.subject || `WhatsApp from ${msg.from}`,
          body: msg.body || msg.message || '',
          threadId: msg.from
        });
        this.broadcast({
          type: 'inbox_new',
          payload: { message: inboxMsg, unreadCount: this.inbox.getUnreadCount() }
        });
        return null;
      });
      this.messagingHub.addPlatform(whatsappBot);
      whatsappBot.start();
    }

    logger.info('All messaging receivers started - messages will appear in inbox');
  }

  /**
   * Generate main HTML page
   */
  private generateHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LinguClaw Dashboard</title>
<style>
:root {
  --bg-primary: #0f0f1a;
  --bg-secondary: #1a1a2e;
  --bg-card: #16213e;
  --bg-input: #0d0d1a;
  --border: #2a2a4a;
  --accent: #7c3aed;
  --accent-hover: #6d28d9;
  --accent-glow: rgba(124,58,237,0.3);
  --green: #10b981;
  --red: #ef4444;
  --yellow: #f59e0b;
  --blue: #3b82f6;
  --text: #e2e8f0;
  --text-dim: #94a3b8;
  --text-muted: #64748b;
  --radius: 12px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg-primary); color: var(--text); min-height: 100vh; }

/* Top Bar */
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 1.5rem; height: 56px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); }
.topbar-left { display: flex; align-items: center; gap: 0.75rem; }
.logo { width: 32px; height: 32px; background: var(--accent); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.topbar-title { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.topbar-title span { color: var(--accent); }
.topbar-right { display: flex; align-items: center; gap: 1rem; }
.status-badge { display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.75rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px; font-size: 0.75rem; color: var(--text-dim); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-dot.online { background: var(--green); box-shadow: 0 0 6px var(--green); }
.status-dot.offline { background: var(--red); }

/* Layout */
.layout { display: flex; height: calc(100vh - 56px); }

/* Sidebar */
.sidebar { width: 260px; background: var(--bg-secondary); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
.nav { padding: 1rem 0.75rem; flex-shrink: 0; }
.nav-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.75rem; border-radius: 8px; cursor: pointer; font-size: 0.875rem; color: var(--text-dim); transition: all 0.15s; margin-bottom: 2px; }
.nav-item:hover { background: var(--bg-card); color: var(--text); }
.nav-item.active { background: var(--accent); color: white; }
.nav-icon { font-size: 1rem; width: 20px; text-align: center; }
.sidebar-section { padding: 0.5rem 1rem; margin-top: 0.5rem; }
.sidebar-section-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 600; }
.step-list { list-style: none; padding: 0 0.75rem; flex: 1; overflow-y: auto; }
.step-item { padding: 0.5rem 0.6rem; margin-bottom: 3px; border-radius: 6px; font-size: 0.8rem; color: var(--text-dim); background: var(--bg-card); border-left: 3px solid var(--border); display: flex; align-items: center; gap: 0.4rem; }
.step-item.completed { border-left-color: var(--green); color: var(--green); }
.step-item.failed { border-left-color: var(--red); color: var(--red); }
.step-item.running { border-left-color: var(--yellow); color: var(--yellow); animation: pulse 1.5s infinite; }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }
.step-empty { color: var(--text-muted); font-size: 0.8rem; padding: 0.5rem 0.6rem; }

/* Main Content */
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

/* Task View */
.task-view { flex: 1; display: flex; flex-direction: column; padding: 1.25rem; gap: 1rem; }
.task-header { display: flex; gap: 0.5rem; }
.task-input { flex: 1; padding: 0.8rem 1rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 0.95rem; outline: none; transition: border 0.2s; }
.task-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
.task-btn { padding: 0.8rem 1.5rem; background: var(--accent); color: white; border: none; border-radius: var(--radius); cursor: pointer; font-weight: 600; font-size: 0.9rem; transition: all 0.2s; display: flex; align-items: center; gap: 0.4rem; }
.task-btn:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: 0 4px 12px var(--accent-glow); }
.task-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

/* Output Area */
.output-area { flex: 1; display: flex; flex-direction: column; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.output-tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--bg-card); }
.output-tab { padding: 0.6rem 1rem; font-size: 0.8rem; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
.output-tab:hover { color: var(--text-dim); }
.output-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.output-content { flex: 1; overflow-y: auto; padding: 1rem; font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace; font-size: 0.825rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--text-dim); }
.output-content .msg-task { color: var(--blue); }
.output-content .msg-ok { color: var(--green); }
.output-content .msg-err { color: var(--red); }
.output-content .msg-step { color: var(--yellow); }
.output-content .msg-info { color: var(--text-dim); }
.task-running { display: none; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; background: rgba(124,58,237,0.1); border: 1px solid var(--accent); border-radius: var(--radius); font-size: 0.85rem; color: var(--accent); }
.task-running.show { display: flex; }
.spinner { width: 16px; height: 16px; border: 2px solid var(--accent-glow); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Settings View */
.settings-view { display: none; flex: 1; padding: 1.25rem; overflow-y: auto; }
.settings-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; margin-bottom: 1rem; max-width: 700px; }
.settings-card-title { font-size: 1rem; font-weight: 600; margin-bottom: 1rem; color: var(--text); display: flex; align-items: center; gap: 0.5rem; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
.form-group { margin-bottom: 0.75rem; }
.form-label { display: block; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.3rem; font-weight: 500; }
.form-input, .form-select { width: 100%; padding: 0.6rem 0.75rem; background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.875rem; outline: none; transition: border 0.2s; }
.form-input:focus, .form-select:focus { border-color: var(--accent); }
.form-hint { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem; }
.form-actions { display: flex; gap: 0.75rem; margin-top: 1.25rem; }
.btn { padding: 0.6rem 1.25rem; border-radius: 8px; font-size: 0.85rem; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; }
.btn-accent { background: var(--accent); color: white; }
.btn-accent:hover { background: var(--accent-hover); }
.btn-ghost { background: transparent; color: var(--text-dim); border: 1px solid var(--border); }
.btn-ghost:hover { background: var(--bg-card); color: var(--text); }
.toast { display: none; padding: 0.6rem 1rem; border-radius: 8px; font-size: 0.825rem; margin-top: 0.75rem; }
.toast.show { display: block; }
.toast.ok { background: rgba(16,185,129,0.15); color: var(--green); border: 1px solid rgba(16,185,129,0.3); }
.toast.err { background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }

/* History View */
.history-view { display: none; flex: 1; padding: 1.25rem; overflow-y: auto; }
.history-empty { color: var(--text-muted); text-align: center; padding: 3rem; font-size: 0.9rem; }
.history-item { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; margin-bottom: 0.75rem; cursor: pointer; transition: border 0.15s; }
.history-item:hover { border-color: var(--accent); }
.history-item-task { font-weight: 500; margin-bottom: 0.3rem; }
.history-item-meta { font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 1rem; }
</style>
</head>
<body>

<div class="topbar">
  <div class="topbar-left">
    <div class="logo">C</div>
    <div class="topbar-title">Lingu<span>Claw</span></div>
  </div>
  <div class="topbar-right">
    <div class="status-badge" id="modelBadge">openai/gpt-3.5-turbo</div>
    <div class="status-badge"><div class="status-dot online" id="wsDot"></div><span id="wsStatus">Connected</span></div>
  </div>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="nav">
      <div class="nav-item active" onclick="showView('task', this)"><span class="nav-icon">&#9889;</span> Tasks</div>
      <div class="nav-item" onclick="showView('history', this)"><span class="nav-icon">&#128203;</span> History</div>
      <div class="nav-item" onclick="showView('settings', this)"><span class="nav-icon">&#9881;</span> Settings</div>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-section-title">Execution Steps</div>
    </div>
    <ul class="step-list" id="steps">
      <li class="step-empty">No active task</li>
    </ul>
  </div>

  <div class="main">
    <!-- TASK VIEW -->
    <div class="task-view" id="taskView">
      <div class="task-header">
        <input class="task-input" id="taskInput" placeholder="Describe your task... (e.g. List all TypeScript files)" onkeydown="if(event.key==='Enter')startTask()" />
        <button class="task-btn" id="taskBtn" onclick="startTask()">&#9654; Run</button>
      </div>
      <div class="task-running" id="taskRunning"><div class="spinner"></div> Running task...</div>
      <div class="output-area">
        <div class="output-tabs">
          <div class="output-tab active" onclick="switchTab('output', this)">Output</div>
          <div class="output-tab" onclick="switchTab('raw', this)">Raw</div>
        </div>
        <div class="output-content" id="outputArea">
<span class="msg-info">Welcome to LinguClaw Dashboard.
Type a task above and click Run to get started.

Examples:
  - List all TypeScript files in this project
  - Create a hello.ts file
  - Analyze the project structure</span></div>
        <div class="output-content" id="rawArea" style="display:none;"></div>
      </div>
    </div>

    <!-- HISTORY VIEW -->
    <div class="history-view" id="historyView">
      <h2 style="margin-bottom:1rem;font-size:1.1rem;">Task History</h2>
      <div id="historyList"><div class="history-empty">No tasks run yet this session.</div></div>
    </div>

    <!-- SETTINGS VIEW -->
    <div class="settings-view" id="settingsView">
      <div class="settings-card">
        <div class="settings-card-title">&#129302; LLM Provider</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Provider</label>
            <select class="form-select" id="settingProvider">
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="ollama">Ollama (Local)</option>
              <option value="lmstudio">LM Studio (Local)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Model</label>
            <input class="form-input" id="settingModel" placeholder="openai/gpt-3.5-turbo" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">API Key</label>
          <input class="form-input" type="password" id="settingApiKey" placeholder="Enter new API key..." />
          <div class="form-hint">Leave empty to keep current key.</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Max Tokens</label>
            <input class="form-input" type="number" id="settingMaxTokens" min="100" max="8000" />
          </div>
          <div class="form-group">
            <label class="form-label">Temperature</label>
            <input class="form-input" type="number" id="settingTemperature" min="0" max="2" step="0.1" />
          </div>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">&#128736; System</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Max Steps</label>
            <input class="form-input" type="number" id="settingMaxSteps" min="1" max="50" />
          </div>
          <div class="form-group">
            <label class="form-label">Log Level</label>
            <select class="form-select" id="settingLogLevel">
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Safety Mode</label>
          <select class="form-select" id="settingSafetyMode">
            <option value="strict">Strict</option>
            <option value="balanced">Balanced</option>
            <option value="permissive">Permissive</option>
          </select>
        </div>
        <div class="form-actions">
          <button class="btn btn-accent" onclick="saveSettings()">Save Settings</button>
          <button class="btn btn-ghost" onclick="resetSettings()">Reset Defaults</button>
        </div>
        <div class="toast" id="settingsToast"></div>
      </div>
    </div>
  </div>
</div>

<script>
var outputEl = document.getElementById('outputArea');
var rawEl = document.getElementById('rawArea');
var stepsEl = document.getElementById('steps');
var taskBtn = document.getElementById('taskBtn');
var runningEl = document.getElementById('taskRunning');
var ws = null;
var taskHistory = [];
var isRunning = false;
var rawLog = '';

// --- Views ---
function showView(view, el) {
  var items = document.querySelectorAll('.nav-item');
  for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
  el.classList.add('active');
  document.getElementById('taskView').style.display = view === 'task' ? 'flex' : 'none';
  document.getElementById('settingsView').style.display = view === 'settings' ? 'block' : 'none';
  document.getElementById('historyView').style.display = view === 'history' ? 'block' : 'none';
  if (view === 'settings') loadSettings();
  if (view === 'history') renderHistory();
}

// --- Output Tabs ---
function switchTab(tab, el) {
  var tabs = document.querySelectorAll('.output-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  el.classList.add('active');
  document.getElementById('outputArea').style.display = tab === 'output' ? 'block' : 'none';
  document.getElementById('rawArea').style.display = tab === 'raw' ? 'block' : 'none';
}

// --- Output helpers ---
function appendOutput(html) { outputEl.innerHTML += html; outputEl.scrollTop = outputEl.scrollHeight; }
function setOutput(html) { outputEl.innerHTML = html; }
function appendRaw(text) { rawEl.textContent += text; rawLog += text; }

// --- Task ---
function startTask() {
  var task = document.getElementById('taskInput').value.trim();
  if (!task || isRunning) return;
  isRunning = true;
  taskBtn.disabled = true;
  runningEl.classList.add('show');
  setOutput('<span class="msg-task">Task: ' + esc(task) + '</span>\\n');
  rawEl.textContent = '';
  rawLog = '';
  stepsEl.innerHTML = '<li class="step-item running">Planning...</li>';

  fetch('/api/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: task, max_steps: 15 })
  }).then(function(r) { return r.json(); }).then(function(result) {
    if (result.error) {
      appendOutput('<span class="msg-err">Error: ' + esc(result.error) + '</span>\\n');
      taskDone(task, 'error');
    } else {
      appendOutput('<span class="msg-info">Task queued (ID: ' + result.task_id + ')</span>\\n');
    }
  }).catch(function(e) {
    appendOutput('<span class="msg-err">Network error: ' + esc(e.message) + '</span>\\n');
    taskDone(task, 'error');
  });
}

function taskDone(task, status) {
  isRunning = false;
  taskBtn.disabled = false;
  runningEl.classList.remove('show');
  taskHistory.unshift({ task: task, time: new Date().toLocaleTimeString(), status: status, log: rawLog });
}

function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// --- History ---
function renderHistory() {
  var el = document.getElementById('historyList');
  if (taskHistory.length === 0) { el.innerHTML = '<div class="history-empty">No tasks run yet this session.</div>'; return; }
  var html = '';
  for (var i = 0; i < taskHistory.length; i++) {
    var h = taskHistory[i];
    var icon = h.status === 'done' ? '<span style="color:var(--green)">&#10003;</span>' : '<span style="color:var(--red)">&#10007;</span>';
    html += '<div class="history-item" onclick="showHistoryDetail(' + i + ')">';
    html += '<div class="history-item-task">' + icon + ' ' + esc(h.task) + '</div>';
    html += '<div class="history-item-meta"><span>' + h.time + '</span><span>' + h.status + '</span></div>';
    html += '</div>';
  }
  el.innerHTML = html;
}
function showHistoryDetail(idx) {
  var h = taskHistory[idx];
  showView('task', document.querySelector('.nav-item'));
  setOutput('<span class="msg-task">[History] ' + esc(h.task) + '</span>\\n' + esc(h.log));
}

// --- Settings ---
function loadSettings() {
  fetch('/api/settings').then(function(r) { return r.json(); }).then(function(s) {
    document.getElementById('settingProvider').value = s.llm.provider || '';
    document.getElementById('settingModel').value = s.llm.model || '';
    document.getElementById('settingMaxTokens').value = s.llm.maxTokens || 1000;
    document.getElementById('settingTemperature').value = s.llm.temperature || 0.7;
    document.getElementById('settingMaxSteps').value = s.system.maxSteps || 15;
    document.getElementById('settingLogLevel').value = s.system.logLevel || 'info';
    document.getElementById('settingSafetyMode').value = s.system.safetyMode || 'balanced';
    document.getElementById('modelBadge').textContent = (s.llm.provider || '') + '/' + (s.llm.model || '');
  }).catch(function(e) { console.error('Settings load error:', e); });
}
function saveSettings() {
  var toast = document.getElementById('settingsToast');
  toast.className = 'toast';
  var data = {
    llm: {
      provider: document.getElementById('settingProvider').value,
      model: document.getElementById('settingModel').value,
      maxTokens: parseInt(document.getElementById('settingMaxTokens').value),
      temperature: parseFloat(document.getElementById('settingTemperature').value)
    },
    system: {
      maxSteps: parseInt(document.getElementById('settingMaxSteps').value),
      logLevel: document.getElementById('settingLogLevel').value,f
      safetyMode: document.getElementById('settingSafetyMode').value
    }
  };
  var apiKey = document.getElementById('settingApiKey').value;
  if (apiKey) data.llm.apiKey = apiKey;
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(function(r) {
    if (r.ok) {
      toast.textContent = 'Settings saved successfully';
      toast.className = 'toast show ok';
      document.getElementById('settingApiKey').value = '';
      document.getElementById('modelBadge').textContent = data.llm.provider + '/' + data.llm.model;
    } else {
      toast.textContent = 'Failed to save settings';
      toast.className = 'toast show err';
    }
  }).catch(function(e) {
    toast.textContent = 'Error: ' + e.message;
    toast.className = 'toast show err';
  });
}
function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) return;
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ llm: { provider: 'openrouter', model: 'openai/gpt-3.5-turbo', maxTokens: 1000, temperature: 0.7 }, system: { maxSteps: 15, logLevel: 'info', safetyMode: 'balanced' } })
  }).then(function() { loadSettings(); var t = document.getElementById('settingsToast'); t.textContent = 'Reset to defaults'; t.className = 'toast show ok'; });
}

// --- WebSocket ---
try {
  ws = new WebSocket('ws://' + window.location.host);
  ws.onopen = function() {
    document.getElementById('wsDot').className = 'status-dot online';
    document.getElementById('wsStatus').textContent = 'Connected';
  };
  ws.onclose = function() {
    document.getElementById('wsDot').className = 'status-dot offline';
    document.getElementById('wsStatus').textContent = 'Disconnected';
  };
  ws.onerror = function() {
    document.getElementById('wsDot').className = 'status-dot offline';
    document.getElementById('wsStatus').textContent = 'Error';
  };
  ws.onmessage = function(ev) {
    var msg = JSON.parse(ev.data);
    if (msg.type === 'state_update') {
      appendOutput('<span class="msg-step">Running: ' + esc(msg.payload.task) + '</span>\\n');
      appendRaw('Task: ' + msg.payload.task + '\\n');
    } else if (msg.type === 'step_update') {
      var s = msg.payload;
      appendOutput('<span class="msg-step">[' + esc(s.id) + '] ' + esc(s.description) + '</span>\\n');
      appendRaw('[Step] ' + s.id + ': ' + s.description + '\\n');
      updateSteps(msg.payload.steps || []);
    } else if (msg.type === 'log') {
      appendOutput('<span class="msg-info">' + esc(msg.payload) + '</span>\\n');
      appendRaw(msg.payload + '\\n');
    } else if (msg.type === 'complete') {
      var res = msg.payload.result || '';
      appendOutput('\\n<span class="msg-ok">--- Task Complete ---</span>\\n' + esc(res) + '\\n');
      appendRaw('\\nComplete:\\n' + res + '\\n');
      taskDone(document.getElementById('taskInput').value, 'done');
      stepsEl.innerHTML = '<li class="step-item completed">All steps completed</li>';
    } else if (msg.type === 'error') {
      appendOutput('<span class="msg-err">Error: ' + esc(msg.payload.error) + '</span>\\n');
      appendRaw('Error: ' + msg.payload.error + '\\n');
      taskDone(document.getElementById('taskInput').value, 'error');
    }
  };
  setInterval(function() {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
  }, 30000);
} catch(e) { console.log('WS init failed:', e); }

function updateSteps(stepList) {
  if (!stepList || stepList.length === 0) return;
  var html = '';
  for (var i = 0; i < stepList.length; i++) {
    var s = stepList[i];
    var cls = s.status === 'completed' ? 'completed' : s.status === 'failed' ? 'failed' : s.status === 'in_progress' ? 'running' : '';
    html += '<li class="step-item ' + cls + '">' + esc(s.id) + ': ' + esc(s.description || '').substring(0, 40) + '</li>';
  }
  stepsEl.innerHTML = html;
}

// Load model badge on start
loadSettings();
</script>
</body>
</html>`;
  }
}

/**
 * Run web UI server
 */
export async function runWebUI(projectRoot: string, host: string, port: number): Promise<void> {
  const manager = new WebUIManager(projectRoot, host, port);
  await manager.start();
}
