/**
 * Prism-Orchestrator Integration
 * TypeScript equivalent of Python prism_orchestrator.py
 */

import { Prism, PrismConfig, Facet } from './prism';
import { Orchestrator } from './orchestrator';
import { getLogger } from './logger';
import { AgentRole } from './types';

const logger = getLogger();

// Facet definitions for different tasks
const DEFAULT_FACETS: Omit<Facet, 'complete' | 'confidence'>[] = [
  {
    id: 'analyze',
    name: 'Analyze Requirements',
    prompt: 'Analyze the following task and identify key requirements, constraints, and success criteria.',
    weight: 1.0,
    next: ['design', 'research']
  },
  {
    id: 'design',
    name: 'Design Solution',
    prompt: 'Based on the analysis, design a solution approach. Consider multiple options and their trade-offs.',
    weight: 1.5,
    next: ['implement']
  },
  {
    id: 'research',
    name: 'Research Context',
    prompt: 'Research relevant information, patterns, and best practices for this type of task.',
    weight: 0.8,
    next: ['design']
  },
  {
    id: 'implement',
    name: 'Implement Solution',
    prompt: 'Implement the solution based on the design. Provide code, configuration, or concrete outputs.',
    weight: 2.0,
    next: ['review', 'test']
  },
  {
    id: 'review',
    name: 'Review Implementation',
    prompt: 'Review the implementation for correctness, quality, and adherence to requirements.',
    weight: 1.0,
    next: ['refine']
  },
  {
    id: 'test',
    name: 'Test Solution',
    prompt: 'Identify test cases and verify the solution handles edge cases correctly.',
    weight: 1.0,
    next: ['refine']
  },
  {
    id: 'refine',
    name: 'Refine and Optimize',
    prompt: 'Based on review and test results, refine and optimize the solution.',
    weight: 1.0
  }
];

// PrismOrchestrator - integrates Prism with Orchestrator
export class PrismOrchestrator {
  prism: Prism;
  orchestrator: Orchestrator;
  config: PrismConfig;

  constructor(orchestrator: Orchestrator, config: Partial<PrismConfig> = {}) {
    this.orchestrator = orchestrator;
    this.config = {
      max_facets: 5,
      confidence_threshold: 0.7,
      auto_branch: true,
      reflection_depth: 2,
      ...config
    };
    this.prism = new Prism(this.config);

    // Add default facets
    for (const facet of DEFAULT_FACETS) {
      this.prism.addFacet(facet);
    }
  }

  // Execute task with Prism + Orchestrator
  async executeTask(task: string): Promise<{
    result: any;
    facets: string[];
    confidence: number;
  }> {
    logger.info(`Starting Prism+Orchestrator execution for: ${task}`);

    const executedFacets: string[] = [];
    let currentFacetId: string | null = 'analyze';
    let lastResult: string = '';
    let finalConfidence = 0;

    // Execute facets until complete
    while (currentFacetId && executedFacets.length < this.config.max_facets) {
      const context = {
        task,
        previous: lastResult,
        goals: [task]
      };

      try {
        // Execute facet with LLM
        const result = await this.prism.executeFacet(
          currentFacetId,
          context,
          async (prompt) => {
            // Use orchestrator's provider for completion
            const response = await this.orchestrator.provider.complete([
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: prompt }
            ]);
            return response.content;
          }
        );

        executedFacets.push(currentFacetId);
        lastResult = result.output;
        finalConfidence = result.confidence;

        logger.info(`Facet ${currentFacetId} complete (confidence: ${finalConfidence.toFixed(2)})`);

        // Determine next facet
        if (result.complete) {
          break;
        }
        currentFacetId = result.next_facet || null;

      } catch (error) {
        logger.error(`Facet ${currentFacetId} failed: ${error}`);
        break;
      }
    }

    // If confidence is low, create branches and try alternative approaches
    if (finalConfidence < this.config.confidence_threshold && this.config.auto_branch) {
      logger.info('Confidence low, creating branches for alternative approaches');

      const conservativeBranch = this.prism.createBranch('conservative');
      const experimentalBranch = this.prism.createBranch('experimental');

      // Execute both branches
      const branchResults = await Promise.all([
        this.executeBranch(conservativeBranch, task, 'safe'),
        this.executeBranch(experimentalBranch, task, 'creative')
      ]);

      // Merge results
      const bestResult = this.selectBestResult(branchResults);

      return {
        result: bestResult,
        facets: executedFacets,
        confidence: finalConfidence
      };
    }

    // Use orchestrator for final execution
    const finalResult = await this.orchestrator.run(task);

    return {
      result: finalResult,
      facets: executedFacets,
      confidence: finalConfidence
    };
  }

  // Execute a branch with specific strategy
  private async executeBranch(branch: any, task: string, strategy: string): Promise<any> {
    logger.info(`Executing ${strategy} branch: ${branch.id}`);

    // Modify task based on strategy
    const modifiedTask = strategy === 'safe'
      ? `${task} (Focus on safety, minimal changes, backwards compatibility)`
      : `${task} (Be creative, consider novel approaches, optimize for performance)`;

    return this.orchestrator.run(modifiedTask);
  }

  // Select best result from branches
  private selectBestResult(results: any[]): any {
    // Simple selection - could be more sophisticated
    return results.reduce((best, current) => {
      const bestScore = this.scoreResult(best);
      const currentScore = this.scoreResult(current);
      return currentScore > bestScore ? current : best;
    });
  }

  // Score a result (placeholder)
  private scoreResult(result: any): number {
    if (!result) return 0;

    // Factors: success, output length, no errors
    let score = result.success ? 1 : 0;
    if (result.output) score += Math.min(result.output.length / 1000, 0.5);
    if (!result.error) score += 0.5;

    return score;
  }

  // Add custom facet
  addCustomFacet(facet: Omit<Facet, 'complete' | 'confidence'>): void {
    this.prism.addFacet(facet);
    logger.info(`Added custom facet: ${facet.name}`);
  }

  // Get execution state
  getState(): {
    prism: ReturnType<Prism['getState']>;
    orchestratorRunning: boolean;
  } {
    return {
      prism: this.prism.getState(),
      orchestratorRunning: true
    };
  }
}
