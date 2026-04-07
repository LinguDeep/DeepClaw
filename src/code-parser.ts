/**
 * AST-based Code Parser for intelligent codebase analysis
 * Extracts functions, classes, imports, exports, and call graphs
 */

import * as ts from 'typescript';
import path from 'path';
import fs from 'fs';
import { getLogger } from './logger';

const logger = getLogger();

export interface ParsedChunk {
  id: string;
  filePath: string;
  content: string;
  chunkType: 'function' | 'class' | 'interface' | 'type' | 'import' | 'export' | 'variable' | 'other';
  name: string;
  lineStart: number;
  lineEnd: number;
  dependencies: string[]; // Other symbols this chunk depends on
  dependents: string[]; // Symbols that depend on this chunk
  signature?: string; // Function signature or class interface
  documentation?: string; // JSDoc comments
  isExported: boolean;
}

export interface CallGraph {
  calls: Map<string, Set<string>>; // caller -> callees
  calledBy: Map<string, Set<string>>; // callee -> callers
}

/**
 * Parse TypeScript/JavaScript file using TypeScript compiler API
 */
export function parseTypeScriptFile(filePath: string): ParsedChunk[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const chunks: ParsedChunk[] = [];
    const callGraph: CallGraph = {
      calls: new Map(),
      calledBy: new Map(),
    };

    function getLine(node: ts.Node): number {
      return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    }

    function getDocumentation(node: ts.Node): string | undefined {
      const ranges = ts.getLeadingCommentRanges(content, node.getFullStart());
      if (!ranges) return undefined;
      return ranges.map(r => content.slice(r.pos, r.end)).join('\n');
    }

    function extractSignature(node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction): string {
      const params = node.parameters.map(p => {
        const name = p.name.getText(sourceFile);
        const type = p.type ? p.type.getText(sourceFile) : 'any';
        return `${name}: ${type}`;
      }).join(', ');
      const returnType = node.type ? ` => ${node.type.getText(sourceFile)}` : '';
      return `(${params})${returnType}`;
    }

    function visitNode(node: ts.Node, parentName?: string) {
      const line = getLine(node);
      
      if (ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text;
        const chunk: ParsedChunk = {
          id: `${filePath}::${name}`,
          filePath,
          content: node.getText(sourceFile),
          chunkType: 'function',
          name,
          lineStart: line,
          lineEnd: getLine(node) + node.getText(sourceFile).split('\n').length - 1,
          dependencies: extractDependencies(node, sourceFile),
          dependents: [],
          signature: extractSignature(node),
          documentation: getDocumentation(node),
          isExported: hasExportModifier(node),
        };
        chunks.push(chunk);

        // Build call graph
        extractCalls(node, sourceFile, name, callGraph);
      }

      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        const classChunk: ParsedChunk = {
          id: `${filePath}::${className}`,
          filePath,
          content: node.getText(sourceFile),
          chunkType: 'class',
          name: className,
          lineStart: line,
          lineEnd: getLine(node) + node.getText(sourceFile).split('\n').length - 1,
          dependencies: [],
          dependents: [],
          documentation: getDocumentation(node),
          isExported: hasExportModifier(node),
        };
        chunks.push(classChunk);

        // Process class members
        node.members.forEach(member => {
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = member.name.getText(sourceFile);
            const fullName = `${className}.${methodName}`;
            const methodChunk: ParsedChunk = {
              id: `${filePath}::${fullName}`,
              filePath,
              content: member.getText(sourceFile),
              chunkType: 'function',
              name: fullName,
              lineStart: getLine(member),
              lineEnd: getLine(member) + member.getText(sourceFile).split('\n').length - 1,
              dependencies: extractDependencies(member, sourceFile),
              dependents: [],
              signature: extractSignature(member),
              documentation: getDocumentation(member),
              isExported: false,
            };
            chunks.push(methodChunk);
            extractCalls(member, sourceFile, fullName, callGraph);
          }
        });
      }

      if (ts.isInterfaceDeclaration(node) && node.name) {
        chunks.push({
          id: `${filePath}::${node.name.text}`,
          filePath,
          content: node.getText(sourceFile),
          chunkType: 'interface',
          name: node.name.text,
          lineStart: line,
          lineEnd: getLine(node) + node.getText(sourceFile).split('\n').length - 1,
          dependencies: extractDependencies(node, sourceFile),
          dependents: [],
          documentation: getDocumentation(node),
          isExported: hasExportModifier(node),
        });
      }

      if (ts.isTypeAliasDeclaration(node) && node.name) {
        chunks.push({
          id: `${filePath}::${node.name.text}`,
          filePath,
          content: node.getText(sourceFile),
          chunkType: 'type',
          name: node.name.text,
          lineStart: line,
          lineEnd: getLine(node) + node.getText(sourceFile).split('\n').length - 1,
          dependencies: extractDependencies(node, sourceFile),
          dependents: [],
          documentation: getDocumentation(node),
          isExported: hasExportModifier(node),
        });
      }

      if (ts.isImportDeclaration(node)) {
        const importText = node.getText(sourceFile);
        const moduleName = node.moduleSpecifier.getText(sourceFile).replace(/['"]/g, '');
        chunks.push({
          id: `${filePath}::import::${moduleName}`,
          filePath,
          content: importText,
          chunkType: 'import',
          name: moduleName,
          lineStart: line,
          lineEnd: line,
          dependencies: [],
          dependents: [],
          isExported: false,
        });
      }

      if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
        chunks.push({
          id: `${filePath}::export::${line}`,
          filePath,
          content: node.getText(sourceFile),
          chunkType: 'export',
          name: 'export',
          lineStart: line,
          lineEnd: line,
          dependencies: extractDependencies(node, sourceFile),
          dependents: [],
          isExported: true,
        });
      }

      ts.forEachChild(node, child => visitNode(child, parentName));
    }

    visitNode(sourceFile);

    // Link dependencies based on call graph
    linkCallGraph(chunks, callGraph);

    return chunks;
  } catch (error: any) {
    logger.error(`Failed to parse ${filePath}: ${error.message}`);
    return [];
  }
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = (node as any).modifiers;
  if (!modifiers) return false;
  return modifiers.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function extractDependencies(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const deps: string[] = [];
  
  function visit(n: ts.Node) {
    if (ts.isIdentifier(n)) {
      const name = n.text;
      if (!deps.includes(name)) {
        deps.push(name);
      }
    }
    ts.forEachChild(n, visit);
  }
  
  visit(node);
  return deps.slice(0, 20); // Limit dependencies
}

function extractCalls(node: ts.Node, sourceFile: ts.SourceFile, caller: string, graph: CallGraph): void {
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression) {
      const callee = n.expression.getText(sourceFile);
      if (!graph.calls.has(caller)) {
        graph.calls.set(caller, new Set());
      }
      graph.calls.get(caller)!.add(callee);
      
      if (!graph.calledBy.has(callee)) {
        graph.calledBy.set(callee, new Set());
      }
      graph.calledBy.get(callee)!.add(caller);
    }
    ts.forEachChild(n, visit);
  }
  
  visit(node);
}

function linkCallGraph(chunks: ParsedChunk[], graph: CallGraph): void {
  for (const chunk of chunks) {
    if (graph.calls.has(chunk.name)) {
      chunk.dependencies.push(...Array.from(graph.calls.get(chunk.name)!));
    }
    if (graph.calledBy.has(chunk.name)) {
      chunk.dependents.push(...Array.from(graph.calledBy.get(chunk.name)!));
    }
  }
}

/**
 * Parse other languages with regex-based fallback
 */
export function parseGenericFile(filePath: string, content: string): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  const ext = path.extname(filePath);
  const lines = content.split('\n');

  const patterns: Record<string, RegExp[]> = {
    '.py': [
      /^(?:async\s+)?def\s+(\w+)\s*\(/,
      /^class\s+(\w+)\s*[\(:]/,
      /^(?:from|import)\s+(\S+)/,
    ],
    '.go': [
      /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/,
      /^type\s+(\w+)\s+(?:struct|interface)/,
    ],
    '.rs': [
      /^(?:async\s+)?fn\s+(\w+)\s*[<(]/,
      /^(?:pub\s+)?struct\s+(\w+)/,
      /^(?:pub\s+)?trait\s+(\w+)/,
    ],
    '.java': [
      /^(?:public\s+|private\s+|protected\s+)?(?:static\s+)?\S+\s+(\w+)\s*\(/,
      /^class\s+(\w+)/,
      /^interface\s+(\w+)/,
    ],
  };

  const filePatterns = patterns[ext] || [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    for (const pattern of filePatterns) {
      const match = line.match(pattern);
      if (match) {
        const name = match[1];
        let chunkType: ParsedChunk['chunkType'] = 'other';
        if (ext === '.py' && pattern.source.includes('def')) chunkType = 'function';
        else if (pattern.source.includes('class') || pattern.source.includes('struct')) chunkType = 'class';
        else if (pattern.source.includes('import') || pattern.source.includes('from')) chunkType = 'import';
        else if (pattern.source.includes('fn') || pattern.source.includes('func')) chunkType = 'function';

        // Extract context around definition
        const contextLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 30));
        
        chunks.push({
          id: `${filePath}::${name}::${i}`,
          filePath,
          content: contextLines.join('\n'),
          chunkType,
          name,
          lineStart: i + 1,
          lineEnd: Math.min(lines.length, i + 30),
          dependencies: [],
          dependents: [],
          isExported: line.includes('export') || line.includes('pub ') || line.includes('public '),
        });
        break;
      }
    }
  }

  return chunks;
}

/**
 * Build cross-file reference graph
 */
export function buildReferenceGraph(allChunks: ParsedChunk[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const chunk of allChunks) {
    if (!graph.has(chunk.id)) {
      graph.set(chunk.id, new Set());
    }

    // Link dependencies
    for (const dep of chunk.dependencies) {
      // Find matching chunk
      const depChunk = allChunks.find(c => c.name === dep && c.filePath !== chunk.filePath);
      if (depChunk) {
        graph.get(chunk.id)!.add(depChunk.id);
        if (!graph.has(depChunk.id)) {
          graph.set(depChunk.id, new Set());
        }
        graph.get(depChunk.id)!.add(chunk.id);
      }
    }
  }

  return graph;
}

/**
 * Get related chunks for a given chunk (dependencies + dependents + imports)
 */
export function getRelatedChunks(chunkId: string, allChunks: ParsedChunk[]): ParsedChunk[] {
  const target = allChunks.find(c => c.id === chunkId);
  if (!target) return [];

  const related = new Set<string>();

  // Add dependencies
  for (const dep of target.dependencies) {
    const depChunk = allChunks.find(c => c.name === dep);
    if (depChunk) related.add(depChunk.id);
  }

  // Add dependents
  for (const dep of target.dependents) {
    const depChunk = allChunks.find(c => c.name === dep);
    if (depChunk) related.add(depChunk.id);
  }

  // Add imports from same file
  for (const chunk of allChunks) {
    if (chunk.filePath === target.filePath && chunk.chunkType === 'import') {
      related.add(chunk.id);
    }
  }

  return allChunks.filter(c => related.has(c.id));
}
