/**
 * Resilience patterns for LLM operations
 * - Circuit breaker
 * - Exponential backoff with jitter
 * - Adaptive retry based on error type
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableStatuses: number[]; // HTTP status codes to retry
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  retryableStatuses: [429, 500, 502, 503, 504],
};

/**
 * Execute function with exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  operationName: string = 'operation'
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const result = await fn();
      
      // Log success after retry
      if (attempt > 0) {
        logger.info(`${operationName} succeeded after ${attempt} retries`);
      }
      
      return result;
    } catch (error: any) {
      lastError = error;
      
      // Check if we should retry this error
      if (!shouldRetry(error, cfg, attempt)) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = calculateDelay(attempt, cfg);
      
      logger.warn(`${operationName} failed (attempt ${attempt + 1}/${cfg.maxRetries + 1}): ${error.message}. Retrying in ${delay}ms...`);
      
      await sleep(delay);
    }
  }

  throw lastError || new Error(`${operationName} failed after ${cfg.maxRetries} retries`);
}

/**
 * Determine if error is retryable
 */
function shouldRetry(error: any, config: RetryConfig, attempt: number): boolean {
  if (attempt >= config.maxRetries) {
    return false;
  }

  // Check HTTP status
  const status = error.response?.status || error.status;
  if (status && config.retryableStatuses.includes(status)) {
    return true;
  }

  // Check for specific error types
  const errorMessage = error.message?.toLowerCase() || '';
  const retryablePatterns = [
    'rate limit',
    'timeout',
    'econnreset',
    'econnrefused',
    'socket hang up',
    'network error',
    'temporary',
    'unavailable',
  ];

  if (retryablePatterns.some(p => errorMessage.includes(p))) {
    return true;
  }

  // Don't retry client errors (4xx except 429)
  if (status && status >= 400 && status < 500 && status !== 429) {
    return false;
  }

  return true;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff: baseDelay * (multiplier ^ attempt)
  let delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
  
  // Cap at max delay
  delay = Math.min(delay, config.maxDelayMs);
  
  // Add jitter (±25%) to avoid thundering herd
  if (config.jitter) {
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay += jitter;
  }
  
  return Math.floor(delay);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Circuit breaker pattern to prevent cascading failures
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 30000,
    private readonly name: string = 'circuit'
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'half-open';
        logger.info(`Circuit breaker ${this.name} entering half-open state`);
      } else {
        throw new Error(`Circuit breaker ${this.name} is open`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failures = 0;
      logger.info(`Circuit breaker ${this.name} closed`);
    } else {
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      logger.error(`Circuit breaker ${this.name} opened after ${this.failures} failures`);
    }
  }

  getState(): string {
    return this.state;
  }
}

/**
 * Timeout wrapper for async operations
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string = 'operation'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Adaptive retry config based on error type
 */
export function getAdaptiveRetryConfig(error: any): Partial<RetryConfig> {
  const status = error.response?.status || error.status;
  
  // Rate limiting - use longer delays
  if (status === 429 || error.message?.includes('rate limit')) {
    return {
      maxRetries: 5,
      baseDelayMs: 2000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
    };
  }
  
  // Server errors - moderate retry
  if (status && status >= 500) {
    return {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
    };
  }
  
  // Network errors - aggressive retry
  if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
    return {
      maxRetries: 5,
      baseDelayMs: 500,
      maxDelayMs: 10000,
    };
  }
  
  return {};
}
