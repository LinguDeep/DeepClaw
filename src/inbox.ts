/**
 * Inbox System - Tracks incoming messages and replies
 * Integrates with email, telegram, discord, slack, whatsapp
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface InboxMessage {
  id: string;
  platform: 'email' | 'telegram' | 'discord' | 'slack' | 'whatsapp';
  from: string;
  to: string;
  subject?: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  timestamp: string;
  read: boolean;
  analyzed: boolean;
  analysis?: string;
  suggestedReply?: string;
}

export interface MessageThread {
  id: string;
  platform: string;
  participants: string[];
  subject?: string;
  lastMessageAt: string;
  unreadCount: number;
  messages: InboxMessage[];
}

export class InboxManager {
  private messages: InboxMessage[] = [];
  private threads: Map<string, MessageThread> = new Map();
  private memory: any;

  constructor(memory: any) {
    this.memory = memory;
    this.loadFromMemory();
  }

  /**
   * Store a new incoming message
   */
  addMessage(msg: Omit<InboxMessage, 'id' | 'timestamp' | 'read' | 'analyzed'>): InboxMessage | null {
    logger.info(`InboxManager.addMessage called - Platform: ${msg.platform}, From: ${msg.from}, Subject: ${msg.subject || '(no subject)'}`);
    
    // Check for duplicates based on messageId/threadId (most reliable)
    if (msg.threadId) {
      const existingById = this.messages.find(m => 
        m.threadId === msg.threadId &&
        m.platform === msg.platform &&
        new Date().getTime() - new Date(m.timestamp).getTime() < 24 * 60 * 60 * 1000
      );
      if (existingById) {
        logger.info(`Duplicate message detected by threadId, skipping: ${msg.threadId}`);
        return null;
      }
    }
    
    // Fallback: Check for duplicates based on subject + from hash
    const msgHash = `${msg.platform}:${msg.from}:${msg.subject || ''}`;
    const existing = this.messages.find(m => 
      `${m.platform}:${m.from}:${m.subject || ''}` === msgHash &&
      new Date().getTime() - new Date(m.timestamp).getTime() < 24 * 60 * 60 * 1000
    );
    
    if (existing) {
      logger.info(`Duplicate message detected by hash, skipping. Hash: ${msgHash}`);
      return null;
    }
    
    const message: InboxMessage = {
      ...msg,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      read: false,
      analyzed: false
    };

    this.messages.push(message);
    logger.info(`Message added to messages array. Total messages: ${this.messages.length}`);
    
    this.updateThread(message);
    this.saveToMemory();
    
    logger.info(`Message saved. ID: ${message.id}`);
    return message;
  }

  /**
   * Get all unread messages
   */
  getUnread(): InboxMessage[] {
    return this.messages.filter(m => !m.read).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Get all messages (paginated)
   */
  getMessages(limit = 50, offset = 0): InboxMessage[] {
    return this.messages
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(offset, offset + limit);
  }

  /**
   * Get messages by thread
   */
  getThread(threadId: string): MessageThread | undefined {
    return this.threads.get(threadId);
  }

  /**
   * Get all threads
   */
  getThreads(): MessageThread[] {
    return Array.from(this.threads.values())
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }

  /**
   * Mark message as read
   */
  markAsRead(messageId: string): void {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg) {
      msg.read = true;
      this.updateThreadUnreadCount(msg.threadId);
      this.saveToMemory();
    }
  }

  /**
   * Mark all messages in thread as read
   */
  markThreadAsRead(threadId: string): void {
    this.messages
      .filter(m => m.threadId === threadId)
      .forEach(m => m.read = true);
    
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.unreadCount = 0;
    }
    this.saveToMemory();
  }

  /**
   * Store AI analysis of message
   */
  setAnalysis(messageId: string, analysis: string, suggestedReply?: string): void {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg) {
      msg.analysis = analysis;
      msg.suggestedReply = suggestedReply;
      msg.analyzed = true;
      this.saveToMemory();
    }
  }

  /**
   * Get unread count
   */
  getUnreadCount(): number {
    return this.messages.filter(m => !m.read).length;
  }

  /**
   * Get unread count by platform
   */
  getUnreadByPlatform(): Record<string, number> {
    const counts: Record<string, number> = {};
    this.messages.filter(m => !m.read).forEach(m => {
      counts[m.platform] = (counts[m.platform] || 0) + 1;
    });
    return counts;
  }

  /**
   * Delete old messages (keep last 1000)
   */
  cleanup(): void {
    if (this.messages.length > 1000) {
      this.messages = this.messages
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 1000);
      this.rebuildThreads();
      this.saveToMemory();
    }
  }

  private updateThread(message: InboxMessage): void {
    const threadId = message.threadId || message.id;
    let thread = this.threads.get(threadId);
    
    if (!thread) {
      thread = {
        id: threadId,
        platform: message.platform,
        participants: [message.from, message.to],
        subject: message.subject,
        lastMessageAt: message.timestamp,
        unreadCount: message.read ? 0 : 1,
        messages: []
      };
      this.threads.set(threadId, thread);
    }
    
    thread.messages.push(message);
    thread.lastMessageAt = message.timestamp;
    if (!message.read) {
      thread.unreadCount++;
    }
    
    message.threadId = threadId;
  }

  private updateThreadUnreadCount(threadId?: string): void {
    if (!threadId) return;
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.unreadCount = thread.messages.filter(m => !m.read).length;
    }
  }

  private rebuildThreads(): void {
    this.threads.clear();
    this.messages.forEach(m => this.updateThread(m));
  }

  private saveToMemory(): void {
    this.memory.store('inbox_messages', JSON.stringify(this.messages), 'inbox');
    this.memory.store('inbox_threads', JSON.stringify(Array.from(this.threads.values())), 'inbox');
  }

  private loadFromMemory(): void {
    const saved = this.memory.search('inbox_messages', undefined, 1)[0];
    if (saved && saved.value) {
      try {
        this.messages = JSON.parse(saved.value);
        this.rebuildThreads();
      } catch {
        this.messages = [];
      }
    }
  }
}
