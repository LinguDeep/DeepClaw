/**
 * Core types and interfaces for LinguClaw
 * Equivalent to Python dataclasses and type definitions
 */

// ==================== Provider Types ====================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model: string;
  finish_reason?: string | null;
  error?: string | null;
}

export interface TokenBudget {
  max_total: number;
  used: number;
  reserved: number;
  threshold: number;
}

export enum ProviderType {
  OPENROUTER = 'openrouter',
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  OLLAMA = 'ollama',
  LMSTUDIO = 'lmstudio',
  CUSTOM = 'custom'
}

// ==================== Orchestrator Types ====================

export enum AgentRole {
  PLANNER = 'planner',
  EXECUTOR = 'executor',
  REVIEWER = 'reviewer'
}

export enum StepStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying'
}

export interface PlanStep {
  id: string;
  description: string;
  agent: AgentRole;
  status: StepStatus;
  dependencies: string[];
  result?: any;
  error?: string | null;
  retry_count: number;
  max_retries: number;
}

export interface SharedState {
  task: string;
  plan: PlanStep[];
  current_step_idx: number;
  execution_log: ExecutionRecord[];
  files_modified: string[];
  context: Map<string, any>;
  iteration: number;
  max_iterations: number;
  aborted: boolean;
}

export interface ExecutionRecord {
  iteration: number;
  timestamp: Date;
  role: AgentRole;
  content: string;
  action: string;
  result: string;
  status: 'success' | 'error' | 'blocked';
}

// ==================== Tool Types ====================

export interface CommandResult {
  stdout: string;
  stderr: string;
  returncode: number;
  sandboxed: boolean;
}

export interface FileResult {
  success: boolean;
  content?: string | null;
  error?: string | null;
}

// ==================== Safety Types ====================

export interface SafetyResult {
  allowed: boolean;
  risk_score: number;
  reason: string;
}

export enum RiskLevel {
  CRITICAL = 100,
  HIGH = 90,
  ELEVATED = 70,
  MODERATE = 50,
  LOW = 35,
  MINIMAL = 10
}

// ==================== Memory Types ====================

export interface MemoryEntry {
  key: string;
  value: any;
  category: string;
  timestamp: Date;
  access_count: number;
  last_accessed: Date;
  tags: string[];
  expires_at?: Date | null;
}

export interface CodeChunk {
  id: string;
  file_path: string;
  chunk_type: 'function' | 'class' | 'module' | 'other';
  name: string;
  content: string;
  embedding?: number[];
  line_start: number;
  line_end: number;
}

// ==================== Plugin Types ====================

export interface PluginConfig {
  enabled: boolean;
  settings: Record<string, any>;
}

export interface PluginContext {
  config: PluginConfig;
  logger: Logger;
  memory_dir: string;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  author: string;
  dependencies: string[];
}

// ==================== Messaging Types ====================

export enum MessagingPlatform {
  WHATSAPP = 'whatsapp',
  TELEGRAM = 'telegram',
  DISCORD = 'discord',
  SLACK = 'slack'
}

export interface ChatMessage {
  platform: MessagingPlatform;
  user_id: string;
  username: string;
  content: string;
  timestamp: Date;
  chat_id?: string;
  reply_to?: string | null;
  metadata: Record<string, any>;
}

export interface ChatResponse {
  content: string;
  platform: MessagingPlatform;
  chat_id: string;
  user_id?: string | null;
  thread_id?: string | null;
  actions: Record<string, any>[];
}

// ==================== Skills Types ====================

export enum SkillType {
  PYTHON = 'python',
  JAVASCRIPT = 'javascript',
  SHELL = 'shell',
  API = 'api'
}

export interface SkillResult {
  success: boolean;
  output?: any;
  error?: string | null;
  metadata?: Record<string, any>;
}

export interface SkillSchema {
  name: string;
  description: string;
  version: string;
  type: SkillType;
  parameters: Record<string, any>;
}

// ==================== Proactive Types ====================

export enum TriggerType {
  TIME = 'time',
  INTERVAL = 'interval',
  EVENT = 'event',
  CONDITION = 'condition'
}

export enum ActionType {
  REMINDER = 'reminder',
  ALERT = 'alert',
  BRIEFING = 'briefing',
  TASK = 'task',
  NOTIFICATION = 'notification',
  MESSAGE = 'message'
}

export interface ProactiveTask {
  id: string;
  name: string;
  description: string;
  trigger_type: TriggerType;
  trigger_config: Record<string, any>;
  action_type: ActionType;
  action_config: Record<string, any>;
  enabled: boolean;
  last_run?: Date | null;
  run_count: number;
  created_at: Date;
  tags: string[];
}

// ==================== Privacy Types ====================

export enum DataRetention {
  FOREVER = 'forever',
  THIRTY_DAYS = '30d',
  SEVEN_DAYS = '7d',
  SESSION = 'session',
  NONE = 'none'
}

export enum LogLevel {
  NONE = 'none',
  ERRORS_ONLY = 'errors',
  MINIMAL = 'minimal',
  FULL = 'full'
}

export interface PrivacySettings {
  conversation_retention: DataRetention;
  memory_retention: DataRetention;
  log_retention: DataRetention;
  log_level: LogLevel;
  log_to_cloud: boolean;
  share_analytics: boolean;
  share_crashes: boolean;
  allow_remote_commands: boolean;
  prefer_local_models: boolean;
  offline_mode: boolean;
  encrypt_memory: boolean;
  encrypt_logs: boolean;
  secure_delete: boolean;
  require_auth: boolean;
  allowed_users: string[];
  admin_users: string[];
  data_dir: string;
}

// ==================== Logger Interface ====================

export interface Logger {
  debug: (message: string, ...meta: any[]) => void;
  info: (message: string, ...meta: any[]) => void;
  warn: (message: string, ...meta: any[]) => void;
  error: (message: string, ...meta: any[]) => void;
}

// ==================== Sandbox Types ====================

export interface SandboxConfig {
  image: string;
  memory_limit: string;
  cpu_limit: number;
  auto_remove: boolean;
  network_disabled?: boolean;
}

export interface SandboxExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

// ==================== Prism Types ====================

export interface FacetResult {
  output: string;
  confidence: number;
  next_facet?: string | null;
  complete: boolean;
}

export interface Branch {
  id: string;
  name: string;
  strategy: 'conservative' | 'experimental' | 'custom';
  risk_threshold: number;
  result?: any;
  fitness: number;
}

// ==================== Daemon Types ====================

export interface DaemonStatus {
  running: boolean;
  started_at?: Date | null;
  uptime_seconds: number;
  tasks_processed: number;
  errors_count: number;
  active_services: string[];
}

// ==================== UI Types ====================

export interface DashboardState {
  current_task: string;
  steps: PlanStep[];
  logs: ExecutionRecord[];
  stats: {
    tokens_used: number;
    commands_run: number;
    iterations: number;
  };
}

export interface WebSocketMessage {
  type: 'state_update' | 'log' | 'thought' | 'error' | 'complete';
  payload: any;
  timestamp: Date;
}
