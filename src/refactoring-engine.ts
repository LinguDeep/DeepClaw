/**
 * Code Refactoring Engine for LinguClaw
 * Automated code transformations and improvements
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from './logger';
import type { ASTNode, AnalysisResult } from './core/engine';

const logger = getLogger();

// ============================================
// REFACTORING OPERATIONS
// ============================================

export interface RefactoringOperation {
  id: string;
  name: string;
  description: string;
  category: RefactoringCategory;
  appliesTo: string[]; // Language IDs
  canApply: (node: ASTNode) => boolean;
  apply: (node: ASTNode, source: string) => RefactoringResult;
  safety: 'safe' | 'requires-review' | 'risky';
  breaking: boolean;
}

export type RefactoringCategory =
  | 'simplification'
  | 'extraction'
  | 'reorganization'
  | 'modernization'
  | 'performance'
  | 'readability';

export interface RefactoringResult {
  success: boolean;
  original: string;
  transformed: string;
  changes: CodeChange[];
  warnings: string[];
  errors: string[];
}

export interface CodeChange {
  type: 'replace' | 'insert' | 'delete';
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  originalText: string;
  newText: string;
  description: string;
}

// ============================================
// REFACTORING ENGINE
// ============================================

export class RefactoringEngine {
  private operations: Map<string, RefactoringOperation> = new Map();
  private appliedRefactorings: RefactoringResult[] = [];

  constructor() {
    this.registerDefaultOperations();
  }

  private registerDefaultOperations(): void {
    // Simplification refactorings
    this.register({
      id: 'remove-unused-imports',
      name: 'Remove Unused Imports',
      description: 'Removes import statements that are not used in the code',
      category: 'simplification',
      appliesTo: ['typescript', 'javascript', 'python', 'java', 'go', 'rust', 'csharp'],
      canApply: (node) => this.hasUnusedImports(node),
      apply: (node, source) => this.removeUnusedImports(node, source),
      safety: 'safe',
      breaking: false,
    });

    this.register({
      id: 'simplify-boolean-expressions',
      name: 'Simplify Boolean Expressions',
      description: 'Simplifies redundant boolean expressions like `x == true` to `x`',
      category: 'simplification',
      appliesTo: ['typescript', 'javascript', 'python', 'java', 'csharp'],
      canApply: (node) => this.hasRedundantBooleanExpressions(node),
      apply: (node, source) => this.simplifyBooleanExpressions(node, source),
      safety: 'safe',
      breaking: false,
    });

    this.register({
      id: 'remove-dead-code',
      name: 'Remove Dead Code',
      description: 'Removes unreachable code and unused variables',
      category: 'simplification',
      appliesTo: ['typescript', 'javascript', 'python', 'java', 'go', 'rust', 'csharp'],
      canApply: (node) => this.hasDeadCode(node),
      apply: (node, source) => this.removeDeadCode(node, source),
      safety: 'requires-review',
      breaking: false,
    });

    // Extraction refactorings
    this.register({
      id: 'extract-method',
      name: 'Extract Method',
      description: 'Extracts a block of code into a separate method/function',
      category: 'extraction',
      appliesTo: ['typescript', 'javascript', 'python', 'java', 'csharp'],
      canApply: (node) => this.canExtractMethod(node),
      apply: (node, source) => this.extractMethod(node, source),
      safety: 'safe',
      breaking: false,
    });

    this.register({
      id: 'extract-variable',
      name: 'Extract Variable',
      description: 'Extracts a complex expression into a named variable',
      category: 'extraction',
      appliesTo: ['typescript', 'javascript', 'python', 'java', 'go', 'rust', 'csharp'],
      canApply: (node) => this.canExtractVariable(node),
      apply: (node, source) => this.extractVariable(node, source),
      safety: 'safe',
      breaking: false,
    });

    this.register({
      id: 'extract-interface',
      name: 'Extract Interface',
      description: 'Creates an interface from a class public API',
      category: 'extraction',
      appliesTo: ['typescript', 'java', 'csharp'],
      canApply: (node) => this.canExtractInterface(node),
      apply: (node, source) => this.extractInterface(node, source),
      safety: 'safe',
      breaking: false,
    });

    // Modernization refactorings
    this.register({
      id: 'convert-to-arrow-functions',
      name: 'Convert to Arrow Functions',
      description: 'Converts traditional functions to arrow functions where appropriate',
      category: 'modernization',
      appliesTo: ['typescript', 'javascript'],
      canApply: (node) => this.canConvertToArrowFunction(node),
      apply: (node, source) => this.convertToArrowFunction(node, source),
      safety: 'safe',
      breaking: false,
    });

    this.register({
      id: 'convert-to-template-literals',
      name: 'Convert to Template Literals',
      description: 'Converts string concatenation to template literals',
      category: 'modernization',
      appliesTo: ['typescript', 'javascript'],
      canApply: (node) => this.hasStringConcatenation(node),
      apply: (node, source) => this.convertToTemplateLiterals(node, source),
      safety: 'safe',
      breaking: false,
    });

    this.register({
      id: 'convert-to-async-await',
      name: 'Convert to Async/Await',
      description: 'Converts Promise chains to async/await syntax',
      category: 'modernization',
      appliesTo: ['typescript', 'javascript', 'csharp'],
      canApply: (node) => this.hasPromiseChains(node),
      apply: (node, source) => this.convertToAsyncAwait(node, source),
      safety: 'requires-review',
      breaking: false,
    });

    this.register({
      id: 'convert-to-optional-chaining',
      name: 'Convert to Optional Chaining',
      description: 'Converts nested property checks to optional chaining',
      category: 'modernization',
      appliesTo: ['typescript', 'javascript'],
      canApply: (node) => this.hasNestedPropertyChecks(node),
      apply: (node, source) => this.convertToOptionalChaining(node, source),
      safety: 'safe',
      breaking: false,
    });

    // Performance refactorings
    this.register({
      id: 'optimize-string-concatenation',
      name: 'Optimize String Concatenation',
      description: 'Uses StringBuilder/StringBuffer for concatenation in loops',
      category: 'performance',
      appliesTo: ['java', 'csharp', 'typescript', 'javascript'],
      canApply: (node) => this.hasStringConcatInLoop(node),
      apply: (node, source) => this.optimizeStringConcatenation(node, source),
      safety: 'safe',
      breaking: false,
    });

    this.register({
      id: 'convert-to-linq',
      name: 'Convert to LINQ/Stream',
      description: 'Converts imperative loops to LINQ (C#) or Stream (Java)',
      category: 'performance',
      appliesTo: ['csharp', 'java'],
      canApply: (node) => this.canConvertToLinq(node),
      apply: (node, source) => this.convertToLinq(node, source),
      safety: 'requires-review',
      breaking: false,
    });

    // Readability refactorings
    this.register({
      id: 'rename-variable',
      name: 'Rename Variable',
      description: 'Renames variables to be more descriptive',
      category: 'readability',
      appliesTo: ['typescript', 'javascript', 'python', 'java', 'go', 'rust', 'csharp'],
      canApply: (node) => this.hasPoorlyNamedVariables(node),
      apply: (node, source) => this.renameVariables(node, source),
      safety: 'requires-review',
      breaking: false,
    });

    this.register({
      id: 'add-type-annotations',
      name: 'Add Type Annotations',
      description: 'Adds explicit type annotations where they improve readability',
      category: 'readability',
      appliesTo: ['typescript', 'python', 'go', 'rust'],
      canApply: (node) => this.missingTypeAnnotations(node),
      apply: (node, source) => this.addTypeAnnotations(node, source),
      safety: 'safe',
      breaking: false,
    });

    this.register({
      id: 'reorganize-class-members',
      name: 'Reorganize Class Members',
      description: 'Reorders class members by visibility and type',
      category: 'reorganization',
      appliesTo: ['typescript', 'java', 'csharp', 'python'],
      canApply: (node) => this.hasUnorganizedMembers(node),
      apply: (node, source) => this.reorganizeClassMembers(node, source),
      safety: 'safe',
      breaking: false,
    });
  }

  register(operation: RefactoringOperation): void {
    this.operations.set(operation.id, operation);
  }

  getAvailableOperations(language: string): RefactoringOperation[] {
    return Array.from(this.operations.values())
      .filter(op => op.appliesTo.includes(language));
  }

  analyzeForRefactoring(ast: ASTNode, language: string, source: string): RefactoringSuggestion[] {
    const suggestions: RefactoringSuggestion[] = [];
    const operations = this.getAvailableOperations(language);

    for (const op of operations) {
      if (op.canApply(ast)) {
        const result = op.apply(ast, source);
        if (result.success && result.changes.length > 0) {
          suggestions.push({
            operation: op,
            preview: result,
            impact: this.calculateImpact(result),
          });
        }
      }
    }

    return suggestions.sort((a, b) => b.impact - a.impact);
  }

  private calculateImpact(result: RefactoringResult): number {
    let impact = 0;
    
    // More changes = higher impact
    impact += result.changes.length * 5;
    
    // Fewer warnings = higher confidence
    impact -= result.warnings.length * 2;
    
    // No errors = good
    if (result.errors.length === 0) impact += 10;
    
    return Math.max(0, impact);
  }

  async applyRefactoring(
    filePath: string,
    operationId: string,
    ast: ASTNode,
    dryRun: boolean = false
  ): Promise<RefactoringResult> {
    const operation = this.operations.get(operationId);
    if (!operation) {
      return {
        success: false,
        original: '',
        transformed: '',
        changes: [],
        warnings: [],
        errors: [`Operation ${operationId} not found`],
      };
    }

    const source = fs.readFileSync(filePath, 'utf-8');
    
    if (!operation.canApply(ast)) {
      return {
        success: false,
        original: source,
        transformed: source,
        changes: [],
        warnings: [],
        errors: [`Operation ${operationId} cannot be applied to this code`],
      };
    }

    const result = operation.apply(ast, source);

    if (!dryRun && result.success) {
      fs.writeFileSync(filePath, result.transformed);
      this.appliedRefactorings.push(result);
      logger.info(`Applied refactoring: ${operation.name} to ${filePath}`);
    }

    return result;
  }

  // ============================================
  // REFACTORING IMPLEMENTATIONS
  // ============================================

  private hasUnusedImports(node: ASTNode): boolean {
    // Simplified check - would need full symbol analysis
    return node.children.some(c => c.type === 'ImportDeclaration');
  }

  private removeUnusedImports(node: ASTNode, source: string): RefactoringResult {
    const changes: CodeChange[] = [];
    const lines = source.split('\n');
    const unusedImports = this.findUnusedImports(node, source);

    for (const imp of unusedImports) {
      const lineIndex = imp.location.startLine - 1;
      changes.push({
        type: 'delete',
        startLine: imp.location.startLine,
        startColumn: 0,
        endLine: imp.location.endLine,
        endColumn: lines[lineIndex]?.length || 0,
        originalText: lines[lineIndex] || '',
        newText: '',
        description: 'Remove unused import',
      });
    }

    return {
      success: true,
      original: source,
      transformed: this.applyChanges(source, changes),
      changes,
      warnings: [],
      errors: [],
    };
  }

  private findUnusedImports(node: ASTNode, source: string): ASTNode[] {
    const imports = node.children.filter(c => c.type === 'ImportDeclaration');
    return imports.filter(imp => {
      const names = imp.metadata.names || [];
      return names.some((name: string) => !source.includes(name) || source.indexOf(name) === source.lastIndexOf(name));
    });
  }

  private hasRedundantBooleanExpressions(node: ASTNode): boolean {
    // Check for patterns like `x == true` or `x == false`
    return /==\s*(true|false)|===\s*(true|false)/.test(JSON.stringify(node));
  }

  private simplifyBooleanExpressions(node: ASTNode, source: string): RefactoringResult {
    const changes: CodeChange[] = [];
    
    // Find all redundant boolean comparisons
    const patterns = [
      { regex: /([\w.]+)\s*===?\s*true/g, replacement: '$1', desc: 'Simplify `x === true` to `x`' },
      { regex: /([\w.]+)\s*===?\s*false/g, replacement: '!$1', desc: 'Simplify `x === false` to `!x`' },
    ];

    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        if (pattern.regex.test(lines[i])) {
          const original = lines[i];
          const transformed = lines[i].replace(pattern.regex, pattern.replacement);
          
          if (original !== transformed) {
            changes.push({
              type: 'replace',
              startLine: i + 1,
              startColumn: 0,
              endLine: i + 1,
              endColumn: original.length,
              originalText: original,
              newText: transformed,
              description: pattern.desc,
            });
          }
        }
      }
    }

    return {
      success: true,
      original: source,
      transformed: this.applyChanges(source, changes),
      changes,
      warnings: [],
      errors: [],
    };
  }

  private hasDeadCode(node: ASTNode): boolean {
    // Check for unreachable code or unused variables
    return node.children.some(c => 
      c.type === 'VariableDeclaration' && !c.metadata.isUsed ||
      c.type === 'FunctionDeclaration' && !c.metadata.isCalled
    );
  }

  private removeDeadCode(node: ASTNode, source: string): RefactoringResult {
    // Implementation would require full data flow analysis
    return {
      success: false,
      original: source,
      transformed: source,
      changes: [],
      warnings: ['Dead code removal requires comprehensive analysis'],
      errors: [],
    };
  }

  private canExtractMethod(node: ASTNode): boolean {
    // Check if there's a code block that can be extracted
    return node.children.some(c => 
      c.type === 'BlockStatement' || 
      c.type === 'MethodDeclaration' || 
      c.type === 'FunctionDeclaration'
    );
  }

  private extractMethod(node: ASTNode, source: string): RefactoringResult {
    // Complex refactoring - would need full analysis
    return {
      success: false,
      original: source,
      transformed: source,
      changes: [],
      warnings: ['Method extraction requires selection of code block'],
      errors: [],
    };
  }

  private canExtractVariable(node: ASTNode): boolean {
    // Check for complex expressions
    return node.children.some(c => 
      c.type === 'BinaryExpression' || 
      c.type === 'CallExpression' ||
      c.type === 'MemberExpression'
    );
  }

  private extractVariable(node: ASTNode, source: string): RefactoringResult {
    // Would need selection of specific expression
    return {
      success: false,
      original: source,
      transformed: source,
      changes: [],
      warnings: ['Variable extraction requires selection of expression'],
      errors: [],
    };
  }

  private canExtractInterface(node: ASTNode): boolean {
    return node.type === 'ClassDeclaration' || node.type === 'ClassDefinition';
  }

  private extractInterface(node: ASTNode, source: string): RefactoringResult {
    // Generate interface from class public methods
    const className = node.metadata.name || 'Unknown';
    const methods = node.children.filter(c => 
      c.type === 'MethodDeclaration' && 
      (c.metadata.isPublic || !c.metadata.isPrivate)
    );

    let interfaceCode = `interface I${className} {\n`;
    for (const method of methods) {
      const params = (method.metadata.parameters || []).join(', ');
      interfaceCode += `  ${method.metadata.name}(${params}): ${method.metadata.returnType || 'void'};\n`;
    }
    interfaceCode += '}';

    return {
      success: true,
      original: source,
      transformed: source + '\n\n' + interfaceCode,
      changes: [{
        type: 'insert',
        startLine: source.split('\n').length + 1,
        startColumn: 0,
        endLine: source.split('\n').length + 1,
        endColumn: 0,
        originalText: '',
        newText: interfaceCode,
        description: `Extract interface I${className}`,
      }],
      warnings: [],
      errors: [],
    };
  }

  private canConvertToArrowFunction(node: ASTNode): boolean {
    return node.children.some(c => 
      c.type === 'FunctionDeclaration' && 
      !c.metadata.isGenerator &&
      !c.metadata.isConstructor
    );
  }

  private convertToArrowFunction(node: ASTNode, source: string): RefactoringResult {
    const changes: CodeChange[] = [];
    const lines = source.split('\n');

    for (const child of node.children) {
      if (child.type === 'FunctionDeclaration' && child.metadata.name) {
        const startLine = child.location.startLine - 1;
        const original = lines[startLine];
        
        // Simple transformation for demo
        const arrowVersion = `const ${child.metadata.name} = ${original.replace('function ', '').replace(child.metadata.name, '')}`;
        
        changes.push({
          type: 'replace',
          startLine: child.location.startLine,
          startColumn: 0,
          endLine: child.location.startLine,
          endColumn: original.length,
          originalText: original,
          newText: arrowVersion,
          description: 'Convert function to arrow function',
        });
      }
    }

    return {
      success: changes.length > 0,
      original: source,
      transformed: this.applyChanges(source, changes),
      changes,
      warnings: [],
      errors: [],
    };
  }

  private hasStringConcatenation(node: ASTNode): boolean {
    return /\+\s*['"]/.test(JSON.stringify(node)) || /['"]\s*\+/.test(JSON.stringify(node));
  }

  private convertToTemplateLiterals(node: ASTNode, source: string): RefactoringResult {
    const changes: CodeChange[] = [];
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Find string concatenation patterns
      const concatPattern = /['"]([^'"]*)['"]\s*\+\s*(\w+)\s*\+\s*['"]([^'"]*)['"]/g;
      
      if (concatPattern.test(line)) {
        const transformed = line.replace(
          /['"]([^'"]*)['"]\s*\+\s*(\w+)\s*\+\s*['"]([^'"]*)['"]/g,
          '`$1${$2}$3`'
        );
        
        if (line !== transformed) {
          changes.push({
            type: 'replace',
            startLine: i + 1,
            startColumn: 0,
            endLine: i + 1,
            endColumn: line.length,
            originalText: line,
            newText: transformed,
            description: 'Convert string concatenation to template literal',
          });
        }
      }
    }

    return {
      success: changes.length > 0,
      original: source,
      transformed: this.applyChanges(source, changes),
      changes,
      warnings: [],
      errors: [],
    };
  }

  private hasPromiseChains(node: ASTNode): boolean {
    const str = JSON.stringify(node);
    return new RegExp('\\.then\\s*\\(').test(str) || new RegExp('\\.catch\\s*\\(').test(str);
  }

  private convertToAsyncAwait(node: ASTNode, source: string): RefactoringResult {
    // Complex transformation requiring full AST manipulation
    return {
      success: false,
      original: source,
      transformed: source,
      changes: [],
      warnings: ['Promise to async/await conversion requires full AST transformation'],
      errors: [],
    };
  }

  private hasNestedPropertyChecks(node: ASTNode): boolean {
    return /&&\s*[\w.]+\s*!==\s*null/.test(JSON.stringify(node)) || 
           /&&\s*[\w.]+\s*!==\s*undefined/.test(JSON.stringify(node));
  }

  private convertToOptionalChaining(node: ASTNode, source: string): RefactoringResult {
    const changes: CodeChange[] = [];
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Pattern: obj && obj.prop && obj.prop.nested
      const pattern = /(\w+)\s*&&\s*\1\.(\w+)/g;
      
      if (pattern.test(line)) {
        const transformed = line.replace(/(\w+)\s*&&\s*\1\.(\w+)/g, '$1?.$2');
        
        if (line !== transformed) {
          changes.push({
            type: 'replace',
            startLine: i + 1,
            startColumn: 0,
            endLine: i + 1,
            endColumn: line.length,
            originalText: line,
            newText: transformed,
            description: 'Convert to optional chaining',
          });
        }
      }
    }

    return {
      success: changes.length > 0,
      original: source,
      transformed: this.applyChanges(source, changes),
      changes,
      warnings: [],
      errors: [],
    };
  }

  private hasStringConcatInLoop(node: ASTNode): boolean {
    return /for|while/.test(JSON.stringify(node)) && /\+\s*['"]/.test(JSON.stringify(node));
  }

  private optimizeStringConcatenation(node: ASTNode, source: string): RefactoringResult {
    return {
      success: false,
      original: source,
      transformed: source,
      changes: [],
      warnings: ['String concatenation optimization requires context analysis'],
      errors: [],
    };
  }

  private canConvertToLinq(node: ASTNode): boolean {
    return /for\s*\([^)]+\)\s*\{/.test(JSON.stringify(node)) && 
           /Add|add/.test(JSON.stringify(node));
  }

  private convertToLinq(node: ASTNode, source: string): RefactoringResult {
    return {
      success: false,
      original: source,
      transformed: source,
      changes: [],
      warnings: ['LINQ conversion requires pattern matching on specific loop types'],
      errors: [],
    };
  }

  private hasPoorlyNamedVariables(node: ASTNode): boolean {
    const badNames = ['x', 'y', 'z', 'a', 'b', 'c', 'i', 'j', 'k', 'temp', 'tmp', 'val', 'num'];
    return node.children.some(c => 
      badNames.includes(c.metadata.name) || 
      c.metadata.name?.length === 1
    );
  }

  private renameVariables(node: ASTNode, source: string): RefactoringResult {
    return {
      success: false,
      original: source,
      transformed: source,
      changes: [],
      warnings: ['Variable renaming requires semantic analysis to suggest meaningful names'],
      errors: [],
    };
  }

  private missingTypeAnnotations(node: ASTNode): boolean {
    return node.children.some(c => 
      (c.type === 'VariableDeclaration' || c.type === 'FunctionDeclaration') &&
      !c.metadata.type
    );
  }

  private addTypeAnnotations(node: ASTNode, source: string): RefactoringResult {
    return {
      success: false,
      original: source,
      transformed: source,
      changes: [],
      warnings: ['Type annotation addition requires type inference analysis'],
      errors: [],
    };
  }

  private hasUnorganizedMembers(node: ASTNode): boolean {
    return node.type === 'ClassDeclaration' || node.type === 'ClassDefinition';
  }

  private reorganizeClassMembers(node: ASTNode, source: string): RefactoringResult {
    return {
      success: false,
      original: source,
      transformed: source,
      changes: [],
      warnings: ['Member reorganization requires full class structure analysis'],
      errors: [],
    };
  }

  private applyChanges(source: string, changes: CodeChange[]): string {
    const lines = source.split('\n');
    
    // Sort changes by line number (descending) to avoid index shifting
    changes.sort((a, b) => b.startLine - a.startLine);
    
    for (const change of changes) {
      const lineIndex = change.startLine - 1;
      
      if (change.type === 'delete') {
        lines.splice(lineIndex, 1);
      } else if (change.type === 'replace') {
        lines[lineIndex] = change.newText;
      } else if (change.type === 'insert') {
        lines.splice(lineIndex, 0, change.newText);
      }
    }
    
    return lines.join('\n');
  }

  // ============================================
  // BATCH OPERATIONS
  // ============================================

  async batchRefactor(
    files: string[],
    operationIds: string[],
    dryRun: boolean = true
  ): Promise<BatchRefactoringResult> {
    const results: FileRefactoringResult[] = [];
    let totalChanges = 0;
    let successCount = 0;

    for (const file of files) {
      const fileResults: RefactoringResult[] = [];
      
      for (const opId of operationIds) {
        // Parse file (simplified - would need actual parser)
        const source = fs.readFileSync(file, 'utf-8');
        const mockAST: ASTNode = {
          type: 'Program',
          id: file,
          location: { file, startLine: 1, startColumn: 0, endLine: source.split('\n').length, endColumn: 0, byteOffset: 0 },
          children: [],
          metadata: {},
        };

        const result = await this.applyRefactoring(file, opId, mockAST, dryRun);
        fileResults.push(result);
        
        if (result.success) {
          totalChanges += result.changes.length;
          successCount++;
        }
      }

      results.push({
        file,
        results: fileResults,
        totalChanges: fileResults.reduce((sum, r) => sum + r.changes.length, 0),
      });
    }

    return {
      files: results,
      totalFiles: files.length,
      successfulRefactorings: successCount,
      totalChanges,
      dryRun,
    };
  }

  getAppliedRefactorings(): RefactoringResult[] {
    return this.appliedRefactorings;
  }

  undoLastRefactoring(): boolean {
    const last = this.appliedRefactorings.pop();
    if (last) {
      // Would need to track original file states
      logger.info('Undo functionality requires file state tracking');
      return false;
    }
    return false;
  }
}

export interface RefactoringSuggestion {
  operation: RefactoringOperation;
  preview: RefactoringResult;
  impact: number;
}

export interface FileRefactoringResult {
  file: string;
  results: RefactoringResult[];
  totalChanges: number;
}

export interface BatchRefactoringResult {
  files: FileRefactoringResult[];
  totalFiles: number;
  successfulRefactorings: number;
  totalChanges: number;
  dryRun: boolean;
}

export default RefactoringEngine;
