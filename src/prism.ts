/**
 * Prism - Multi-Faceted Architecture
 * TypeScript equivalent of Python prism.py
 */

import { getLogger } from './logger';
import { FacetResult, Branch } from './types';

const logger = getLogger();

// Facet interface
export interface Facet {
  id: string;
  name: string;
  prompt: string;
  weight: number;
  next?: string[];
  complete: boolean;
  result?: string;
  confidence: number;
}

// Prism configuration
export interface PrismConfig {
  max_facets: number;
  confidence_threshold: number;
  auto_branch: boolean;
  reflection_depth: number;
}

// Default configuration
const DEFAULT_CONFIG: PrismConfig = {
  max_facets: 5,
  confidence_threshold: 0.7,
  auto_branch: true,
  reflection_depth: 2
};

// Prism engine
export class Prism {
  facets: Map<string, Facet>;
  currentFacet: string | null;
  branches: Map<string, Branch>;
  config: PrismConfig;
  private reflectionCount: number;

  constructor(config: Partial<PrismConfig> = {}) {
    this.facets = new Map();
    this.branches = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentFacet = null;
    this.reflectionCount = 0;
  }

  // Register a facet
  addFacet(facet: Omit<Facet, 'complete' | 'confidence'>): void {
    this.facets.set(facet.id, {
      ...facet,
      complete: false,
      confidence: 0
    });
    logger.info(`Added facet: ${facet.name} (${facet.id})`);
  }

  // Execute a facet
  async executeFacet(facetId: string, context: any, llmComplete: (prompt: string) => Promise<string>): Promise<FacetResult> {
    const facet = this.facets.get(facetId);
    if (!facet) {
      throw new Error(`Facet ${facetId} not found`);
    }

    this.currentFacet = facetId;
    logger.info(`Executing facet: ${facet.name}`);

    // Build prompt with context
    const prompt = this.buildPrompt(facet, context);

    try {
      // Call LLM
      const output = await llmComplete(prompt);

      // Calculate confidence (simplified)
      const confidence = this.calculateConfidence(output);

      // Mark facet as complete
      facet.complete = true;
      facet.result = output;
      facet.confidence = confidence;

      // Determine next facet
      const nextFacet = this.determineNextFacet(facet, confidence);

      logger.info(`Facet ${facetId} complete (confidence: ${confidence.toFixed(2)})`);

      return {
        output,
        confidence,
        next_facet: nextFacet,
        complete: confidence >= this.config.confidence_threshold
      };
    } catch (error) {
      logger.error(`Facet ${facetId} execution failed: ${error}`);
      throw error;
    }
  }

  // Build facet prompt
  private buildPrompt(facet: Facet, context: any): string {
    let prompt = facet.prompt;

    // Add context
    if (context.previous) {
      prompt += `\n\nPrevious result:\n${context.previous}`;
    }

    if (context.goals) {
      prompt += `\n\nGoals:\n${context.goals.join('\n')}`;
    }

    return prompt;
  }

  // Calculate confidence score (placeholder)
  private calculateConfidence(output: string): number {
    // Simplified confidence calculation
    // In real implementation, use token probabilities or quality metrics
    const length = output.length;
    const hasStructure = output.includes('```') || output.includes(':') || output.includes('-');
    const hasExplanation = output.toLowerCase().includes('because') || output.toLowerCase().includes('therefore');

    let score = 0.5;
    if (length > 100) score += 0.1;
    if (hasStructure) score += 0.15;
    if (hasExplanation) score += 0.15;

    return Math.min(score, 0.95);
  }

  // Determine next facet to execute
  private determineNextFacet(facet: Facet, confidence: number): string | null {
    if (confidence >= this.config.confidence_threshold) {
      return null; // Done
    }

    if (facet.next && facet.next.length > 0) {
      // Find first incomplete next facet
      for (const nextId of facet.next) {
        const nextFacet = this.facets.get(nextId);
        if (nextFacet && !nextFacet.complete) {
          return nextId;
        }
      }
    }

    return null;
  }

  // Create a new branch
  createBranch(strategy: 'conservative' | 'experimental' | 'custom'): Branch {
    const id = `branch_${Date.now()}`;
    const branch: Branch = {
      id,
      name: `${strategy}_${this.branches.size}`,
      strategy,
      risk_threshold: strategy === 'conservative' ? 30 : strategy === 'experimental' ? 70 : 50,
      fitness: 0
    };

    this.branches.set(id, branch);
    logger.info(`Created branch: ${id} (${strategy})`);
    return branch;
  }

  // Merge branches
  mergeBranches(branchIds: string[]): Branch {
    const branches = branchIds.map(id => this.branches.get(id)).filter(b => b) as Branch[];

    if (branches.length === 0) {
      throw new Error('No valid branches to merge');
    }

    // Select best branch based on fitness
    const bestBranch = branches.reduce((best, current) =>
      current.fitness > best.fitness ? current : best
    );

    logger.info(`Merged ${branches.length} branches, best: ${bestBranch.id}`);
    return bestBranch;
  }

  // Reflection - analyze and improve
  async reflect(output: string, context: any, llmComplete: (prompt: string) => Promise<string>): Promise<string> {
    if (this.reflectionCount >= this.config.reflection_depth) {
      return output;
    }

    this.reflectionCount++;

    const reflectionPrompt = `Review and improve the following output:\n\n${output}\n\nIdentify issues and provide a better version.`;

    try {
      const improved = await llmComplete(reflectionPrompt);
      logger.info(`Reflection ${this.reflectionCount} complete`);
      return improved;
    } catch (error) {
      logger.error(`Reflection failed: ${error}`);
      return output;
    }
  }

  // Reset prism state
  reset(): void {
    this.facets.clear();
    this.branches.clear();
    this.currentFacet = null;
    this.reflectionCount = 0;
    logger.info('Prism reset');
  }

  // Get current state
  getState(): {
    facets: Facet[];
    branches: Branch[];
    currentFacet: string | null;
    reflectionCount: number;
  } {
    return {
      facets: Array.from(this.facets.values()),
      branches: Array.from(this.branches.values()),
      currentFacet: this.currentFacet,
      reflectionCount: this.reflectionCount
    };
  }
}

// Global instance
let prismInstance: Prism | null = null;

export function getPrism(config?: Partial<PrismConfig>): Prism {
  if (!prismInstance) {
    prismInstance = new Prism(config);
  }
  return prismInstance;
}
