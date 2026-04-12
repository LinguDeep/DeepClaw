/**
 * Session Memory - Short-term contextual memory for active sessions
 * 
 * Core capabilities:
 * - Short-term Memory: Tracks current session history, prevents repeating mistakes
 * - Action History: Remembers what has been tried and what worked/failed
 * - Context Window: Maintains relevant context within token limits
 * - Learning: Extracts patterns from sessions to improve long-term memory
 */

import { getLogger } from './logger';
import { LongTermMemory } from './longterm-memory';

const logger = getLogger();

// ==================== Types ====================

export interface SessionEntry {
  id: string;
  timestamp: Date;
  type: 'user_input' | 'agent_thought' | 'action' | 'action_result' | 'error' | 'correction' | 'context';
  content: string;
  metadata?: Record<string, any>;
  tokenEstimate?: number;
}

export interface ActionAttempt {
  action: string;
  input: string;
  output?: string;
  success: boolean;
  timestamp: Date;
  duration?: number;
  error?: string;
}

export interface SessionContext {
  task: string;
  entries: SessionEntry[];
  actionHistory: ActionAttempt[];
  failedAttempts: Map<string, number>; // action signature → failure count
  discoveredFacts: string[];
  currentFocus: string;
  tokensUsed: number;
}

export interface SessionMemoryConfig {
  maxEntries: number;
  maxTokens: number;
  maxActionHistory: number;
  maxFailedAttempts: number;
  enableLearning: boolean;
  summaryThreshold: number; // summarize when entries exceed this
}

const DEFAULT_CONFIG: SessionMemoryConfig = {
  maxEntries: 200,
  maxTokens: 16000,
  maxActionHistory: 100,
  maxFailedAttempts: 3,
  enableLearning: true,
  summaryThreshold: 50,
};

// ==================== Session Memory ====================

export class SessionMemory {
  private config: SessionMemoryConfig;
  private sessions: Map<string, SessionContext> = new Map();
  private activeSessionId: string | null = null;
  private longTermMemory: LongTermMemory | null = null;
  private idCounter: number = 0;

  constructor(config?: Partial<SessionMemoryConfig>, longTermMemory?: LongTermMemory) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.longTermMemory = longTermMemory || null;
  }

  /**
   * Start a new session
   */
  startSession(task: string, sessionId?: string): string {
    const id = sessionId || `sess-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    this.sessions.set(id, {
      task,
      entries: [],
      actionHistory: [],
      failedAttempts: new Map(),
      discoveredFacts: [],
      currentFocus: task,
      tokensUsed: 0,
    });

    this.activeSessionId = id;
    this.addEntry(id, 'context', `Session started for task: ${task}`);

    // Load relevant context from long-term memory
    if (this.longTermMemory) {
      const pastKnowledge = this.longTermMemory.search(task, 'learned_patterns', 5);
      if (pastKnowledge.length > 0) {
        for (const item of pastKnowledge) {
          this.addEntry(id, 'context', `Past knowledge: ${JSON.stringify(item.value).substring(0, 300)}`, {
            source: 'long_term_memory',
          });
        }
        logger.info(`[SessionMemory] Loaded ${pastKnowledge.length} relevant memories for session`);
      }
    }

    logger.info(`[SessionMemory] Session started: ${id}`);
    return id;
  }

  /**
   * End a session and optionally learn from it
   */
  endSession(sessionId?: string): void {
    const sid = sessionId || this.activeSessionId;
    if (!sid) return;

    const session = this.sessions.get(sid);
    if (!session) return;

    // Extract learnings and save to long-term memory
    if (this.config.enableLearning && this.longTermMemory && session.actionHistory.length > 0) {
      this.extractLearnings(sid, session);
    }

    if (this.activeSessionId === sid) {
      this.activeSessionId = null;
    }

    logger.info(`[SessionMemory] Session ended: ${sid} (${session.entries.length} entries, ${session.actionHistory.length} actions)`);
  }

  /**
   * Add an entry to the session
   */
  addEntry(sessionId: string | null, type: SessionEntry['type'], content: string, metadata?: Record<string, any>): SessionEntry {
    const sid = sessionId || this.activeSessionId;
    const session = sid ? this.sessions.get(sid) : null;

    const entry: SessionEntry = {
      id: `entry-${++this.idCounter}`,
      timestamp: new Date(),
      type,
      content,
      metadata,
      tokenEstimate: Math.ceil(content.length / 4), // rough estimate
    };

    if (session) {
      session.entries.push(entry);
      session.tokensUsed += entry.tokenEstimate || 0;

      // Compact if over limits
      if (session.entries.length > this.config.maxEntries) {
        this.compactSession(sid!);
      }
      if (session.tokensUsed > this.config.maxTokens) {
        this.compactSession(sid!);
      }
    }

    return entry;
  }

  /**
   * Record an action attempt
   */
  recordAction(sessionId: string | null, action: string, input: string, success: boolean, output?: string, error?: string, duration?: number): void {
    const sid = sessionId || this.activeSessionId;
    const session = sid ? this.sessions.get(sid) : null;
    if (!session) return;

    const attempt: ActionAttempt = {
      action,
      input: input.substring(0, 1000),
      output: output?.substring(0, 2000),
      success,
      timestamp: new Date(),
      duration,
      error,
    };

    session.actionHistory.push(attempt);

    // Track failed attempts
    if (!success) {
      const signature = `${action}:${input.substring(0, 200)}`;
      const count = (session.failedAttempts.get(signature) || 0) + 1;
      session.failedAttempts.set(signature, count);

      this.addEntry(sid, 'error', `Action failed (attempt ${count}): ${action} — ${error || 'unknown error'}`, {
        action,
        attemptCount: count,
      });
    } else {
      this.addEntry(sid, 'action_result', `Action succeeded: ${action} — ${(output || '').substring(0, 200)}`, {
        action,
        duration,
      });
    }

    // Trim action history
    if (session.actionHistory.length > this.config.maxActionHistory) {
      session.actionHistory = session.actionHistory.slice(-this.config.maxActionHistory);
    }
  }

  /**
   * Check if an action has been tried too many times
   */
  shouldAvoid(sessionId: string | null, action: string, input: string): { avoid: boolean; reason?: string; attempts: number } {
    const sid = sessionId || this.activeSessionId;
    const session = sid ? this.sessions.get(sid) : null;
    if (!session) return { avoid: false, attempts: 0 };

    const signature = `${action}:${input.substring(0, 200)}`;
    const count = session.failedAttempts.get(signature) || 0;

    if (count >= this.config.maxFailedAttempts) {
      return {
        avoid: true,
        reason: `This action has failed ${count} times already. Try a different approach.`,
        attempts: count,
      };
    }

    return { avoid: false, attempts: count };
  }

  /**
   * Add a discovered fact
   */
  addFact(sessionId: string | null, fact: string): void {
    const sid = sessionId || this.activeSessionId;
    const session = sid ? this.sessions.get(sid) : null;
    if (!session) return;

    if (!session.discoveredFacts.includes(fact)) {
      session.discoveredFacts.push(fact);
      this.addEntry(sid, 'context', `Discovered: ${fact}`);
    }
  }

  /**
   * Update the current focus
   */
  setFocus(sessionId: string | null, focus: string): void {
    const sid = sessionId || this.activeSessionId;
    const session = sid ? this.sessions.get(sid) : null;
    if (!session) return;

    session.currentFocus = focus;
    this.addEntry(sid, 'context', `Focus shifted to: ${focus}`);
  }

  /**
   * Get context string for LLM prompt
   */
  getContextForLLM(sessionId?: string, maxTokens?: number): string {
    const sid = sessionId || this.activeSessionId;
    const session = sid ? this.sessions.get(sid) : null;
    if (!session) return '';

    const limit = maxTokens || this.config.maxTokens;
    const parts: string[] = [];
    let tokens = 0;

    // Task and focus
    parts.push(`Current task: ${session.task}`);
    parts.push(`Current focus: ${session.currentFocus}`);
    tokens += Math.ceil((session.task.length + session.currentFocus.length) / 4);

    // Discovered facts
    if (session.discoveredFacts.length > 0) {
      parts.push(`\nDiscovered facts:`);
      for (const fact of session.discoveredFacts.slice(-10)) {
        parts.push(`  - ${fact}`);
        tokens += Math.ceil(fact.length / 4);
      }
    }

    // Failed attempts warning
    if (session.failedAttempts.size > 0) {
      parts.push(`\nFailed approaches (avoid these):`);
      for (const [sig, count] of session.failedAttempts) {
        if (count >= 2) {
          parts.push(`  - ${sig.substring(0, 100)} (failed ${count}x)`);
          tokens += 30;
        }
      }
    }

    // Recent entries (most recent first, within token budget)
    parts.push(`\nRecent activity:`);
    const recentEntries = session.entries.slice(-30).reverse();
    for (const entry of recentEntries) {
      const line = `  [${entry.type}] ${entry.content.substring(0, 300)}`;
      const lineTokens = Math.ceil(line.length / 4);
      if (tokens + lineTokens > limit) break;
      parts.push(line);
      tokens += lineTokens;
    }

    return parts.join('\n');
  }

  /**
   * Get action history for a session
   */
  getActionHistory(sessionId?: string): ActionAttempt[] {
    const sid = sessionId || this.activeSessionId;
    const session = sid ? this.sessions.get(sid) : null;
    return session?.actionHistory || [];
  }

  /**
   * Get session stats
   */
  getStats(sessionId?: string): {
    entries: number;
    actions: number;
    failedActions: number;
    facts: number;
    tokensUsed: number;
  } {
    const sid = sessionId || this.activeSessionId;
    const session = sid ? this.sessions.get(sid) : null;
    if (!session) return { entries: 0, actions: 0, failedActions: 0, facts: 0, tokensUsed: 0 };

    return {
      entries: session.entries.length,
      actions: session.actionHistory.length,
      failedActions: session.actionHistory.filter(a => !a.success).length,
      facts: session.discoveredFacts.length,
      tokensUsed: session.tokensUsed,
    };
  }

  /**
   * Compact session by summarizing old entries
   */
  private compactSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Keep last 30% of entries, summarize the rest
    const keepCount = Math.max(20, Math.floor(session.entries.length * 0.3));
    const toSummarize = session.entries.slice(0, session.entries.length - keepCount);
    const toKeep = session.entries.slice(-keepCount);

    // Create a summary entry
    const actionCount = toSummarize.filter(e => e.type === 'action' || e.type === 'action_result').length;
    const errorCount = toSummarize.filter(e => e.type === 'error').length;
    const summary = `[Session compacted] ${toSummarize.length} older entries summarized: ${actionCount} actions, ${errorCount} errors`;

    session.entries = [
      {
        id: `entry-summary-${Date.now()}`,
        timestamp: new Date(),
        type: 'context',
        content: summary,
        tokenEstimate: Math.ceil(summary.length / 4),
      },
      ...toKeep,
    ];

    session.tokensUsed = session.entries.reduce((sum, e) => sum + (e.tokenEstimate || 0), 0);
    logger.info(`[SessionMemory] Compacted session ${sessionId}: ${toSummarize.length} entries summarized`);
  }

  /**
   * Extract learnings from a session and save to long-term memory
   */
  private extractLearnings(sessionId: string, session: SessionContext): void {
    if (!this.longTermMemory) return;

    // Learn from successful action patterns
    const successfulActions = session.actionHistory.filter(a => a.success);
    const failedActions = session.actionHistory.filter(a => !a.success);

    if (successfulActions.length > 0) {
      const patterns = successfulActions.map(a => `${a.action}: ${a.input.substring(0, 100)}`).join('; ');
      this.longTermMemory.store(
        `learned:${sessionId}:success`,
        {
          task: session.task,
          successfulApproaches: patterns,
          totalActions: session.actionHistory.length,
          successRate: successfulActions.length / session.actionHistory.length,
          timestamp: new Date().toISOString(),
        },
        'learned_patterns',
        ['session_learning', 'success_pattern'],
        30 // 30 day TTL
      );
    }

    // Learn from repeated failures
    for (const [signature, count] of session.failedAttempts) {
      if (count >= 2) {
        this.longTermMemory.store(
          `learned:${sessionId}:avoid:${signature.substring(0, 50)}`,
          {
            task: session.task,
            failedApproach: signature,
            failureCount: count,
            timestamp: new Date().toISOString(),
          },
          'learned_patterns',
          ['session_learning', 'failure_pattern'],
          14 // 14 day TTL
        );
      }
    }

    // Store discovered facts
    if (session.discoveredFacts.length > 0) {
      this.longTermMemory.store(
        `facts:${sessionId}`,
        {
          task: session.task,
          facts: session.discoveredFacts,
          timestamp: new Date().toISOString(),
        },
        'discovered_facts',
        ['session_learning', 'facts'],
        60 // 60 day TTL
      );
    }

    logger.info(`[SessionMemory] Extracted learnings from session ${sessionId}`);
  }

  /**
   * Get active session ID
   */
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }
}

// ==================== Singleton ====================

let instance: SessionMemory | null = null;

export function getSessionMemory(config?: Partial<SessionMemoryConfig>, longTermMemory?: LongTermMemory): SessionMemory {
  if (!instance) {
    instance = new SessionMemory(config, longTermMemory);
  }
  return instance;
}
