/**
 * IMAP Email Receiver - Polls for incoming emails and adds to Inbox
 */

import { InboxManager, InboxMessage } from './inbox';
import { getLogger } from './logger';

const logger = getLogger();
const simpleParser = require('mailparser').simpleParser;

export interface IMAPConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  tls?: boolean;
  pollInterval?: number; // minutes
  folders?: string[]; // folders to monitor, default ['INBOX']
  useIdle?: boolean; // use IMAP IDLE for real-time
}

export class IMAPReceiver {
  private inbox: InboxManager;
  private config: IMAPConfig | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private idleConnections: Map<string, any> = new Map();
  private isRunning = false;
  private lastCheck: Map<string, Date> = new Map();

  constructor(inbox: InboxManager) {
    this.inbox = inbox;
  }

  configure(config: IMAPConfig): void {
    this.config = {
      ...config,
      pollInterval: config.pollInterval || 5
    };
  }

  start(): void {
    if (this.isRunning || !this.config) return;
    this.isRunning = true;
    
    const folders = this.config.folders || ['INBOX'];
    const useIdle = String(this.config.useIdle).toLowerCase() !== 'false'; // Default true, handle both boolean and string
    
    if (useIdle) {
      // Use IMAP IDLE for real-time notifications
      logger.info('Starting IMAP IDLE for folders: ' + folders.join(', '));
      // Also do initial poll to catch existing unread emails
      this.pollAllFolders();
      for (const folder of folders) {
        this.startIdleForFolder(folder);
      }
    } else {
      // Fallback to polling
      const interval = (this.config.pollInterval || 1) * 60 * 1000;
      logger.info('Starting IMAP polling every ' + (interval / 1000) + ' seconds');
      this.pollAllFolders();
      this.pollTimer = setInterval(() => this.pollAllFolders(), interval);
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // Close all IDLE connections
    for (const [folder, connection] of this.idleConnections) {
      try {
        connection.end();
      } catch (e) {
        // Ignore close errors
      }
    }
    this.idleConnections.clear();
  }

  private async pollAllFolders(): Promise<void> {
    if (!this.config) return;
    const folders = this.config.folders || ['INBOX'];
    
    for (const folder of folders) {
      // Try the new imap-based polling
      await this.checkFolderWithImap(folder);
    }
  }

  private async startIdleForFolder(folder: string): Promise<void> {
    if (!this.config) return;
    
    // Check if imap library is available
    let imap;
    try {
      imap = require('imap');
    } catch (e) {
      logger.warn('IMAP library not installed. Run: npm install imap');
      // No fallback - just log error
      return;
    }
    
    try {
      const tlsOptions = this.config.tls !== false ? {
        rejectUnauthorized: false,  // Allow self-signed certs for Gmail
        servername: this.config.host  // SNI for proper cert validation
      } : undefined;
      
      const config = {
        user: this.config.username,
        password: this.config.password,
        host: this.config.host,
        port: this.config.port,
        tls: this.config.tls !== false,
        tlsOptions,
        keepalive: true,
        idleInterval: 1000
      };
      
      logger.info(`IMAP IDLE config: ${this.config.host}:${this.config.port} (TLS: ${config.tls})`);

      const connection = new imap(config);
      
      connection.on('ready', () => {
        logger.info(`IMAP connection ready for ${folder}`);
        // Try to open box, handle Gmail special folder names
        const boxName = this.resolveFolderName(folder);
        connection.openBox(boxName, false, (err: any, box: any) => {
          if (err) {
            logger.error(`IMAP openBox error for ${folder} (resolved: ${boxName}): ${err?.message || err}`);
            return;
          }
          
          logger.info('IMAP IDLE connected to ' + folder);
          
          connection.on('mail', (numNewMsgs: number) => {
            logger.info(numNewMsgs + ' new messages in ' + folder);
            // Don't use checkFolder - it causes duplicates
            // this.checkFolder(folder);
          });
          
          connection.idle();
        });
      });
      
      connection.on('error', (err: any) => {
        const errorDetails = err?.message || err?.text || err?.code || JSON.stringify(err) || 'Unknown error';
        logger.error(`IMAP IDLE error for ${folder}: ${errorDetails}`);
        logger.error(`IMAP IDLE error details: ${JSON.stringify({message: err?.message, code: err?.code, stack: err?.stack})}`);
        setTimeout(() => this.startIdleForFolder(folder), 5000);
      });
      
      connection.on('end', () => {
        logger.info('IMAP IDLE connection ended for ' + folder);
        if (this.isRunning) {
          setTimeout(() => this.startIdleForFolder(folder), 5000);
        }
      });
      
      connection.connect();
      this.idleConnections.set(folder, connection);
      
    } catch (e: any) {
      logger.error('Failed to start IMAP IDLE for ' + folder + ':', e.message);
      // Don't use checkFolder fallback - it causes duplicates
      // this.checkFolder(folder);
    }
  }

  private resolveFolderName(folder: string): string {
    // Handle Gmail special folder names
    if (this.config?.host?.includes('gmail') || this.config?.host?.includes('google')) {
      const gmailFolders: Record<string, string> = {
        'INBOX': 'INBOX',
        'Sent': '[Gmail]/Sent Mail',
        'Drafts': '[Gmail]/Drafts',
        'Trash': '[Gmail]/Trash',
        'Spam': '[Gmail]/Spam',
        'Starred': '[Gmail]/Starred',
        'Important': '[Gmail]/Important',
        'All Mail': '[Gmail]/All Mail'
      };
      return gmailFolders[folder] || folder;
    }
    return folder;
  }

  private async checkFolderWithImap(folder: string): Promise<void> {
    if (!this.config) {
      logger.warn('checkFolderWithImap called but no config available');
      return;
    }
    
    logger.info(`[IMAP-POLL] Checking folder: ${folder}`);
    
    let imap;
    try {
      imap = require('imap');
    } catch (e) {
      logger.error('imap library not installed');
      return;
    }
    
    return new Promise((resolve) => {
      const config = {
        user: this.config!.username,
        password: this.config!.password,
        host: this.config!.host,
        port: this.config!.port,
        tls: this.config!.tls !== false,
        tlsOptions: {
          rejectUnauthorized: false
        }
      };
      
      logger.info(`[IMAP-POLL] Connecting to ${config.host}:${config.port}`);
      
      const connection = new imap(config);
      let resolved = false;
      
      const finish = () => {
        if (!resolved) {
          resolved = true;
          try { connection.end(); } catch (e) {}
          resolve();
        }
      };
      
      // Timeout after 30 seconds
      setTimeout(() => {
        logger.warn('[IMAP-POLL] Timeout after 30s');
        finish();
      }, 30000);
      
      connection.on('ready', () => {
        logger.info('[IMAP-POLL] Connection ready');
        const boxName = this.resolveFolderName(folder);
        
        connection.openBox(boxName, false, (err: any, box: any) => {
          if (err) {
            logger.error(`[IMAP-POLL] openBox error: ${err.message}`);
            finish();
            return;
          }
          
          logger.info(`[IMAP-POLL] Mailbox opened: ${boxName}, messages: ${box.messages.total}`);
          
          // Search for UNSEEN
          connection.search(['UNSEEN'], (err: any, results: any[]) => {
            if (err) {
              logger.error(`[IMAP-POLL] search error: ${err.message}`);
              finish();
              return;
            }
            
            logger.info(`[IMAP-POLL] Found ${results.length} UNSEEN messages`);
            
            if (results.length === 0) {
              finish();
              return;
            }
            
            // Fetch only headers, no body to avoid MIME completely
            const f = connection.fetch(results, { bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO)' });
            
            f.on('message', (msg: any, seqno: number) => {
              logger.info(`[IMAP-POLL] Processing message #${seqno}`);
              
              let header: any = null;
              
              msg.on('body', (stream: any, info: any) => {
                let buffer = '';
                stream.on('data', (chunk: any) => buffer += chunk.toString('utf8'));
                stream.on('end', () => {
                  if (info.which === 'HEADER') header = buffer;
                });
              });
              
              msg.once('end', () => {
                logger.info(`[IMAP-POLL] Message fetched, header: ${!!header}`);
                
                // Parse header to extract email fields
                if (header) {
                  const headerLines = header.split('\r\n');
                  const headers: Record<string, string> = {};
                  
                  for (const line of headerLines) {
                    const match = line.match(/^([^:]+):\s*(.*)$/);
                    if (match) {
                      headers[match[1].toLowerCase()] = match[2];
                    }
                  }
                  
                  const subject = this.cleanEmailBody(headers['subject'] || '(no subject)');
                  const from = this.cleanEmailBody(headers['from'] || 'unknown@sender.com');
                  const to = this.cleanEmailBody(headers['to'] || this.config!.username);
                  const messageId = this.cleanEmailBody(headers['message-id'] || `msg_${Date.now()}_${seqno}`);
                  const inReplyTo = headers['in-reply-to'] ? this.cleanEmailBody(headers['in-reply-to']) : undefined;
                  
                  logger.info(`[IMAP-POLL] Parsed - From: ${from}, Subject: ${subject}`);
                  
                  // Add to inbox - skip body to avoid MIME issues completely
                  this.inbox.addMessage({
                    platform: 'email',
                    from: this.extractEmail(from),
                    to: this.extractEmail(to),
                    subject: folder !== 'INBOX' ? `[${folder}] ${subject}` : subject,
                    body: '', // No body - subject contains the important info
                    threadId: inReplyTo || messageId,
                    inReplyTo
                  });
                  logger.info('[IMAP-POLL] Message added to inbox');
                }
              });
            });
            
            f.once('error', (err: any) => {
              logger.error(`[IMAP-POLL] Fetch error: ${err.message}`);
              finish();
            });
            
            f.once('end', () => {
              logger.info('[IMAP-POLL] Fetch completed');
              finish();
            });
          });
        });
      });
      
      connection.on('error', (err: any) => {
        logger.error(`[IMAP-POLL] Connection error: ${err.message}`);
        finish();
      });
      
      connection.connect();
    });
  }

  
  private extractEmail(fromHeader: string): string {
    const match = fromHeader.match(/<([^>]+)>/);
    return match ? match[1] : fromHeader;
  }

  private cleanEmailBody(body: string): string {
    if (!body) return '';
    
    let text = body;
    
    // Remove MIME boundaries and headers with precise regex
    text = text.replace(/^--[\w-]+--?\r?\n/gm, '');
    text = text.replace(/^Content-Type:\s*[^;\r\n]*(?:;[^;\r\n]*)*\r?\n/gim, '');
    text = text.replace(/^Content-Transfer-Encoding:\s*[^\r\n]*\r?\n/gim, '');
    text = text.replace(/^Content-Disposition:\s*[^\r\n]*\r?\n/gim, '');
    text = text.replace(/^charset\s*=\s*["']?[^"'\r\n]*["']?\r?\n/gim, '');
    
    // Remove any remaining boundary markers
    text = text.replace(/^--[\w-]+--?\r?$/gm, '');
    
    // Clean up multiple consecutive line breaks
    text = text.replace(/\r?\n\s*\r?\n/g, '\r\n');
    
    // Decode MIME encoded words (RFC 2047): =?charset?Q?text?=
    text = text.replace(/=\?([^?]+)\?Q\?([^?]*)\?=/gi, (_: string, charset: string, encoded: string) => {
      // Decode quoted-printable: =XX hex -> byte
      const bytes: number[] = [];
      let i = 0;
      while (i < encoded.length) {
        if (encoded[i] === '=' && i + 2 < encoded.length) {
          const hex = encoded.substring(i + 1, i + 3);
          const byte = parseInt(hex, 16);
          bytes.push(byte);
          i += 3;
        } else if (encoded[i] === '_') {
          bytes.push(0x20); // space
          i++;
        } else {
          bytes.push(encoded.charCodeAt(i));
          i++;
        }
      }
      // Always use UTF-8 for modern email
      return Buffer.from(bytes).toString('utf-8');
    });
    
    // Decode MIME encoded words (RFC 2047): =?charset?B?base64?=
    text = text.replace(/=\?([^?]+)\?B\?([^?]*)\?=/gi, (_: string, _charset: string, encoded: string) => {
      try {
        return Buffer.from(encoded, 'base64').toString('utf8');
      } catch {
        return encoded;
      }
    });
    
    // Decode common HTML entities
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');
    
    // Remove HTML tags (simple approach)
    text = text.replace(/<[^>]*>/g, ' ');
    
    // Fix quoted-printable soft line breaks
    text = text.replace(/=\r?\n/g, '');
    
    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text.substring(0, 10000);
  }
}

/**
 * Gmail API Receiver - Uses Gmail API for push notifications
 */
export class GmailReceiver {
  private inbox: InboxManager;
  private config: any = null;

  constructor(inbox: InboxManager) {
    this.inbox = inbox;
  }

  configure(config: { clientId: string; clientSecret: string; refreshToken: string }): void {
    this.config = config;
  }

  async check(): Promise<void> {
    if (!this.config) return;

    try {
      const { google } = require('googleapis');
      
      const oauth2Client = new google.auth.OAuth2(
        this.config.clientId,
        this.config.clientSecret
      );
      
      oauth2Client.setCredentials({
        refresh_token: this.config.refreshToken
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Get unread messages
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread'
      });

      const messages = res.data.messages || [];

      for (const msg of messages) {
        const full = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full'
        });

        const headers = full.data.payload?.headers || [];
        const subject = this.cleanEmailBody(headers.find((h: {name?: string, value?: string}) => h.name === 'Subject')?.value || '(no subject)');
        const from = headers.find((h: {name?: string, value?: string}) => h.name === 'From')?.value || 'unknown';
        const to = headers.find((h: {name?: string, value?: string}) => h.name === 'To')?.value || 'me';
        const threadId = full.data.threadId;

        // Get body
        let body = '';
        const parts = full.data.payload?.parts || [full.data.payload];
        for (const part of parts) {
          if (part?.body?.data && part.mimeType === 'text/plain') {
            body = Buffer.from(part.body.data, 'base64').toString('utf8');
            break;
          }
        }

        // Add to inbox
        this.inbox.addMessage({
          platform: 'email',
          from: this.extractEmail(from),
          to: this.extractEmail(to),
          subject: this.cleanEmailBody(subject),
          body: this.cleanBody(body),
          threadId: threadId || undefined
        });

        // Mark as read
        await gmail.users.messages.modify({
          userId: 'me',
          id: msg.id!,
          requestBody: {
            removeLabelIds: ['UNREAD']
          }
        });
      }

      if (messages.length > 0) {
        logger.info(`Processed ${messages.length} new Gmail messages`);
      }
    } catch (e: any) {
      logger.error('Gmail API error:', e.message);
    }
  }

  private extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return match ? match[1] : from;
  }

  private cleanBody(body: string): string {
    return body.trim().substring(0, 10000);
  }

  private cleanEmailBody(body: string): string {
    if (!body) return '';
    
    let text = body;
    
    // Remove MIME boundaries and headers with precise regex
    text = text.replace(/^--[\w-]+--?\r?\n/gm, '');
    text = text.replace(/^Content-Type:\s*[^;\r\n]*(?:;[^;\r\n]*)*\r?\n/gim, '');
    text = text.replace(/^Content-Transfer-Encoding:\s*[^\r\n]*\r?\n/gim, '');
    text = text.replace(/^Content-Disposition:\s*[^\r\n]*\r?\n/gim, '');
    text = text.replace(/^charset\s*=\s*["']?[^"'\r\n]*["']?\r?\n/gim, '');
    
    // Remove any remaining boundary markers
    text = text.replace(/^--[\w-]+--?\r?$/gm, '');
    
    // Clean up multiple consecutive line breaks
    text = text.replace(/\r?\n\s*\r?\n/g, '\r\n');
    
    // Decode MIME encoded words (RFC 2047): =?charset?Q?text?=
    text = text.replace(/=\?([^?]+)\?Q\?([^?]*)\?=/gi, (_: string, charset: string, encoded: string) => {
      // Decode quoted-printable: =XX hex -> byte
      const bytes: number[] = [];
      let i = 0;
      while (i < encoded.length) {
        if (encoded[i] === '=' && i + 2 < encoded.length) {
          const hex = encoded.substring(i + 1, i + 3);
          const byte = parseInt(hex, 16);
          bytes.push(byte);
          i += 3;
        } else if (encoded[i] === '_') {
          bytes.push(0x20); // space
          i++;
        } else {
          bytes.push(encoded.charCodeAt(i));
          i++;
        }
      }
      // Always use UTF-8 for modern email
      return Buffer.from(bytes).toString('utf-8');
    });
    
    // Decode MIME encoded words (RFC 2047): =?charset?B?base64?=
    text = text.replace(/=\?([^?]+)\?B\?([^?]*)\?=/gi, (_: string, _charset: string, encoded: string) => {
      try {
        return Buffer.from(encoded, 'base64').toString('utf8');
      } catch {
        return encoded;
      }
    });
    
    // Decode common HTML entities
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');
    
    // Remove HTML tags (simple approach)
    text = text.replace(/<[^>]*>/g, ' ');
    
    // Fix quoted-printable soft line breaks
    text = text.replace(/=\r?\n/g, '');
    
    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text.substring(0, 10000);
  }
}

/**
 * Unified Email Receiver - Manages both IMAP and Gmail
 */
export class EmailReceiver {
  private imap: IMAPReceiver;
  private gmail: GmailReceiver;
  private inbox: InboxManager;
  private gmailTimer: NodeJS.Timeout | null = null;

  constructor(inbox: InboxManager) {
    this.inbox = inbox;
    this.imap = new IMAPReceiver(inbox);
    this.gmail = new GmailReceiver(inbox);
  }

  startIMAP(config: IMAPConfig): void {
    this.imap.configure(config);
    this.imap.start();
  }

  startGmail(config: any): void {
    this.gmail.configure(config);
    // Poll Gmail every 2 minutes
    this.gmailTimer = setInterval(() => this.gmail.check(), 2 * 60 * 1000);
    this.gmail.check(); // Initial check
  }

  stop(): void {
    this.imap.stop();
    if (this.gmailTimer) {
      clearInterval(this.gmailTimer);
      this.gmailTimer = null;
    }
  }
}
