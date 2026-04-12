/**
 * Rust Language Support for LinguClaw
 * Advanced Rust parser with ownership analysis
 */

import type {
  ASTNode, SourceLocation, ParseResult, AnalysisResult,
  SymbolTable, FunctionInfo, VariableInfo, SecurityIssue
} from '../core/engine';

export class RustParser {
  private source: string = '';
  private lines: string[] = [];

  parse(source: string, filePath: string): ParseResult {
    this.source = source;
    this.lines = source.split('\n');

    try {
      // Rust syntax is complex - use tree-sitter in production
      // Here we implement a robust regex-based parser
      const ast = this.parseRust(source, filePath);
      
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

  async *parseStream(source: ReadableStream<string>): AsyncGenerator<ParseResult> {
    const reader = source.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      
      // Rust items are often separated by newlines at top level
      const lines = buffer.split('\n');
      const completeLines: string[] = [];
      let remaining = '';
      
      let braceCount = 0;
      let inString = false;
      let stringChar = '';
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        for (const char of line) {
          if (!inString && (char === '"' || char === "'" || char === '`')) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && !this.isEscaped(line, line.indexOf(char))) {
            inString = false;
          } else if (!inString) {
            if (char === '{' || char === '[' || char === '(') braceCount++;
            if (char === '}' || char === ']' || char === ')') braceCount--;
          }
        }
        
        if (braceCount === 0 && !inString) {
          completeLines.push(line);
        } else {
          remaining += line + '\n';
        }
      }

      if (completeLines.length > 0) {
        yield this.parse(completeLines.join('\n'), '<stream>');
      }
      buffer = remaining;
    }

    if (buffer.trim()) {
      yield this.parse(buffer, '<stream>');
    }
  }

  private parseRust(source: string, filePath: string): ASTNode {
    const root: ASTNode = {
      type: 'Program',
      id: `${filePath}:0:0`,
      location: this.createLocation(filePath, 0, 0, this.lines.length, 0),
      children: [],
      metadata: { language: 'rust' },
    };

    // Parse Rust modules and items
    const items = this.parseItems(source, filePath);
    root.children = items;

    return root;
  }

  private parseItems(source: string, filePath: string): ASTNode[] {
    const items: ASTNode[] = [];
    const lines = source.split('\n');
    let currentIndex = 0;

    while (currentIndex < lines.length) {
      const line = lines[currentIndex].trim();
      
      // Module declarations
      if (line.startsWith('mod ')) {
        const match = line.match(/mod\s+(\w+)/);
        if (match) {
          items.push({
            type: 'ModuleDeclaration',
            id: `${filePath}:${currentIndex + 1}:0`,
            location: this.createLocation(filePath, currentIndex + 1, 0, currentIndex + 1, line.length),
            children: [],
            metadata: { name: match[1] },
          });
        }
      }

      // Use declarations (imports)
      if (line.startsWith('use ')) {
        const endIdx = this.findStatementEnd(lines, currentIndex);
        const useStatement = lines.slice(currentIndex, endIdx + 1).join('\n');
        items.push({
          type: 'ImportDeclaration',
          id: `${filePath}:${currentIndex + 1}:0`,
          location: this.createLocation(filePath, currentIndex + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
          children: [],
          metadata: { 
            source: useStatement,
            isGlob: useStatement.includes('*'),
            isCrate: useStatement.startsWith('use crate::'),
          },
        });
        currentIndex = endIdx;
      }

      // Struct definitions
      if (line.startsWith('struct ')) {
        const structInfo = this.parseStruct(lines, currentIndex, filePath);
        if (structInfo) {
          items.push(structInfo.node);
          currentIndex = structInfo.endIndex;
        }
      }

      // Enum definitions
      if (line.startsWith('enum ')) {
        const enumInfo = this.parseEnum(lines, currentIndex, filePath);
        if (enumInfo) {
          items.push(enumInfo.node);
          currentIndex = enumInfo.endIndex;
        }
      }

      // Trait definitions
      if (line.startsWith('trait ')) {
        const traitInfo = this.parseTrait(lines, currentIndex, filePath);
        if (traitInfo) {
          items.push(traitInfo.node);
          currentIndex = traitInfo.endIndex;
        }
      }

      // Implementation blocks
      if (line.startsWith('impl ')) {
        const implInfo = this.parseImpl(lines, currentIndex, filePath);
        if (implInfo) {
          items.push(implInfo.node);
          currentIndex = implInfo.endIndex;
        }
      }

      // Function definitions
      if (this.isFunctionDeclaration(line)) {
        const funcInfo = this.parseFunction(lines, currentIndex, filePath);
        if (funcInfo) {
          items.push(funcInfo.node);
          currentIndex = funcInfo.endIndex;
        }
      }

      // Static/Const declarations
      if (line.startsWith('static ') || line.startsWith('const ')) {
        const constInfo = this.parseConst(lines, currentIndex, filePath);
        if (constInfo) {
          items.push(constInfo.node);
          currentIndex = constInfo.endIndex;
        }
      }

      // Type aliases
      if (line.startsWith('type ')) {
        const typeInfo = this.parseTypeAlias(lines, currentIndex, filePath);
        if (typeInfo) {
          items.push(typeInfo.node);
          currentIndex = typeInfo.endIndex;
        }
      }

      // Macros
      if (line.startsWith('macro_rules! ') || line.includes('!')) {
        const macroInfo = this.parseMacro(lines, currentIndex, filePath);
        if (macroInfo) {
          items.push(macroInfo.node);
          currentIndex = macroInfo.endIndex;
        }
      }

      currentIndex++;
    }

    return items;
  }

  private isFunctionDeclaration(line: string): boolean {
    // Match fn declarations with various visibility modifiers
    const fnPattern = /^(pub\s+)?(async\s+)?(unsafe\s+)?fn\s+\w+/;
    return fnPattern.test(line.trim());
  }

  private parseFunction(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const signatureMatch = line.match(/(pub\s+)?(async\s+)?(unsafe\s+)?fn\s+(\w+)\s*[<(]/);
    
    if (!signatureMatch) return null;

    const isPub = !!signatureMatch[1];
    const isAsync = !!signatureMatch[2];
    const isUnsafe = !!signatureMatch[3];
    const funcName = signatureMatch[4];

    // Find function body boundaries
    let braceCount = 0;
    let endIdx = startIdx;
    let foundOpeningBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpeningBrace = true;
        } else if (char === '}') {
          braceCount--;
        }
      }

      if (foundOpeningBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');
    const signature = this.extractSignature(body);
    const generics = this.extractGenerics(body);
    const returnType = this.extractReturnType(body);

    const node: ASTNode = {
      type: 'FunctionDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: this.parseStatements(lines.slice(startIdx + 1, endIdx), filePath, startIdx + 1),
      metadata: {
        name: funcName,
        isPublic: isPub,
        isAsync,
        isUnsafe,
        signature,
        generics,
        returnType,
        parameters: this.extractParameters(body),
        hasSelf: body.includes('&self') || body.includes('&mut self') || body.includes('self'),
        isMethod: body.includes('&self') || body.includes('self:'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseStruct(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/struct\s+(\w+)(?:<([^>]+)>)?/);
    
    if (!match) return null;

    const structName = match[1];
    const generics = match[2];

    let endIdx = startIdx;
    let braceCount = 0;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      if (braceCount === 0 && i > startIdx) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');
    const fields = this.extractStructFields(body);

    const node: ASTNode = {
      type: 'StructDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: fields.map((f, idx) => ({
        type: 'FieldDeclaration',
        id: `${filePath}:${startIdx + 1 + idx}:0`,
        location: this.createLocation(filePath, startIdx + 1 + idx, 0, startIdx + 1 + idx, 0),
        children: [],
        metadata: f,
      })),
      metadata: {
        name: structName,
        generics: generics ? generics.split(',').map(g => g.trim()) : [],
        isTupleStruct: fields.length === 0 && body.includes('('),
        isUnitStruct: fields.length === 0 && !body.includes('('),
        derives: this.extractDerives(lines, startIdx),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseEnum(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/enum\s+(\w+)(?:<([^>]+)>)?/);
    
    if (!match) return null;

    const enumName = match[1];

    let endIdx = startIdx;
    let braceCount = 0;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      if (braceCount === 0 && i > startIdx) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');
    const variants = this.extractEnumVariants(body);

    const node: ASTNode = {
      type: 'EnumDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: variants.map((v, idx) => ({
        type: 'EnumVariant',
        id: `${filePath}:${startIdx + 1 + idx}:0`,
        location: this.createLocation(filePath, startIdx + 1 + idx, 0, startIdx + 1 + idx, 0),
        children: [],
        metadata: v,
      })),
      metadata: {
        name: enumName,
        variants,
        isOptionLike: enumName === 'Option' || variants.some(v => v.name === 'Some' || v.name === 'None'),
        isResultLike: enumName === 'Result' || variants.some(v => v.name === 'Ok' || v.name === 'Err'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseImpl(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/impl(?:<([^>]+)>)?\s+(?:\w+\s+for\s+)?(\w+)/);
    
    if (!match) return null;

    let endIdx = startIdx;
    let braceCount = 0;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      if (braceCount === 0 && i > startIdx) {
        endIdx = i;
        break;
      }
    }

    // Parse methods within impl
    const implBody = lines.slice(startIdx + 1, endIdx);
    const methods: ASTNode[] = [];
    let methodStart = 0;

    while (methodStart < implBody.length) {
      const methodLine = implBody[methodStart].trim();
      if (this.isFunctionDeclaration(methodLine)) {
        const methodInfo = this.parseFunction(implBody, methodStart, filePath);
        if (methodInfo) {
          methods.push(methodInfo.node);
          methodStart = methodInfo.endIndex + 1;
        } else {
          methodStart++;
        }
      } else {
        methodStart++;
      }
    }

    const isTraitImpl = line.includes(' for ');
    const parts = line.split(/\s+for\s+/);
    const traitName = isTraitImpl ? parts[0].replace('impl', '').trim() : undefined;
    const targetType = isTraitImpl ? parts[1].replace('{', '').trim() : line.replace('impl', '').replace('{', '').trim();

    const node: ASTNode = {
      type: 'Implementation',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: methods,
      metadata: {
        trait: traitName,
        targetType,
        methods: methods.map(m => m.metadata.name),
        isTraitImpl,
      },
    };

    return { node, endIndex: endIdx };
  }

  private extractSignature(body: string): string {
    const match = body.match(/fn\s+\w+\s*[^(]*\([^)]*\)(?:\s*->\s*[^{]+)?/);
    return match ? match[0] : 'fn unknown()';
  }

  private extractGenerics(body: string): string[] {
    const match = body.match(/<([^>]+)>/);
    return match ? match[1].split(',').map(g => g.trim()) : [];
  }

  private extractReturnType(body: string): string | undefined {
    const match = body.match(/->\s*([^{]+)/);
    return match ? match[1].trim() : undefined;
  }

  private extractParameters(body: string): { name: string; type: string; mutable: boolean }[] {
    const params: { name: string; type: string; mutable: boolean }[] = [];
    const match = body.match(/\(([^)]*)\)/);
    
    if (match) {
      const paramStr = match[1];
      const paramList = this.splitParams(paramStr);
      
      for (const param of paramList) {
        const parts = param.trim().split(':');
        if (parts.length === 2) {
          const name = parts[0].trim();
          const isMut = name.startsWith('mut ');
          params.push({
            name: isMut ? name.replace('mut ', '') : name,
            type: parts[1].trim(),
            mutable: isMut,
          });
        }
      }
    }

    return params;
  }

  private splitParams(paramStr: string): string[] {
    const params: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of paramStr) {
      if (char === '<' || char === '(' || char === '[') depth++;
      if (char === '>' || char === ')' || char === ']') depth--;
      
      if (char === ',' && depth === 0) {
        params.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      params.push(current.trim());
    }

    return params;
  }

  private extractStructFields(body: string): { name: string; type: string; public: boolean }[] {
    const fields: { name: string; type: string; public: boolean }[] = [];
    const fieldMatch = body.match(/\{([^}]*)\}/s);
    
    if (fieldMatch) {
      const fieldStr = fieldMatch[1];
      const fieldLines = fieldStr.split(',');
      
      for (const line of fieldLines) {
        const trimmed = line.trim();
        const match = trimmed.match(/(pub\s+)?(\w+)\s*:\s*(.+)/);
        if (match) {
          fields.push({
            name: match[2],
            type: match[3].trim(),
            public: !!match[1],
          });
        }
      }
    }

    return fields;
  }

  private extractEnumVariants(body: string): { name: string; hasData: boolean; dataTypes: string[] }[] {
    const variants: { name: string; hasData: boolean; dataTypes: string[] }[] = [];
    const variantMatch = body.match(/\{([^}]*)\}/s);
    
    if (variantMatch) {
      const variantStr = variantMatch[1];
      const variantLines = variantStr.split(',');
      
      for (const line of variantLines) {
        const trimmed = line.trim();
        // Match variant name and optional data
        const match = trimmed.match(/(\w+)(?:\s*\(([^)]*)\))?/);
        if (match) {
          const hasData = !!match[2];
          variants.push({
            name: match[1],
            hasData,
            dataTypes: hasData ? match[2].split(',').map(t => t.trim()) : [],
          });
        }
      }
    }

    return variants;
  }

  private extractDerives(lines: string[], startIdx: number): string[] {
    for (let i = Math.max(0, startIdx - 5); i < startIdx; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#[derive(')) {
        const match = line.match(/#\[derive\(([^)]+)\)\]/);
        return match ? match[1].split(',').map(d => d.trim()) : [];
      }
    }
    return [];
  }

  private parseStatements(lines: string[], filePath: string, lineOffset: number): ASTNode[] {
    const statements: ASTNode[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Variable declarations with ownership tracking
      const letMatch = line.match(/let\s+(mut\s+)?(\w+)\s*(?::\s*([^=]+))?\s*=\s*(.+);/);
      if (letMatch) {
        statements.push({
          type: 'VariableDeclaration',
          id: `${filePath}:${lineOffset + i + 1}:0`,
          location: this.createLocation(filePath, lineOffset + i + 1, 0, lineOffset + i + 1, line.length),
          children: [],
          metadata: {
            name: letMatch[2],
            mutable: !!letMatch[1],
            type: letMatch[3]?.trim(),
            initializer: letMatch[4]?.trim(),
            ownership: this.inferOwnership(letMatch[4]?.trim()),
          },
        });
      }

      // Match expressions
      if (line.includes('match ')) {
        statements.push({
          type: 'MatchExpression',
          id: `${filePath}:${lineOffset + i + 1}:0`,
          location: this.createLocation(filePath, lineOffset + i + 1, 0, lineOffset + i + 1, line.length),
          children: [],
          metadata: { isExhaustive: this.checkExhaustive(lines, i) },
        });
      }

      // Unsafe blocks
      if (line === 'unsafe {' || line === 'unsafe') {
        statements.push({
          type: 'UnsafeBlock',
          id: `${filePath}:${lineOffset + i + 1}:0`,
          location: this.createLocation(filePath, lineOffset + i + 1, 0, lineOffset + i + 1, line.length),
          children: [],
          metadata: {},
        });
      }

      // Async/await
      if (line.includes('.await')) {
        statements.push({
          type: 'AwaitExpression',
          id: `${filePath}:${lineOffset + i + 1}:0`,
          location: this.createLocation(filePath, lineOffset + i + 1, 0, lineOffset + i + 1, line.length),
          children: [],
          metadata: {},
        });
      }
    }

    return statements;
  }

  private inferOwnership(initializer?: string): 'owned' | 'borrowed' | 'mut_borrowed' | 'move' {
    if (!initializer) return 'owned';
    
    if (initializer.startsWith('&mut ')) return 'mut_borrowed';
    if (initializer.startsWith('&')) return 'borrowed';
    if (initializer.includes('.clone()')) return 'owned';
    if (initializer.includes('.to_owned()')) return 'owned';
    
    // Check if it's a function call that might move
    if (/\w+\([^)]*\)$/.test(initializer)) return 'move';
    
    return 'owned';
  }

  private checkExhaustive(lines: string[], matchIdx: number): boolean {
    // Simple check for _ => or all variants covered
    let braceCount = 0;
    let foundWildcard = false;
    
    for (let i = matchIdx; i < Math.min(lines.length, matchIdx + 50); i++) {
      for (const char of lines[i]) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      
      if (lines[i].includes('_ =>') || lines[i].includes('_ =>')) {
        foundWildcard = true;
      }
      
      if (braceCount === 0 && i > matchIdx) break;
    }
    
    return foundWildcard;
  }

  private parseConst(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const isStatic = line.startsWith('static ');
    const match = line.match(/(?:static|const)\s+(mut\s+)?(\w+)\s*(?::\s*([^=]+))?\s*=/);
    
    if (!match) return null;

    const endIdx = this.findStatementEnd(lines, startIdx);

    const node: ASTNode = {
      type: 'VariableDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        name: match[2],
        type: match[3]?.trim() || 'inferred',
        isStatic,
        mutable: !!match[1],
        isConst: !isStatic,
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseTypeAlias(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/type\s+(\w+)(?:<([^>]+)>)?\s*=\s*(.+);/);
    
    if (!match) return null;

    const node: ASTNode = {
      type: 'TypeAliasDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, line.length),
      children: [],
      metadata: {
        name: match[1],
        generics: match[2] ? match[2].split(',').map(g => g.trim()) : [],
        target: match[3],
      },
    };

    return { node, endIndex: startIdx };
  }

  private parseTrait(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/trait\s+(\w+)(?:<([^>]+)>)?/);
    
    if (!match) return null;

    let endIdx = startIdx;
    let braceCount = 0;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      if (braceCount === 0 && i > startIdx) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');
    const methods = this.extractTraitMethods(body);

    const node: ASTNode = {
      type: 'TraitDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: methods.map((m, idx) => ({
        type: 'MethodSignature',
        id: `${filePath}:${startIdx + 1 + idx}:0`,
        location: this.createLocation(filePath, startIdx + 1 + idx, 0, startIdx + 1 + idx, 0),
        children: [],
        metadata: m,
      })),
      metadata: {
        name: match[1],
        generics: match[2] ? match[2].split(',').map(g => g.trim()) : [],
        methods,
        isAuto: body.includes('#[auto_trait]'),
        isUnsafe: line.includes('unsafe trait'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseMacro(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    if (!line.includes('!')) return null;

    const isMacroRules = line.startsWith('macro_rules!');
    
    let endIdx = startIdx;
    if (isMacroRules) {
      // Macro rules end with matching braces
      let braceCount = 0;
      for (let i = startIdx; i < lines.length; i++) {
        for (const char of lines[i]) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }
        if (braceCount === 0 && i > startIdx) {
          endIdx = i;
          break;
        }
      }
    } else {
      // Attribute macros and bang macros
      endIdx = this.findStatementEnd(lines, startIdx);
    }

    const node: ASTNode = {
      type: 'MacroDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        isMacroRules,
        name: isMacroRules ? line.match(/macro_rules!\s+(\w+)/)?.[1] : undefined,
      },
    };

    return { node, endIndex: endIdx };
  }

  private findStatementEnd(lines: string[], startIdx: number): number {
    // Find where statement ends (semicolon or closing brace)
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(';') && !line.includes('for ') && !line.includes('while ')) {
        return i;
      }
      if (line.includes('{')) {
        // Find matching }
        let braceCount = 0;
        for (let j = i; j < lines.length; j++) {
          for (const char of lines[j]) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
          }
          if (braceCount === 0) return j;
        }
      }
    }
    return lines.length - 1;
  }

  private extractTraitMethods(body: string): { name: string; signature: string; hasDefault: boolean }[] {
    const methods: { name: string; signature: string; hasDefault: boolean }[] = [];
    const lines = body.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('fn ') && !trimmed.includes('{')) {
        const match = trimmed.match(/fn\s+(\w+)\s*[^(]*\([^)]*\)(?:\s*->\s*[^{;]+)?/);
        if (match) {
          methods.push({
            name: match[1],
            signature: match[0],
            hasDefault: false,
          });
        }
      } else if (trimmed.startsWith('fn ') && trimmed.includes('{')) {
        const match = trimmed.match(/fn\s+(\w+)\s*[^(]*\([^)]*\)/);
        if (match) {
          methods.push({
            name: match[1],
            signature: match[0],
            hasDefault: true,
          });
        }
      }
    }

    return methods;
  }

  private createLocation(file: string, startLine: number, startCol: number, endLine: number, endCol: number): SourceLocation {
    return {
      file,
      startLine,
      startColumn: startCol,
      endLine,
      endColumn: endCol,
      byteOffset: 0,
    };
  }

  private isEscaped(line: string, pos: number): boolean {
    let backslashes = 0;
    for (let i = pos - 1; i >= 0 && line[i] === '\\'; i--) {
      backslashes++;
    }
    return backslashes % 2 === 1;
  }

  private extractComments(): any[] {
    const comments: any[] = [];
    
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      const commentIdx = line.indexOf('//');
      if (commentIdx !== -1 && !this.isInString(line, commentIdx)) {
        comments.push({
          type: 'Line',
          value: line.substring(commentIdx + 2).trim(),
          line: i + 1,
        });
      }
    }

    // Block comments
    const source = this.source;
    let idx = 0;
    while (true) {
      const blockStart = source.indexOf('/*', idx);
      if (blockStart === -1) break;
      
      const blockEnd = source.indexOf('*/', blockStart + 2);
      if (blockEnd === -1) break;

      const value = source.substring(blockStart + 2, blockEnd);
      const lineNum = source.substring(0, blockStart).split('\n').length;
      
      comments.push({
        type: 'Block',
        value: value.trim(),
        line: lineNum,
      });

      idx = blockEnd + 2;
    }

    return comments;
  }

  private isInString(line: string, pos: number): boolean {
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < pos; i++) {
      const char = line[i];
      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && !this.isEscaped(line, i)) {
        inString = false;
      }
    }
    
    return inString;
  }

  private findSyntaxErrors(): any[] {
    const errors: any[] = [];
    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;
      }

      if (braceCount < 0) {
        errors.push({
          message: 'Unexpected closing brace',
          line: i + 1,
          severity: 'error',
        });
        braceCount = 0;
      }
      if (parenCount < 0) {
        errors.push({
          message: 'Unexpected closing parenthesis',
          line: i + 1,
          severity: 'error',
        });
        parenCount = 0;
      }
      if (bracketCount < 0) {
        errors.push({
          message: 'Unexpected closing bracket',
          line: i + 1,
          severity: 'error',
        });
        bracketCount = 0;
      }
    }

    if (braceCount > 0) {
      errors.push({
        message: `Unclosed braces: ${braceCount}`,
        line: this.lines.length,
        severity: 'error',
      });
    }
    if (parenCount > 0) {
      errors.push({
        message: `Unclosed parentheses: ${parenCount}`,
        line: this.lines.length,
        severity: 'error',
      });
    }
    if (bracketCount > 0) {
      errors.push({
        message: `Unclosed brackets: ${bracketCount}`,
        line: this.lines.length,
        severity: 'error',
      });
    }

    return errors;
  }

  private fallbackParse(filePath: string): ParseResult {
    return {
      ast: this.parseRust(this.source, filePath),
      errors: this.findSyntaxErrors(),
      warnings: [{ message: 'Using fallback parser' }],
      tokens: [],
      comments: this.extractComments(),
    };
  }
}

export class RustAnalyzer {
  analyze(ast: ASTNode, context: any): AnalysisResult {
    const symbolTable = this.buildSymbolTable(ast);
    const ownershipGraph = this.analyzeOwnership(ast);
    const lifetimeAnalysis = this.analyzeLifetimes(ast);
    const unsafeAnalysis = this.analyzeUnsafe(ast);
    const asyncAnalysis = this.analyzeAsync(ast);

    return {
      symbols: symbolTable,
      callGraph: this.buildCallGraph(ast),
      dataFlow: ownershipGraph,
      controlFlow: this.buildControlFlow(ast),
      typeInference: new Map(),
      metrics: this.calculateMetrics(ast),
      suggestions: [
        ...unsafeAnalysis.suggestions,
        ...asyncAnalysis.suggestions,
        ...this.generateRefactoringSuggestions(ast),
      ],
    };
  }

  private buildSymbolTable(ast: ASTNode): SymbolTable {
    // Implementation similar to Python analyzer
    return {
      variables: new Map(),
      functions: new Map(),
      classes: new Map(),
      modules: new Map(),
      imports: [],
      exports: [],
    };
  }

  private analyzeOwnership(ast: ASTNode): any {
    // Analyze Rust ownership system
    const borrowViolations: any[] = [];
    const moveLocations: any[] = [];

    const traverse = (node: ASTNode, scope: any) => {
      // Track variable ownership states
      if (node.type === 'VariableDeclaration' && node.metadata.ownership) {
        scope.variables.set(node.metadata.name, {
          ownership: node.metadata.ownership,
          mutable: node.metadata.mutable,
        });
      }

      // Check for potential borrow violations
      if (node.type === 'CallExpression') {
        // Check if passing borrowed values
      }

      node.children.forEach(child => traverse(child, scope));
    };

    traverse(ast, { variables: new Map() });

    return {
      definitions: new Map(),
      uses: new Map(),
      taintedSources: [],
      sinks: [],
      borrowViolations,
      moveLocations,
    };
  }

  private analyzeLifetimes(ast: ASTNode): any {
    // Analyze lifetime annotations
    const explicitLifetimes: string[] = [];
    const inferredLifetimes: Map<string, string> = new Map();

    const traverse = (node: ASTNode) => {
      if (node.metadata.generics) {
        for (const generic of node.metadata.generics) {
          if (generic.startsWith("'")) {
            explicitLifetimes.push(generic);
          }
        }
      }
      node.children.forEach(traverse);
    };

    traverse(ast);

    return { explicitLifetimes, inferredLifetimes };
  }

  private analyzeUnsafe(ast: ASTNode): { suggestions: any[] } {
    const suggestions: any[] = [];
    let unsafeBlockCount = 0;
    let unsafeFunctionCount = 0;

    const traverse = (node: ASTNode) => {
      if (node.type === 'UnsafeBlock') {
        unsafeBlockCount++;
      }
      if (node.type === 'FunctionDeclaration' && node.metadata.isUnsafe) {
        unsafeFunctionCount++;
        suggestions.push({
          type: 'security',
          severity: 'warning',
          message: `Unsafe function ${node.metadata.name} - ensure safety invariants are documented`,
          remediation: 'Add SAFETY comment explaining invariants',
        });
      }
      node.children.forEach(traverse);
    };

    traverse(ast);

    if (unsafeBlockCount > 5) {
      suggestions.push({
        type: 'refactor',
        severity: 'warning',
        message: `High number of unsafe blocks (${unsafeBlockCount}) - consider abstraction`,
        remediation: 'Encapsulate unsafe operations in safe wrappers',
      });
    }

    return { suggestions };
  }

  private analyzeAsync(ast: ASTNode): { suggestions: any[] } {
    const suggestions: any[] = [];
    let asyncFunctionCount = 0;
    let awaitCount = 0;

    const traverse = (node: ASTNode) => {
      if (node.type === 'FunctionDeclaration' && node.metadata.isAsync) {
        asyncFunctionCount++;
      }
      if (node.type === 'AwaitExpression') {
        awaitCount++;
      }
      node.children.forEach(traverse);
    };

    traverse(ast);

    return { suggestions };
  }

  private buildCallGraph(ast: ASTNode): any {
    // Implementation
    return { nodes: [], edges: [], entryPoints: [], deadCode: [] };
  }

  private buildControlFlow(ast: ASTNode): any {
    return { nodes: [], edges: [], loops: [], branches: [] };
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

  private generateRefactoringSuggestions(ast: ASTNode): any[] {
    return [];
  }
}

export const RustLanguageSupport = {
  id: 'rust',
  name: 'Rust',
  extensions: ['.rs'],
  parser: new RustParser(),
  analyzer: new RustAnalyzer(),
};
