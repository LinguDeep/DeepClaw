/**
 * AlphaBeta - Branching Workflow with Merge Strategies
 * TypeScript equivalent of Python alphabeta.py
 */

import { getLogger } from './logger';

const logger = getLogger();

// Branch types
export type BranchStrategy = 'conservative' | 'experimental' | 'custom';

// Alpha branch (mainline)
export interface AlphaBranch {
  id: string;
  name: string;
  baseCommit: string;
  strategy: BranchStrategy;
  riskThreshold: number;
  changes: string[];
  tests: string[];
  fitness: number;
}

// Beta branch (experimental)
export interface BetaBranch {
  id: string;
  name: string;
  parentBranch: string;
  strategy: BranchStrategy;
  riskThreshold: number;
  changes: string[];
  tests: string[];
  fitness: number;
  merged: boolean;
}

// Merge result
export interface MergeResult {
  success: boolean;
  conflicts: string[];
  fitness: number;
  result: any;
}

// AlphaBeta workflow engine
export class AlphaBeta {
  alpha: AlphaBranch;
  betas: Map<string, BetaBranch>;
  mergeStrategy: 'auto' | 'manual' | 'conservative';

  constructor(alphaConfig?: Partial<AlphaBranch>) {
    this.alpha = {
      id: `alpha_${Date.now()}`,
      name: 'main',
      baseCommit: 'HEAD',
      strategy: 'conservative',
      riskThreshold: 30,
      changes: [],
      tests: [],
      fitness: 0,
      ...alphaConfig
    };
    this.betas = new Map();
    this.mergeStrategy = 'auto';
  }

  // Create a beta branch
  createBeta(strategy: BranchStrategy = 'experimental', parent: string = this.alpha.id): BetaBranch {
    const id = `beta_${Date.now()}_${this.betas.size}`;
    const beta: BetaBranch = {
      id,
      name: `${strategy}_${this.betas.size}`,
      parentBranch: parent,
      strategy,
      riskThreshold: strategy === 'conservative' ? 20 : strategy === 'experimental' ? 70 : 50,
      changes: [],
      tests: [],
      fitness: 0,
      merged: false
    };

    this.betas.set(id, beta);
    logger.info(`Created beta branch: ${id} (${strategy})`);
    return beta;
  }

  // Add change to branch
  addChange(branchId: string, change: string): void {
    if (branchId === this.alpha.id) {
      this.alpha.changes.push(change);
    } else {
      const beta = this.betas.get(branchId);
      if (beta) {
        beta.changes.push(change);
      }
    }
  }

  // Add test to branch
  addTest(branchId: string, test: string): void {
    if (branchId === this.alpha.id) {
      this.alpha.tests.push(test);
    } else {
      const beta = this.betas.get(branchId);
      if (beta) {
        beta.tests.push(test);
      }
    }
  }

  // Calculate fitness score
  calculateFitness(branchId: string): number {
    const branch = branchId === this.alpha.id ? this.alpha : this.betas.get(branchId);
    if (!branch) return 0;

    // Factors: change coverage, test count, risk level
    let score = 0;
    score += Math.min(branch.changes.length * 5, 30);  // Max 30 points for changes
    score += Math.min(branch.tests.length * 10, 40);   // Max 40 points for tests
    score += (100 - branch.riskThreshold) / 3;          // Lower risk = higher score

    branch.fitness = Math.min(score, 100);
    return branch.fitness;
  }

  // Merge beta into alpha
  merge(betaId: string): MergeResult {
    const beta = this.betas.get(betaId);
    if (!beta) {
      return { success: false, conflicts: ['Branch not found'], fitness: 0, result: null };
    }

    if (beta.merged) {
      return { success: false, conflicts: ['Already merged'], fitness: 0, result: null };
    }

    // Check merge strategy
    if (this.mergeStrategy === 'conservative' && beta.riskThreshold > 50) {
      return { success: false, conflicts: ['Risk too high for conservative merge'], fitness: 0, result: null };
    }

    // Detect conflicts
    const conflicts = this.detectConflicts(beta);
    if (conflicts.length > 0 && this.mergeStrategy === 'auto') {
      logger.warn(`Auto-merge blocked by conflicts: ${conflicts.join(', ')}`);
      return { success: false, conflicts, fitness: beta.fitness, result: null };
    }

    // Perform merge (avoid duplicates)
    const existingChanges = new Set(this.alpha.changes);
    const existingTests = new Set(this.alpha.tests);
    for (const change of beta.changes) {
      if (!existingChanges.has(change)) this.alpha.changes.push(change);
    }
    for (const test of beta.tests) {
      if (!existingTests.has(test)) this.alpha.tests.push(test);
    }
    beta.merged = true;

    // Recalculate fitness
    this.calculateFitness(this.alpha.id);

    logger.info(`Merged ${betaId} into alpha (fitness: ${this.alpha.fitness})`);

    return {
      success: true,
      conflicts: [],
      fitness: this.alpha.fitness,
      result: {
        changes: beta.changes.length,
        tests: beta.tests.length
      }
    };
  }

  // Detect merge conflicts
  private detectConflicts(beta: BetaBranch): string[] {
    const conflicts: string[] = [];

    // Check for duplicate changes
    for (const change of beta.changes) {
      if (this.alpha.changes.includes(change)) {
        conflicts.push(`Duplicate: ${change}`);
      }
    }

    // Check for missing tests
    if (beta.changes.length > 0 && beta.tests.length === 0) {
      conflicts.push('No tests for changes');
    }

    return conflicts;
  }

  // Get best beta branch
  getBestBeta(): BetaBranch | null {
    let best: BetaBranch | null = null;
    let bestScore = -1;

    for (const beta of this.betas.values()) {
      if (!beta.merged) {
        const score = this.calculateFitness(beta.id);
        if (score > bestScore) {
          bestScore = score;
          best = beta;
        }
      }
    }

    return best;
  }

  // Promote best beta to alpha
  promoteBestBeta(): MergeResult | null {
    const best = this.getBestBeta();
    if (!best) return null;

    return this.merge(best.id);
  }

  // Get state
  getState(): {
    alpha: AlphaBranch;
    betas: BetaBranch[];
    mergeStrategy: string;
  } {
    return {
      alpha: this.alpha,
      betas: Array.from(this.betas.values()),
      mergeStrategy: this.mergeStrategy
    };
  }

  // Reset
  reset(): void {
    this.alpha.changes = [];
    this.alpha.tests = [];
    this.alpha.fitness = 0;
    this.betas.clear();
    logger.info('AlphaBeta reset');
  }
}

// Global instance
let alphaBetaInstance: AlphaBeta | null = null;

export function getAlphaBeta(alphaConfig?: Partial<AlphaBranch>): AlphaBeta {
  if (!alphaBetaInstance) {
    alphaBetaInstance = new AlphaBeta(alphaConfig);
  }
  return alphaBetaInstance;
}
