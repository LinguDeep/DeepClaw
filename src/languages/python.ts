/**
 * Python Language Support for LinguClaw
 * Advanced Python parser using AST analysis
 */

import type {
  ASTNode, SourceLocation, ParseResult, AnalysisResult,
  SymbolTable, FunctionInfo, ClassInfo, VariableInfo,
  CodeMetrics, ComplexityMetrics, SecurityIssue
} from '../core/engine';

interface PythonNode {
  type: string;
  lineno?: number;
  col_offset?: number;
  end_lineno?: number;
  end_col_offset?: number;
  [key: string]: any;
}

export class PythonParser {
  private source: string = '';
  private lines: string[] = [];

  parse(source: string, filePath: string): ParseResult {
    this.source = source;
    this.lines = source.split('\n');

    try {
      // Use Python's ast module via child process for accurate parsing
      const ast = this.parseWithPythonAST(source);
      
      return {
        ast: this.convertToGenericAST(ast, filePath),
        errors: [],
        warnings: [],
        tokens: [],
        comments: this.extractComments(),
      };
    } catch (error) {
      // Fallback to regex-based parsing
      return this.fallbackParse(filePath);
    }
  }

  async *parseStream(source: ReadableStream<string>): AsyncGenerator<ParseResult> {
    const reader = source.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      
      // Try to parse complete statements
      const chunks = this.splitIntoChunks(buffer);
      for (const chunk of chunks.complete) {
        yield this.parse(chunk, '<stream>');
      }
      buffer = chunks.remaining;
    }

    // Parse remaining
    if (buffer.trim()) {
      yield this.parse(buffer, '<stream>');
    }
  }

  private parseWithPythonAST(source: string): PythonNode {
    // In real implementation, this would spawn Python process
    // python -c "import ast; print(ast.dump(ast.parse(source)))"
    return this.createMockPythonAST(source);
  }

  private createMockPythonAST(source: string): PythonNode {
    // Simplified mock AST for demonstration
    return {
      type: 'Module',
      body: this.extractPythonStructure(source),
    };
  }

  private extractPythonStructure(source: string): PythonNode[] {
    const nodes: PythonNode[] = [];
    const lines = source.split('\n');
    let currentIndent = 0;
    let inClass = false;
    let inFunction = false;
    let className = '';
    let functionName = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = line.trim();
      const indent = line.search(/\S/);

      if (stripped.startsWith('class ')) {
        const match = stripped.match(/class\s+(\w+)/);
        if (match) {
          inClass = true;
          className = match[1];
          nodes.push({
            type: 'ClassDef',
            name: className,
            lineno: i + 1,
            col_offset: indent,
          });
        }
      } else if (stripped.startsWith('def ')) {
        const match = stripped.match(/def\s+(\w+)/);
        if (match) {
          inFunction = true;
          functionName = match[1];
          nodes.push({
            type: 'FunctionDef',
            name: functionName,
            lineno: i + 1,
            col_offset: indent,
            parent_class: inClass && indent > 0 ? className : undefined,
          });
        }
      } else if (stripped.startsWith('import ') || stripped.startsWith('from ')) {
        nodes.push({
          type: 'Import',
          line: stripped,
          lineno: i + 1,
        });
      }

      // Detect dedent
      if (indent <= currentIndent && (inClass || inFunction)) {
        if (indent === 0) {
          inClass = false;
          inFunction = false;
        }
      }
      currentIndent = indent;
    }

    return nodes;
  }

  private convertToGenericAST(pythonAST: PythonNode, filePath: string): ASTNode {
    const convertNode = (node: PythonNode, parent?: ASTNode): ASTNode => {
      const generic: ASTNode = {
        type: this.mapPythonNodeType(node.type),
        id: `${filePath}:${node.lineno || 0}:${node.col_offset || 0}`,
        location: {
          file: filePath,
          startLine: node.lineno || 0,
          startColumn: node.col_offset || 0,
          endLine: node.end_lineno || node.lineno || 0,
          endColumn: node.end_col_offset || 0,
          byteOffset: 0,
        },
        children: [],
        parent,
        metadata: { ...node },
      };

      // Convert children
      if (node.body && Array.isArray(node.body)) {
        generic.children = node.body.map((child: PythonNode) => 
          convertNode(child, generic)
        );
      }

      return generic;
    };

    return convertNode(pythonAST);
  }

  private mapPythonNodeType(pythonType: string): string {
    const typeMap: Record<string, string> = {
      'Module': 'Program',
      'FunctionDef': 'FunctionDeclaration',
      'AsyncFunctionDef': 'FunctionDeclaration',
      'ClassDef': 'ClassDeclaration',
      'Import': 'ImportDeclaration',
      'ImportFrom': 'ImportDeclaration',
      'Assign': 'VariableDeclaration',
      'AnnAssign': 'VariableDeclaration',
      'If': 'IfStatement',
      'For': 'ForStatement',
      'While': 'WhileStatement',
      'Try': 'TryStatement',
      'With': 'WithStatement',
      'Return': 'ReturnStatement',
      'Expr': 'ExpressionStatement',
      'Call': 'CallExpression',
      'Attribute': 'MemberExpression',
      'Name': 'Identifier',
      'Constant': 'Literal',
      'List': 'ArrayExpression',
      'Dict': 'ObjectExpression',
    };

    return typeMap[pythonType] || pythonType;
  }

  private extractComments(): any[] {
    const comments: any[] = [];
    const lines = this.source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hashIndex = line.indexOf('#');
      if (hashIndex !== -1) {
        comments.push({
          type: 'Line',
          value: line.substring(hashIndex + 1).trim(),
          line: i + 1,
        });
      }
    }

    return comments;
  }

  private fallbackParse(filePath: string): ParseResult {
    // Basic regex-based fallback
    const ast: ASTNode = {
      type: 'Program',
      id: `${filePath}:0:0`,
      location: {
        file: filePath,
        startLine: 0,
        startColumn: 0,
        endLine: this.lines.length,
        endColumn: 0,
        byteOffset: 0,
      },
      children: this.extractPythonStructure(this.source).map(node => ({
        type: this.mapPythonNodeType(node.type),
        id: `${filePath}:${node.lineno || 0}:0`,
        location: {
          file: filePath,
          startLine: node.lineno || 0,
          startColumn: node.col_offset || 0,
          endLine: node.lineno || 0,
          endColumn: 0,
          byteOffset: 0,
        },
        children: [],
        metadata: node,
      })),
      metadata: {},
    };

    return {
      ast,
      errors: [],
      warnings: [{ message: 'Using fallback parser' }],
      tokens: [],
      comments: this.extractComments(),
    };
  }

  private splitIntoChunks(buffer: string): { complete: string[]; remaining: string } {
    // Split by blank lines or dedent
    const lines = buffer.split('\n');
    const chunks: string[] = [];
    let currentChunk: string[] = [];

    for (const line of lines) {
      if (line.trim() === '' && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
      } else {
        currentChunk.push(line);
      }
    }

    return {
      complete: chunks,
      remaining: currentChunk.join('\n'),
    };
  }
}

export class PythonAnalyzer {
  analyze(ast: ASTNode, context: any): AnalysisResult {
    const symbolTable = this.buildSymbolTable(ast);
    const metrics = this.calculateMetrics(ast);
    const securityIssues = this.findSecurityIssues(ast);

    return {
      symbols: symbolTable,
      callGraph: this.buildCallGraph(ast),
      dataFlow: { definitions: new Map(), uses: new Map(), taintedSources: [], sinks: [] },
      controlFlow: this.buildControlFlow(ast),
      typeInference: new Map(),
      metrics,
      suggestions: this.generateSuggestions(ast, metrics, securityIssues),
    };
  }

  private buildSymbolTable(ast: ASTNode): SymbolTable {
    const variables = new Map<string, VariableInfo>();
    const functions = new Map<string, FunctionInfo>();
    const classes = new Map<string, ClassInfo>();

    const traverse = (node: ASTNode) => {
      switch (node.type) {
        case 'FunctionDeclaration':
          functions.set(node.metadata.name, {
            name: node.metadata.name,
            signature: this.extractSignature(node),
            parameters: [],
            returnType: 'Any',
            async: false,
            pure: this.isPureFunction(node),
            recursive: this.isRecursive(node),
            complexity: this.calculateComplexity(node),
            callers: [],
            callees: this.findCallees(node),
          });
          break;

        case 'ClassDeclaration':
          classes.set(node.metadata.name, {
            name: node.metadata.name,
            superClass: node.metadata.bases?.[0],
            interfaces: [],
            methods: [],
            properties: [],
            isAbstract: false,
            isFinal: false,
          });
          break;

        case 'VariableDeclaration':
          const varName = this.extractVariableName(node);
          if (varName) {
            variables.set(varName, {
              name: varName,
              type: 'Any',
              mutable: true,
              scope: 'local',
              initialized: true,
              references: [],
            });
          }
          break;
      }

      node.children.forEach(traverse);
    };

    traverse(ast);

    return {
      variables,
      functions,
      classes,
      modules: new Map(),
      imports: this.extractImports(ast),
      exports: [],
    };
  }

  private extractSignature(node: ASTNode): string {
    return `def ${node.metadata.name}(...)`;
  }

  private isPureFunction(node: ASTNode): boolean {
    // Check for side effects
    let hasSideEffects = false;
    const checkSideEffects = (n: ASTNode) => {
      if (n.type === 'CallExpression') {
        const funcName = n.metadata.func?.name || '';
        if (['print', 'open', 'write', 'exec', 'eval'].includes(funcName)) {
          hasSideEffects = true;
        }
      }
      n.children.forEach(checkSideEffects);
    };
    checkSideEffects(node);
    return !hasSideEffects;
  }

  private isRecursive(node: ASTNode): boolean {
    const funcName = node.metadata.name;
    let callsSelf = false;
    const checkRecursion = (n: ASTNode) => {
      if (n.type === 'CallExpression' && n.metadata.func?.name === funcName) {
        callsSelf = true;
      }
      n.children.forEach(checkRecursion);
    };
    checkRecursion(node);
    return callsSelf;
  }

  private calculateComplexity(node: ASTNode): ComplexityMetrics {
    let branches = 0;
    let nesting = 0;
    let maxNesting = 0;

    const traverse = (n: ASTNode, depth: number) => {
      maxNesting = Math.max(maxNesting, depth);
      
      if (['IfStatement', 'ForStatement', 'WhileStatement', 'TryStatement'].includes(n.type)) {
        branches++;
        nesting = depth;
      }

      n.children.forEach(child => traverse(child, depth + 1));
    };

    traverse(node, 0);

    return {
      cyclomatic: branches + 1,
      cognitive: branches + maxNesting,
      nestingDepth: maxNesting,
      parameterCount: node.metadata.args?.length || 0,
    };
  }

  private findCallees(node: ASTNode): string[] {
    const callees: string[] = [];
    const traverse = (n: ASTNode) => {
      if (n.type === 'CallExpression' && n.metadata.func?.name) {
        callees.push(n.metadata.func.name);
      }
      n.children.forEach(traverse);
    };
    traverse(node);
    return callees;
  }

  private extractVariableName(node: ASTNode): string | null {
    // Extract variable name from assignment
    return node.metadata.targets?.[0]?.name || null;
  }

  private extractImports(ast: ASTNode): any[] {
    const imports: any[] = [];
    const traverse = (node: ASTNode) => {
      if (node.type === 'ImportDeclaration') {
        imports.push({
          source: node.metadata.module || node.metadata.line,
          names: node.metadata.names || [],
        });
      }
      node.children.forEach(traverse);
    };
    traverse(ast);
    return imports;
  }

  private calculateMetrics(ast: ASTNode): CodeMetrics {
    let linesOfCode = 0;
    let logicalLines = 0;
    let commentLines = 0;
    let blankLines = 0;

    // This would need access to source
    // Simplified calculation
    const countNodes = (node: ASTNode): number => {
      return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
    };

    const totalNodes = countNodes(ast);

    return {
      linesOfCode: totalNodes * 3, // Rough estimate
      logicalLines: Math.floor(totalNodes * 1.5),
      commentLines: 0,
      blankLines: 0,
      cyclomaticComplexity: this.calculateCyclomatic(ast),
      cognitiveComplexity: 0,
      halsteadMetrics: this.calculateHalstead(ast),
      maintainabilityIndex: 70,
      duplicateRate: 0,
    };
  }

  private calculateCyclomatic(ast: ASTNode): number {
    let branches = 0;
    const traverse = (node: ASTNode) => {
      if (['IfStatement', 'ForStatement', 'WhileStatement', 'TryStatement', 'ConditionalExpression'].includes(node.type)) {
        branches++;
      }
      node.children.forEach(traverse);
    };
    traverse(ast);
    return branches + 1;
  }

  private calculateHalstead(ast: ASTNode): any {
    // Simplified Halstead metrics
    const operators = new Set<string>();
    const operands = new Set<string>();

    const traverse = (node: ASTNode) => {
      if (node.type === 'BinaryExpression' || node.type === 'UnaryExpression') {
        operators.add(node.metadata.op);
      }
      if (node.type === 'Identifier' || node.type === 'Literal') {
        operands.add(node.metadata.name || node.metadata.value);
      }
      node.children.forEach(traverse);
    };
    traverse(ast);

    const n1 = operators.size;
    const n2 = operands.size;
    const N1 = operators.size * 2; // Estimated
    const N2 = operands.size * 2;

    const vocabulary = n1 + n2;
    const length = N1 + N2;
    const volume = length * Math.log2(vocabulary || 1);
    const difficulty = (n1 / 2) * (N2 / (n2 || 1));
    const effort = difficulty * volume;

    return {
      operators: n1,
      operands: n2,
      uniqueOperators: n1,
      uniqueOperands: n2,
      volume: Math.round(volume),
      difficulty: Math.round(difficulty),
      effort: Math.round(effort),
      timeToProgram: Math.round(effort / 18),
      bugsDelivered: Math.round(volume / 3000),
    };
  }

  private findSecurityIssues(ast: ASTNode): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    const traverse = (node: ASTNode) => {
      // Check for dangerous functions
      if (node.type === 'CallExpression') {
        const funcName = node.metadata.func?.name || '';
        const funcAttr = node.metadata.func?.attr || '';

        // SQL Injection
        if (['execute', 'executemany', 'raw'].includes(funcName)) {
          const hasStringConcat = this.hasStringConcat(node);
          if (hasStringConcat) {
            issues.push({
              id: 'PY001',
              severity: 'critical',
              category: 'sql-injection',
              location: node.location,
              description: 'Potential SQL injection via string concatenation',
              remediation: 'Use parameterized queries',
              falsePositiveLikelihood: 0.3,
            });
          }
        }

        // Command Injection
        if (['os.system', 'subprocess.call', 'subprocess.run', 'subprocess.Popen'].includes(funcAttr)) {
          const hasUserInput = this.hasUserInput(node);
          if (hasUserInput) {
            issues.push({
              id: 'PY002',
              severity: 'critical',
              category: 'command-injection',
              location: node.location,
              description: 'Potential command injection',
              remediation: 'Use list arguments instead of shell=True',
              falsePositiveLikelihood: 0.2,
            });
          }
        }

        // eval/exec
        if (['eval', 'exec', 'compile'].includes(funcName)) {
          issues.push({
            id: 'PY003',
            severity: 'high',
            category: 'insecure-deserialization',
            location: node.location,
            description: 'Dangerous use of eval/exec',
            remediation: 'Use ast.literal_eval for safe evaluation',
            falsePositiveLikelihood: 0.1,
          });
        }

        // Pickle
        if (['pickle.load', 'pickle.loads', 'cPickle.load'].includes(funcAttr)) {
          issues.push({
            id: 'PY004',
            severity: 'high',
            category: 'insecure-deserialization',
            location: node.location,
            description: 'Unsafe deserialization with pickle',
            remediation: 'Use json or msgpack instead',
            falsePositiveLikelihood: 0.2,
          });
        }

        // Hardcoded secrets
        if (funcName === 'password' || funcAttr?.includes('password')) {
          const args = node.metadata.args || [];
          for (const arg of args) {
            if (arg.type === 'Literal' && typeof arg.value === 'string' && arg.value.length > 0) {
              issues.push({
                id: 'PY005',
                severity: 'critical',
                category: 'sensitive-data-exposure',
                location: node.location,
                description: 'Potential hardcoded password',
                remediation: 'Use environment variables or secret management',
                falsePositiveLikelihood: 0.4,
              });
            }
          }
        }
      }

      // Check for debug mode
      if (node.type === 'Assignment' && node.metadata.name === 'DEBUG') {
        if (node.metadata.value === true) {
          issues.push({
            id: 'PY006',
            severity: 'medium',
            category: 'sensitive-data-exposure',
            location: node.location,
            description: 'DEBUG mode enabled',
            remediation: 'Set DEBUG=False in production',
            falsePositiveLikelihood: 0.1,
          });
        }
      }

      node.children.forEach(traverse);
    };

    traverse(ast);
    return issues;
  }

  private hasStringConcat(node: ASTNode): boolean {
    // Check for string concatenation or formatting
    let found = false;
    const traverse = (n: ASTNode) => {
      if (n.type === 'BinaryExpression' && n.metadata.op === '+') {
        found = true;
      }
      if (n.type === 'CallExpression' && ['format', 'f-string'].includes(n.metadata.func?.name)) {
        found = true;
      }
      n.children.forEach(traverse);
    };
    traverse(node);
    return found;
  }

  private hasUserInput(node: ASTNode): boolean {
    // Check for user input sources
    let found = false;
    const traverse = (n: ASTNode) => {
      if (n.type === 'CallExpression') {
        const funcName = n.metadata.func?.name || '';
        if (['input', 'request', 'argv'].includes(funcName)) {
          found = true;
        }
      }
      n.children.forEach(traverse);
    };
    traverse(node);
    return found;
  }

  private buildCallGraph(ast: ASTNode): any {
    const nodes: string[] = [];
    const edges: any[] = [];

    const traverse = (node: ASTNode) => {
      if (node.type === 'FunctionDeclaration') {
        const funcName = node.metadata.name;
        nodes.push(funcName);

        // Find calls within this function
        const findCalls = (n: ASTNode) => {
          if (n.type === 'CallExpression') {
            const callee = n.metadata.func?.name;
            if (callee) {
              edges.push({ from: funcName, to: callee });
            }
          }
          n.children.forEach(findCalls);
        };
        findCalls(node);
      }
      node.children.forEach(traverse);
    };

    traverse(ast);

    return { nodes, edges, entryPoints: nodes.filter(n => !edges.some(e => e.to === n)), deadCode: [] };
  }

  private buildControlFlow(ast: ASTNode): any {
    // Simplified control flow graph
    return {
      nodes: [],
      edges: [],
      loops: [],
      branches: [],
    };
  }

  private generateSuggestions(ast: ASTNode, metrics: CodeMetrics, issues: SecurityIssue[]): any[] {
    const suggestions: any[] = [];

    // Complexity suggestions
    if (metrics.cyclomaticComplexity > 10) {
      suggestions.push({
        type: 'refactor',
        message: 'Function is too complex. Consider breaking it down.',
        severity: 'warning',
      });
    }

    // Security suggestions
    for (const issue of issues) {
      suggestions.push({
        type: 'security',
        message: issue.description,
        severity: issue.severity,
        remediation: issue.remediation,
      });
    }

    return suggestions;
  }
}

export const PythonLanguageSupport = {
  id: 'python',
  name: 'Python',
  extensions: ['.py', '.pyw', '.pyi'],
  parser: new PythonParser(),
  analyzer: new PythonAnalyzer(),
};
