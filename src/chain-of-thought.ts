/**
 * Chain of Thought - Transparent reasoning and action tracking system
 * 
 * Core capabilities:
 * - Thought Logs: See exactly what the agent is "thinking"
 * - Action Tracking: Real-time visibility into which tools are being used
 * - Reasoning Chain: Full audit trail of decisions and their outcomes
 * - Event Streaming: WebSocket-compatible event emission for live UI updates
 */

import { EventEmitter } from 'events';
import { getLogger } from './logger';

const logger = getLogger();

// ==================== Types ====================

export type ThoughtType = 
  | 'reasoning'     // Agent is analyzing/thinking
  | 'planning'      // Creating or adjusting a plan
  | 'observation'   // Noting something from the environment
  | 'decision'      // Making a choice between alternatives
  | 'reflection'    // Evaluating own performance
  | 'correction'    // Self-correcting after an error
  | 'hypothesis'    // Forming a hypothesis to test
  | 'conclusion';   // Reaching a final conclusion

export type ActionStatus = 'started' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ThoughtEntry {
  id: string;
  sessionId: string;
  timestamp: Date;
  type: ThoughtType;
  content: string;
  confidence?: number; // 0-1, how confident the agent is
  relatedActionId?: string;
  parentThoughtId?: string;
  metadata?: Record<string, any>;
}

export interface ActionEntry {
  id: string;
  sessionId: string;
  timestamp: Date;
  tool: string; // e.g., 'shell', 'browser', 'filesystem', 'code_sandbox', 'llm', 'search'
  operation: string; // e.g., 'run', 'browse', 'read', 'execute', 'complete'
  input: string;
  output?: string;
  status: ActionStatus;
  duration?: number; // milliseconds
  error?: string;
  metadata?: Record<string, any>;
}

export interface ReasoningStep {
  thought: ThoughtEntry;
  action?: ActionEntry;
  result?: string;
}

export interface SessionSummary {
  sessionId: string;
  task: string;
  startedAt: Date;
  endedAt?: Date;
  totalThoughts: number;
  totalActions: number;
  failedActions: number;
  corrections: number;
  reasoningChain: ReasoningStep[];
  finalConclusion?: string;
}

export interface ChainOfThoughtConfig {
  maxThoughtsPerSession: number;
  maxActionsPerSession: number;
  enableStreaming: boolean;
  verboseLogging: boolean;
  persistToDisk: boolean;
  persistPath?: string;
}

const DEFAULT_CONFIG: ChainOfThoughtConfig = {
  maxThoughtsPerSession: 500,
  maxActionsPerSession: 200,
  enableStreaming: true,
  verboseLogging: false,
  persistToDisk: false,
};

// ==================== Chain of Thought Engine ====================

export class ChainOfThought extends EventEmitter {
  private config: ChainOfThoughtConfig;
  private sessions: Map<string, {
    task: string;
    startedAt: Date;
    thoughts: ThoughtEntry[];
    actions: ActionEntry[];
    chain: ReasoningStep[];
  }> = new Map();
  private activeSession: string | null = null;
  private idCounter: number = 0;

  constructor(config?: Partial<ChainOfThoughtConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start a new reasoning session
   */
  startSession(task: string, sessionId?: string): string {
    const id = sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    
    this.sessions.set(id, {
      task,
      startedAt: new Date(),
      thoughts: [],
      actions: [],
      chain: [],
    });
    
    this.activeSession = id;
    
    this.emit('session:start', { sessionId: id, task });
    logger.info(`[CoT] Session started: ${id} — "${task.substring(0, 100)}"`);
    
    return id;
  }

  /**
   * End a reasoning session
   */
  endSession(sessionId?: string, conclusion?: string): SessionSummary | null {
    const sid = sessionId || this.activeSession;
    if (!sid) return null;

    const session = this.sessions.get(sid);
    if (!session) return null;

    if (conclusion) {
      this.think(sid, 'conclusion', conclusion);
    }

    const summary: SessionSummary = {
      sessionId: sid,
      task: session.task,
      startedAt: session.startedAt,
      endedAt: new Date(),
      totalThoughts: session.thoughts.length,
      totalActions: session.actions.length,
      failedActions: session.actions.filter(a => a.status === 'failed').length,
      corrections: session.thoughts.filter(t => t.type === 'correction').length,
      reasoningChain: session.chain,
      finalConclusion: conclusion,
    };

    this.emit('session:end', summary);
    logger.info(`[CoT] Session ended: ${sid} — ${summary.totalThoughts} thoughts, ${summary.totalActions} actions`);

    if (this.activeSession === sid) {
      this.activeSession = null;
    }

    return summary;
  }

  /**
   * Record a thought
   */
  think(sessionId: string | null, type: ThoughtType, content: string, meta?: {
    confidence?: number;
    relatedActionId?: string;
    parentThoughtId?: string;
    metadata?: Record<string, any>;
  }): ThoughtEntry {
    const sid = sessionId || this.activeSession;
    const session = sid ? this.sessions.get(sid) : null;

    const thought: ThoughtEntry = {
      id: `thought-${++this.idCounter}`,
      sessionId: sid || 'unknown',
      timestamp: new Date(),
      type,
      content,
      confidence: meta?.confidence,
      relatedActionId: meta?.relatedActionId,
      parentThoughtId: meta?.parentThoughtId,
      metadata: meta?.metadata,
    };

    if (session) {
      if (session.thoughts.length < this.config.maxThoughtsPerSession) {
        session.thoughts.push(thought);
      }
      session.chain.push({ thought });
    }

    if (this.config.enableStreaming) {
      this.emit('thought', thought);
    }

    if (this.config.verboseLogging) {
      logger.info(`[CoT] 💭 [${type}] ${content.substring(0, 150)}`);
    }

    return thought;
  }

  /**
   * Record an action start
   */
  startAction(sessionId: string | null, tool: string, operation: string, input: string, metadata?: Record<string, any>): ActionEntry {
    const sid = sessionId || this.activeSession;
    const session = sid ? this.sessions.get(sid) : null;

    const action: ActionEntry = {
      id: `action-${++this.idCounter}`,
      sessionId: sid || 'unknown',
      timestamp: new Date(),
      tool,
      operation,
      input: input.substring(0, 2000),
      status: 'started',
      metadata,
    };

    if (session) {
      if (session.actions.length < this.config.maxActionsPerSession) {
        session.actions.push(action);
      }
      // Attach to last reasoning step or create new one
      const lastStep = session.chain[session.chain.length - 1];
      if (lastStep && !lastStep.action) {
        lastStep.action = action;
      } else {
        session.chain.push({
          thought: {
            id: `thought-${++this.idCounter}`,
            sessionId: sid || 'unknown',
            timestamp: new Date(),
            type: 'observation',
            content: `Executing ${tool}.${operation}`,
            relatedActionId: action.id,
          },
          action,
        });
      }
    }

    if (this.config.enableStreaming) {
      this.emit('action:start', action);
    }

    if (this.config.verboseLogging) {
      logger.info(`[CoT] 🔧 [${tool}.${operation}] ${input.substring(0, 100)}`);
    }

    return action;
  }

  /**
   * Update an action's status
   */
  updateAction(actionId: string, update: {
    status?: ActionStatus;
    output?: string;
    error?: string;
    duration?: number;
  }): ActionEntry | null {
    for (const session of this.sessions.values()) {
      const action = session.actions.find(a => a.id === actionId);
      if (action) {
        if (update.status) action.status = update.status;
        if (update.output !== undefined) action.output = update.output.substring(0, 5000);
        if (update.error !== undefined) action.error = update.error;
        if (update.duration !== undefined) action.duration = update.duration;

        if (this.config.enableStreaming) {
          this.emit('action:update', action);
        }

        // Update the chain step result
        const step = session.chain.find(s => s.action?.id === actionId);
        if (step) {
          step.result = update.output || update.error;
        }

        return action;
      }
    }
    return null;
  }

  /**
   * Complete an action
   */
  completeAction(actionId: string, output: string, startTime?: number): ActionEntry | null {
    return this.updateAction(actionId, {
      status: 'completed',
      output,
      duration: startTime ? Date.now() - startTime : undefined,
    });
  }

  /**
   * Fail an action
   */
  failAction(actionId: string, error: string, startTime?: number): ActionEntry | null {
    return this.updateAction(actionId, {
      status: 'failed',
      error,
      duration: startTime ? Date.now() - startTime : undefined,
    });
  }

  /**
   * Get the full reasoning chain for a session
   */
  getChain(sessionId?: string): ReasoningStep[] {
    const sid = sessionId || this.activeSession;
    if (!sid) return [];
    return this.sessions.get(sid)?.chain || [];
  }

  /**
   * Get all thoughts for a session
   */
  getThoughts(sessionId?: string, type?: ThoughtType): ThoughtEntry[] {
    const sid = sessionId || this.activeSession;
    if (!sid) return [];
    const thoughts = this.sessions.get(sid)?.thoughts || [];
    if (type) return thoughts.filter(t => t.type === type);
    return thoughts;
  }

  /**
   * Get all actions for a session
   */
  getActions(sessionId?: string, tool?: string): ActionEntry[] {
    const sid = sessionId || this.activeSession;
    if (!sid) return [];
    const actions = this.sessions.get(sid)?.actions || [];
    if (tool) return actions.filter(a => a.tool === tool);
    return actions;
  }

  /**
   * Get session summary without ending it
   */
  getSessionSummary(sessionId?: string): SessionSummary | null {
    const sid = sessionId || this.activeSession;
    if (!sid) return null;

    const session = this.sessions.get(sid);
    if (!session) return null;

    return {
      sessionId: sid,
      task: session.task,
      startedAt: session.startedAt,
      totalThoughts: session.thoughts.length,
      totalActions: session.actions.length,
      failedActions: session.actions.filter(a => a.status === 'failed').length,
      corrections: session.thoughts.filter(t => t.type === 'correction').length,
      reasoningChain: session.chain,
    };
  }

  /**
   * Get a human-readable reasoning trace
   */
  getReadableTrace(sessionId?: string): string {
    const chain = this.getChain(sessionId);
    if (chain.length === 0) return 'No reasoning trace available.';

    const lines: string[] = [];
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      const idx = i + 1;

      // Thought
      const typeEmoji = {
        reasoning: '🧠',
        planning: '📋',
        observation: '👁️',
        decision: '⚖️',
        reflection: '🪞',
        correction: '🔄',
        hypothesis: '💡',
        conclusion: '✅',
      }[step.thought.type] || '💭';
      
      lines.push(`${idx}. ${typeEmoji} [${step.thought.type.toUpperCase()}] ${step.thought.content}`);

      // Action
      if (step.action) {
        const statusEmoji = {
          started: '⏳',
          running: '🔄',
          completed: '✅',
          failed: '❌',
          cancelled: '🚫',
        }[step.action.status] || '❓';

        lines.push(`   ${statusEmoji} ${step.action.tool}.${step.action.operation}: ${step.action.input.substring(0, 100)}`);
        
        if (step.action.output) {
          lines.push(`   → ${step.action.output.substring(0, 200)}`);
        }
        if (step.action.error) {
          lines.push(`   ✗ ${step.action.error.substring(0, 200)}`);
        }
        if (step.action.duration) {
          lines.push(`   ⏱ ${step.action.duration}ms`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get active session ID
   */
  getActiveSessionId(): string | null {
    return this.activeSession;
  }

  /**
   * Clean up old sessions
   */
  cleanup(maxAge: number = 3600000): void { // default 1 hour
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.startedAt.getTime() > maxAge && id !== this.activeSession) {
        this.sessions.delete(id);
      }
    }
  }
}

// ==================== Singleton ====================

let instance: ChainOfThought | null = null;

export function getChainOfThought(config?: Partial<ChainOfThoughtConfig>): ChainOfThought {
  if (!instance) {
    instance = new ChainOfThought(config);
  }
  return instance;
}
