/**
 * Safety middleware - Risk scoring and command validation
 * TypeScript equivalent of Python safety.py
 */

import { SafetyResult, RiskLevel } from './types';
import { getLogger } from './logger';

const logger = getLogger();

// Risk patterns matching the Python implementation
const RISK_PATTERNS: Array<{ pattern: RegExp; score: number; reason: string }> = [
  // CRITICAL (100) - Permanent system destruction
  { pattern: /rm\s+-r?f?\s+\/(?:\s|$)|rm\s+-f?r?\s+\/(?:\s|$)|mkfs\.|dd\s+if=.*of=\/dev\/sd|>:\(\)\s*\{.*:\}\&.*\;/, score: RiskLevel.CRITICAL, reason: 'System destruction detected' },
  
  // HIGH (90-95) - System-level dangerous operations
  { pattern: /diskutil\s+eraseDisk|csrutil\s+disable|reg\s+delete.*\/f/, score: RiskLevel.HIGH, reason: 'System-level modification' },
  { pattern: /chmod\s+(-R\s+)?777\s+\/|chmod\s+777\s+(-R\s+)?\//, score: RiskLevel.HIGH, reason: 'Global permission change' },
  
  // ELEVATED (70) - Network/download risks
  { pattern: /curl.*\|\s*(ba)?sh|wget.*\|\s*(ba)?sh|python.*-c.*import.*url/, score: RiskLevel.ELEVATED, reason: 'Download and execute pattern' },
  
  // MODERATE (50) - Package/system changes
  { pattern: /pip\s+install|npm\s+install.*-g|apt\s+install|brew\s+install/, score: RiskLevel.MODERATE, reason: 'Package installation' },
  { pattern: /systemctl\s+(start|stop|restart)|service\s+\w+\s+(start|stop)/, score: RiskLevel.MODERATE, reason: 'Service management' },
  
  // LOW (35) - Basic file operations
  { pattern: /rm\s+-rf|rmdir.*\/s|del\s+\/f\/s\/q/, score: RiskLevel.LOW, reason: 'File deletion' },
  { pattern: /mv\s+.*\/|move\s+.*\/.*\/s/, score: RiskLevel.LOW, reason: 'File move' },
];

// Allowed safe commands (override patterns)
const SAFE_COMMANDS: RegExp[] = [
  /git\s+(status|log|branch|diff|show)/,
  /ls\s+/,
  /pwd/,
  /cat\s+/,
  /echo\s+/,
  /grep\s+/,
];

export class SafetyMiddleware {
  private confirmedCommands: Set<string>;

  constructor() {
    this.confirmedCommands = new Set();
  }

  /**
   * Check command safety and return risk assessment
   */
  check(command: string): SafetyResult {
    // Check if command is in safe list
    for (const safe of SAFE_COMMANDS) {
      if (safe.test(command)) {
        return { allowed: true, risk_score: RiskLevel.MINIMAL, reason: 'Safe command' };
      }
    }

    // Check against risk patterns
    let maxScore = 0;
    let reason = 'Low risk';

    for (const { pattern, score, reason: patternReason } of RISK_PATTERNS) {
      if (pattern.test(command)) {
        if (score > maxScore) {
          maxScore = score;
          reason = patternReason;
        }
      }
    }

    // Determine if allowed based on score
    if (maxScore >= RiskLevel.CRITICAL) {
      return { allowed: false, risk_score: maxScore, reason: `BLOCKED: ${reason}` };
    }

    if (maxScore >= RiskLevel.HIGH) {
      return { allowed: false, risk_score: maxScore, reason: `BLOCKED: ${reason}` };
    }

    if (maxScore >= RiskLevel.ELEVATED) {
      // Requires explicit confirmation
      return { allowed: this.confirmedCommands.has(command), risk_score: maxScore, reason };
    }

    return { allowed: true, risk_score: maxScore || RiskLevel.MINIMAL, reason };
  }

  /**
   * Mark a command as confirmed for execution
   */
  confirm(command: string): void {
    this.confirmedCommands.add(command);
    logger.info(`Command confirmed: ${command}`);
  }

  /**
   * Get risk score for a command
   */
  getScore(command: string): number {
    const result = this.check(command);
    return result.risk_score;
  }

  /**
   * Check if command requires confirmation
   */
  needsConfirmation(command: string): boolean {
    const result = this.check(command);
    return result.risk_score >= RiskLevel.ELEVATED && !result.allowed;
  }
}

// Strict safety mode for fallback when Docker is unavailable
export class FallbackSafetyMode {
  private safety: SafetyMiddleware;
  private confirmed: boolean;

  constructor(safety: SafetyMiddleware, confirmed: boolean = false) {
    this.safety = safety;
    this.confirmed = confirmed;
  }

  /**
   * Check if command is allowed in strict mode
   */
  check(command: string): SafetyResult {
    const result = this.safety.check(command);
    
    if (!result.allowed && result.risk_score < RiskLevel.ELEVATED) {
      // In strict mode, moderate operations also require confirmation
      return { 
        allowed: this.confirmed, 
        risk_score: result.risk_score, 
        reason: `STRICT MODE: ${result.reason}` 
      };
    }

    return result;
  }

  /**
   * Prompt for user confirmation (returns true if confirmed)
   * In real implementation, this would use readline or similar
   */
  promptConfirmation(command: string): boolean {
    // In CLI mode, this would prompt the user
    // For now, auto-confirm in headless mode
    logger.warn(`Confirmation required for: ${command}`);
    return this.confirmed;
  }
}
