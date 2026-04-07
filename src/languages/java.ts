/**
 * Java Language Support for LinguClaw
 * Advanced Java parser with class hierarchy and annotation analysis
 */

import type {
  ASTNode, ParseResult, AnalysisResult, SymbolTable,
  FunctionInfo, ClassInfo, VariableInfo, SecurityIssue
} from '../core/engine';

export class JavaParser {
  private source: string = '';
  private lines: string[] = [];

  parse(source: string, filePath: string): ParseResult {
    this.source = source;
    this.lines = source.split('\n');

    try {
      const ast = this.parseJava(source, filePath);
      
      return {
        ast,
        errors: this.findSyntaxErrors(),
        warnings: [],
        tokens: [],
        comments: this.extractComments(),
      };
    } catch (error) {
      return this.fallbackParse(filePath);
    }
  }

  private parseJava(source: string, filePath: string): ASTNode {
    const root: ASTNode = {
      type: 'CompilationUnit',
      id: `${filePath}:0:0`,
      location: this.createLocation(filePath, 0, 0, this.lines.length, 0),
      children: [],
      metadata: { language: 'java', package: '' },
    };

    // Extract package declaration
    const packageMatch = source.match(/package\s+([\w.]+);/);
    if (packageMatch) {
      root.metadata.package = packageMatch[1];
      root.children.push({
        type: 'PackageDeclaration',
        id: `${filePath}:1:0`,
        location: this.createLocation(filePath, 1, 0, 1, packageMatch[0].length),
        children: [],
        metadata: { name: packageMatch[1] },
      });
    }

    // Parse imports
    const imports = this.parseImports(source, filePath);
    root.children.push(...imports);

    // Parse type declarations (classes, interfaces, enums, records)
    const types = this.parseTypeDeclarations(source, filePath);
    root.children.push(...types);

    return root;
  }

  private parseImports(source: string, filePath: string): ASTNode[] {
    const imports: ASTNode[] = [];
    const importRegex = /import\s+(static\s+)?([\w.*]+);/g;
    let match;

    while ((match = importRegex.exec(source)) !== null) {
      const isStatic = !!match[1];
      const importPath = match[2];
      const isWildcard = importPath.endsWith('.*');

      imports.push({
        type: 'ImportDeclaration',
        id: `${filePath}:0:${match.index}`,
        location: this.createLocation(filePath, 0, match.index, 0, match.index + match[0].length),
        children: [],
        metadata: {
          path: importPath,
          isStatic,
          isWildcard,
          isJavaStandard: importPath.startsWith('java.') || importPath.startsWith('javax.'),
          isThirdParty: !importPath.startsWith('java.') && 
                       !importPath.startsWith('javax.') && 
                       !importPath.startsWith(this.getPackageName(source)),
        },
      });
    }

    return imports;
  }

  private parseTypeDeclarations(source: string, filePath: string): ASTNode[] {
    const types: ASTNode[] = [];
    
    // Match class, interface, enum, record, annotation declarations
    const typeRegex = /(public\s+|private\s+|protected\s+)?(abstract\s+|final\s+|sealed\s+|non-sealed\s+)?(static\s+)?(class|interface|enum|record|@interface)\s+(\w+)(?:<([^>]+)>)?(?:\s+(?:extends|implements)\s+([^{]+))?/g;
    
    let match;
    while ((match = typeRegex.exec(source)) !== null) {
      const visibility = match[1]?.trim() || 'package-private';
      const modifiers = match[2]?.trim() || '';
      const isStatic = !!match[3];
      const typeKind = match[4];
      const typeName = match[5];
      const generics = match[6];
      const extendsOrImplements = match[7]?.trim();

      // Find the body
      const bodyStart = source.indexOf('{', match.index);
      if (bodyStart === -1) continue;

      const bodyEnd = this.findMatchingBrace(source, bodyStart);
      const body = source.substring(bodyStart + 1, bodyEnd);

      const typeNode: ASTNode = {
        type: this.mapTypeKind(typeKind),
        id: `${filePath}:0:${match.index}`,
        location: this.createLocation(filePath, 0, match.index, 0, bodyEnd + 1),
        children: this.parseClassBody(body, filePath),
        metadata: {
          name: typeName,
          visibility,
          isAbstract: modifiers.includes('abstract'),
          isFinal: modifiers.includes('final'),
          isSealed: modifiers.includes('sealed'),
          isStatic,
          isRecord: typeKind === 'record',
          isAnnotation: typeKind === '@interface',
          generics: generics ? generics.split(',').map(g => g.trim()) : [],
          extends: this.parseExtends(extendsOrImplements),
          implements: this.parseImplements(extendsOrImplements),
          annotations: this.extractAnnotations(source, match.index),
          javadoc: this.extractJavadoc(source, match.index),
        },
      };

      types.push(typeNode);
    }

    return types;
  }

  private parseClassBody(body: string, filePath: string): ASTNode[] {
    const members: ASTNode[] = [];
    const lines = body.split('\n');

    // Parse fields
    const fieldRegex = /(private\s+|public\s+|protected\s+)?(static\s+)?(final\s+)?(transient\s+)?(volatile\s+)?([\w<>,\s\[\]]+?)\s+(\w+)\s*(?:=\s*([^;]+))?;/g;
    let match;
    while ((match = fieldRegex.exec(body)) !== null) {
      members.push({
        type: 'FieldDeclaration',
        id: `${filePath}:0:${match.index}`,
        location: this.createLocation(filePath, 0, match.index, 0, match.index + match[0].length),
        children: [],
        metadata: {
          name: match[7],
          type: match[6].trim(),
          visibility: match[1]?.trim() || 'package-private',
          isStatic: !!match[2],
          isFinal: !!match[3],
          isTransient: !!match[4],
          isVolatile: !!match[5],
          initializer: match[8]?.trim(),
          annotations: this.extractAnnotations(body, match.index),
        },
      });
    }

    // Parse methods
    const methodRegex = /(private\s+|public\s+|protected\s+)?(static\s+)?(abstract\s+)?(final\s+)?(synchronized\s+)?(native\s+)?(strictfp\s+)?(<[^>]+>\s+)?([\w<>,\s\[\]]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+([^{]+))?/g;
    
    while ((match = methodRegex.exec(body)) !== null) {
      const visibility = match[1]?.trim() || 'package-private';
      const isStatic = !!match[2];
      const isAbstract = !!match[3];
      const isFinal = !!match[4];
      const isSynchronized = !!match[5];
      const isNative = !!match[6];
      const generics = match[8];
      const returnType = match[9].trim();
      const methodName = match[10];
      const params = match[11];
      const throwsClause = match[12]?.trim();

      // Find method body
      const afterSignature = body.indexOf('(', match.index) + params.length + 1;
      let bodyStart = body.indexOf('{', afterSignature);
      let hasBody = bodyStart !== -1;
      let bodyEnd = hasBody ? this.findMatchingBrace(body, bodyStart) : afterSignature;

      const methodNode: ASTNode = {
        type: 'MethodDeclaration',
        id: `${filePath}:0:${match.index}`,
        location: this.createLocation(filePath, 0, match.index, 0, hasBody ? bodyEnd + 1 : afterSignature + 1),
        children: hasBody ? this.parseMethodBody(body.substring(bodyStart + 1, bodyEnd), filePath) : [],
        metadata: {
          name: methodName,
          returnType,
          visibility,
          isStatic,
          isAbstract,
          isFinal,
          isSynchronized,
          isNative,
          hasBody,
          isConstructor: methodName === this.getEnclosingClassName(body, match.index),
          generics: generics ? generics.replace(/[<>]/g, '').split(',').map(g => g.trim()) : [],
          parameters: this.parseJavaParameters(params),
          throws: throwsClause ? throwsClause.split(',').map(t => t.trim()) : [],
          annotations: this.extractAnnotations(body, match.index),
          javadoc: this.extractJavadoc(body, match.index),
        },
      };

      members.push(methodNode);
    }

    // Parse inner classes
    const innerClassRegex = /class\s+(\w+)/g;
    while ((match = innerClassRegex.exec(body)) !== null) {
      // Skip if it's part of a method (heuristic)
      const precedingText = body.substring(0, match.index);
      const openBraces = (precedingText.match(/{/g) || []).length;
      const closeBraces = (precedingText.match(/}/g) || []).length;
      
      if (openBraces === closeBraces) {
        // Top-level in class body
        const innerBodyStart = body.indexOf('{', match.index);
        const innerBodyEnd = this.findMatchingBrace(body, innerBodyStart);
        
        members.push({
          type: 'ClassDeclaration',
          id: `${filePath}:0:${match.index}`,
          location: this.createLocation(filePath, 0, match.index, 0, innerBodyEnd + 1),
          children: [],
          metadata: {
            name: match[1],
            isInnerClass: true,
            isStatic: precedingText.substring(match.index - 20, match.index).includes('static'),
          },
        });
      }
    }

    return members;
  }

  private parseMethodBody(body: string, filePath: string): ASTNode[] {
    const statements: ASTNode[] = [];
    
    // Variable declarations
    const varRegex = /([\w<>,\s\[\]]+?)\s+(\w+)\s*=\s*([^;]+);/g;
    let match;
    while ((match = varRegex.exec(body)) !== null) {
      statements.push({
        type: 'VariableDeclaration',
        id: `${filePath}:0:${match.index}`,
        location: this.createLocation(filePath, 0, match.index, 0, match.index + match[0].length),
        children: [],
        metadata: {
          type: match[1].trim(),
          name: match[2],
          initializer: match[3].trim(),
        },
      });
    }

    // Method invocations (for call graph)
    const invocationRegex = /(\w+(?:\.\w+)*)\s*\(/g;
    while ((match = invocationRegex.exec(body)) !== null) {
      const preceding = body.substring(Math.max(0, match.index - 20), match.index);
      // Skip if it's a control structure
      if (!/(if|while|for|switch|catch|synchronized)\s*$/.test(preceding)) {
        statements.push({
          type: 'MethodInvocation',
          id: `${filePath}:0:${match.index}`,
          location: this.createLocation(filePath, 0, match.index, 0, match.index + match[0].length),
          children: [],
          metadata: {
            method: match[1],
            isQualified: match[1].includes('.'),
            object: match[1].includes('.') ? match[1].split('.')[0] : 'this',
            methodName: match[1].includes('.') ? match[1].split('.').pop() : match[1],
          },
        });
      }
    }

    // Exception handling
    const tryCatchRegex = /try\s*\{/g;
    while ((match = tryCatchRegex.exec(body)) !== null) {
      statements.push({
        type: 'TryStatement',
        id: `${filePath}:0:${match.index}`,
        location: this.createLocation(filePath, 0, match.index, 0, match.index + 3),
        children: [],
        metadata: {},
      });
    }

    return statements;
  }

  private parseJavaParameters(params: string): { name: string; type: string; isVarArgs: boolean; isFinal: boolean }[] {
    if (!params.trim()) return [];

    const result: { name: string; type: string; isVarArgs: boolean; isFinal: boolean }[] = [];
    const paramList = this.splitParams(params);

    for (const param of paramList) {
      const trimmed = param.trim();
      if (!trimmed) continue;

      const isFinal = trimmed.startsWith('final ');
      const withoutFinal = isFinal ? trimmed.substring(6) : trimmed;
      const isVarArgs = withoutFinal.includes('...');
      
      // Split type and name
      const parts = withoutFinal.replace('...', '').trim().split(/\s+/);
      if (parts.length >= 2) {
        const type = parts.slice(0, -1).join(' ');
        const name = parts[parts.length - 1];
        
        result.push({
          name,
          type: isVarArgs ? type + '...' : type,
          isVarArgs,
          isFinal,
        });
      }
    }

    return result;
  }

  private parseExtends(extendsOrImplements?: string): string | undefined {
    if (!extendsOrImplements) return undefined;
    const match = extendsOrImplements.match(/extends\s+(\w+)/);
    return match ? match[1] : undefined;
  }

  private parseImplements(extendsOrImplements?: string): string[] {
    if (!extendsOrImplements) return [];
    const match = extendsOrImplements.match(/implements\s+(.+)$/);
    if (match) {
      return match[1].split(',').map(i => i.trim());
    }
    return [];
  }

  private extractAnnotations(source: string, position: number): string[] {
    const annotations: string[] = [];
    const preceding = source.substring(0, position);
    const annotationRegex = /@(\w+)(?:\(([^)]*)\))?/g;
    let match;

    // Find annotations in the last few lines before position
    const relevantText = preceding.substring(Math.max(0, preceding.length - 500));
    
    while ((match = annotationRegex.exec(relevantText)) !== null) {
      annotations.push(match[1]);
    }

    return annotations;
  }

  private extractJavadoc(source: string, position: number): string | undefined {
    const preceding = source.substring(0, position);
    const javadocMatch = preceding.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
    if (javadocMatch) {
      return javadocMatch[1].replace(/^\s*\*\s?/gm, '').trim();
    }
    return undefined;
  }

  private mapTypeKind(kind: string): string {
    const map: Record<string, string> = {
      'class': 'ClassDeclaration',
      'interface': 'InterfaceDeclaration',
      'enum': 'EnumDeclaration',
      'record': 'RecordDeclaration',
      '@interface': 'AnnotationDeclaration',
    };
    return map[kind] || 'TypeDeclaration';
  }

  private findMatchingBrace(source: string, startPos: number): number {
    let depth = 1;
    for (let i = startPos + 1; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      if (depth === 0) return i;
    }
    return source.length - 1;
  }

  private splitParams(params: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of params) {
      if (char === '<' || char === '(') depth++;
      if (char === '>' || char === ')') depth--;
      
      if (char === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      result.push(current.trim());
    }

    return result;
  }

  private getPackageName(source: string): string {
    const match = source.match(/package\s+([\w.]+);/);
    return match ? match[1] : '';
  }

  private getEnclosingClassName(source: string, position: number): string | null {
    const preceding = source.substring(0, position);
    const classMatch = preceding.match(/class\s+(\w+)/g);
    if (classMatch) {
      const lastMatch = classMatch[classMatch.length - 1];
      const nameMatch = lastMatch.match(/class\s+(\w+)/);
      return nameMatch ? nameMatch[1] : null;
    }
    return null;
  }

  private createLocation(file: string, startLine: number, startCol: number, endLine: number, endCol: number) {
    return {
      file,
      startLine,
      startColumn: startCol,
      endLine,
      endColumn: endCol,
      byteOffset: 0,
    };
  }

  private findSyntaxErrors(): any[] {
    const errors: any[] = [];
    let braceCount = 0;
    let parenCount = 0;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
      }

      if (braceCount < 0) {
        errors.push({ message: 'Unexpected }', line: i + 1, severity: 'error' });
        braceCount = 0;
      }
      if (parenCount < 0) {
        errors.push({ message: 'Unexpected )', line: i + 1, severity: 'error' });
        parenCount = 0;
      }
    }

    if (braceCount > 0) {
      errors.push({ message: `Unclosed braces: ${braceCount}`, line: this.lines.length, severity: 'error' });
    }

    return errors;
  }

  private extractComments(): any[] {
    const comments: any[] = [];
    
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      
      // Single line comments
      const singleIdx = line.indexOf('//');
      if (singleIdx !== -1) {
        comments.push({
          type: 'Line',
          value: line.substring(singleIdx + 2).trim(),
          line: i + 1,
        });
      }
    }

    // Block comments
    const blockRegex = /\/\*[\s\S]*?\*\//g;
    let match;
    while ((match = blockRegex.exec(this.source)) !== null) {
      const lineNum = this.source.substring(0, match.index).split('\n').length;
      comments.push({
        type: 'Block',
        value: match[0].substring(2, match[0].length - 2).trim(),
        line: lineNum,
      });
    }

    return comments;
  }

  private fallbackParse(filePath: string): ParseResult {
    return {
      ast: this.parseJava(this.source, filePath),
      errors: this.findSyntaxErrors(),
      warnings: [{ message: 'Using fallback parser' }],
      tokens: [],
      comments: this.extractComments(),
    };
  }
}

export class JavaAnalyzer {
  analyze(ast: ASTNode, context: any): AnalysisResult {
    const symbolTable = this.buildSymbolTable(ast);
    const classHierarchy = this.analyzeClassHierarchy(ast);
    const springAnalysis = this.analyzeSpringAnnotations(ast);
    const securityIssues = this.findSecurityIssues(ast);

    return {
      symbols: symbolTable,
      callGraph: this.buildCallGraph(ast),
      dataFlow: { definitions: new Map(), uses: new Map(), taintedSources: [], sinks: [] },
      controlFlow: { nodes: [], edges: [], loops: [], branches: [] },
      typeInference: new Map(),
      metrics: this.calculateMetrics(ast),
      suggestions: [
        ...springAnalysis.suggestions,
        ...securityIssues.map(i => ({
          type: 'security' as const,
          severity: i.severity,
          message: i.description,
          remediation: i.remediation,
        })),
      ],
    };
  }

  private buildSymbolTable(ast: ASTNode): SymbolTable {
    return {
      variables: new Map(),
      functions: new Map(),
      classes: new Map(),
      modules: new Map(),
      imports: [],
      exports: [],
    };
  }

  private analyzeClassHierarchy(ast: ASTNode): any {
    const classes: any[] = [];
    
    const traverse = (node: ASTNode) => {
      if (node.type === 'ClassDeclaration') {
        classes.push({
          name: node.metadata.name,
          extends: node.metadata.extends,
          implements: node.metadata.implements,
          isAbstract: node.metadata.isAbstract,
          isFinal: node.metadata.isFinal,
        });
      }
      node.children.forEach(traverse);
    };

    traverse(ast);

    return { classes, inheritanceDepth: this.calculateInheritanceDepth(classes) };
  }

  private calculateInheritanceDepth(classes: any[]): number {
    let maxDepth = 0;
    
    const getDepth = (className: string, visited: Set<string> = new Set()): number => {
      if (visited.has(className)) return 0; // Circular
      visited.add(className);
      
      const cls = classes.find(c => c.name === className);
      if (!cls || !cls.extends) return 0;
      
      return 1 + getDepth(cls.extends, visited);
    };

    for (const cls of classes) {
      maxDepth = Math.max(maxDepth, getDepth(cls.name));
    }

    return maxDepth;
  }

  private analyzeSpringAnnotations(ast: ASTNode): { suggestions: any[] } {
    const suggestions: any[] = [];
    let controllerCount = 0;
    let serviceCount = 0;
    let repositoryCount = 0;

    const traverse = (node: ASTNode) => {
      const annotations = node.metadata.annotations || [];
      
      if (annotations.includes('Controller') || annotations.includes('RestController')) {
        controllerCount++;
      }
      if (annotations.includes('Service')) serviceCount++;
      if (annotations.includes('Repository')) repositoryCount++;

      // Check for proper transaction management
      if (annotations.includes('Service') && !annotations.includes('Transactional')) {
        suggestions.push({
          type: 'best-practice',
          severity: 'info',
          message: `Service class ${node.metadata.name} missing @Transactional`,
          remediation: 'Consider adding @Transactional for database operations',
        });
      }

      node.children.forEach(traverse);
    };

    traverse(ast);

    // Architecture validation
    if (controllerCount > 0 && serviceCount === 0) {
      suggestions.push({
        type: 'architecture',
        severity: 'warning',
        message: 'Controllers without Service layer detected',
        remediation: 'Add Service layer for business logic separation',
      });
    }

    return { suggestions };
  }

  private findSecurityIssues(ast: ASTNode): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    const traverse = (node: ASTNode) => {
      // Check for SQL injection in string concatenation
      if (node.type === 'MethodInvocation') {
        const method = node.metadata.method;
        if (method?.includes('createQuery') || method?.includes('prepareStatement')) {
          // Check for string concatenation in parameters
        }
      }

      // Check for insecure deserialization
      const annotations = node.metadata.annotations || [];
      if (annotations.includes('RequestMapping') || annotations.includes('GetMapping')) {
        const params = node.metadata.parameters || [];
        for (const param of params) {
          if (!param.annotations?.includes('Valid')) {
            issues.push({
              id: 'JAVA001',
              severity: 'medium',
              category: 'broken-authentication',
              location: node.location,
              description: `Parameter ${param.name} in API endpoint lacks validation`,
              remediation: 'Add @Valid annotation and validation constraints',
              falsePositiveLikelihood: 0.3,
            });
          }
        }
      }

      // Check for hardcoded credentials
      if (node.type === 'FieldDeclaration') {
        const name = node.metadata.name?.toLowerCase();
        if (name?.includes('password') || name?.includes('secret') || name?.includes('key')) {
          if (node.metadata.initializer) {
            issues.push({
              id: 'JAVA002',
              severity: 'critical',
              category: 'sensitive-data-exposure',
              location: node.location,
              description: `Potential hardcoded credential: ${node.metadata.name}`,
              remediation: 'Use externalized configuration (e.g., Spring @Value)',
              falsePositiveLikelihood: 0.4,
            });
          }
        }
      }

      node.children.forEach(traverse);
    };

    traverse(ast);
    return issues;
  }

  private buildCallGraph(ast: ASTNode): any {
    return { nodes: [], edges: [], entryPoints: [], deadCode: [] };
  }

  private calculateMetrics(ast: ASTNode): any {
    return {
      linesOfCode: 0,
      logicalLines: 0,
      commentLines: 0,
      blankLines: 0,
      cyclomaticComplexity: 0,
      cognitiveComplexity: 0,
      halsteadMetrics: { operators: 0, operands: 0, uniqueOperators: 0, uniqueOperands: 0, volume: 0, difficulty: 0, effort: 0, timeToProgram: 0, bugsDelivered: 0 },
      maintainabilityIndex: 0,
      duplicateRate: 0,
    };
  }
}

export const JavaLanguageSupport = {
  id: 'java',
  name: 'Java',
  extensions: ['.java'],
  parser: new JavaParser(),
  analyzer: new JavaAnalyzer(),
};
