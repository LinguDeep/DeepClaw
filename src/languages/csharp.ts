/**
 * C# Language Support for LinguClaw
 * Advanced parser with LINQ, async/await, and .NET ecosystem analysis
 */

import type {
  ASTNode, ParseResult, AnalysisResult, SymbolTable,
  FunctionInfo, ClassInfo, SecurityIssue
} from '../core/engine';

export class CSharpParser {
  private source: string = '';
  private lines: string[] = [];
  private currentLine: number = 0;

  parse(source: string, filePath: string): ParseResult {
    this.source = source;
    this.lines = source.split('\n');
    this.currentLine = 0;

    try {
      const ast = this.parseCSharp(source, filePath);
      
      return {
        ast,
        errors: this.findSyntaxErrors(),
        warnings: this.findPreprocessorIssues(),
        tokens: [],
        comments: this.extractComments(),
      };
    } catch (error) {
      return this.fallbackParse(filePath);
    }
  }

  private parseCSharp(source: string, filePath: string): ASTNode {
    const root: ASTNode = {
      type: 'CompilationUnit',
      id: `${filePath}:0:0`,
      location: this.createLocation(filePath, 0, 0, this.lines.length, 0),
      children: [],
      metadata: { language: 'csharp' },
    };

    // Parse using directives
    const usings = this.parseUsingDirectives(source, filePath);
    root.children.push(...usings);

    // Parse namespace declarations
    const namespaces = this.parseNamespaces(source, filePath);
    root.children.push(...namespaces);

    // Parse top-level statements (C# 9.0+)
    const topLevel = this.parseTopLevelStatements(source, filePath);
    if (topLevel.length > 0) {
      root.children.push(...topLevel);
    }

    return root;
  }

  private parseUsingDirectives(source: string, filePath: string): ASTNode[] {
    const directives: ASTNode[] = [];
    const usingRegex = /^(global\s+)?using\s+(static\s+)?([\w.]+)\s*(?:=\s*([\w.<>]+))?\s*;/gm;
    let match;

    while ((match = usingRegex.exec(source)) !== null) {
      const isGlobal = !!match[1];
      const isStatic = !!match[2];
      const namespace = match[3];
      const alias = match[4];
      const lineNum = source.substring(0, match.index).split('\n').length;

      const node: ASTNode = {
        type: 'UsingDirective',
        id: `${filePath}:${lineNum}:0`,
        location: this.createLocation(filePath, lineNum, 0, lineNum, match[0].length),
        children: [],
        metadata: {
          isGlobal,
          isStatic,
          namespace,
          alias,
          isAlias: !!alias,
        },
      };

      directives.push(node);
    }

    return directives;
  }

  private parseNamespaces(source: string, filePath: string): ASTNode[] {
    const namespaces: ASTNode[] = [];
    const lines = source.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      if (line.startsWith('namespace ')) {
        const nsDecl = this.parseNamespace(lines, i, filePath);
        if (nsDecl) {
          namespaces.push(nsDecl.node);
          i = nsDecl.endIndex + 1;
          continue;
        }
      } else if (line.startsWith('file ')) {
        // File-scoped namespace (C# 10.0+)
        const fileNsDecl = this.parseFileScopedNamespace(lines, i, filePath);
        if (fileNsDecl) {
          namespaces.push(fileNsDecl.node);
          i = fileNsDecl.endIndex + 1;
          continue;
        }
      }

      i++;
    }

    return namespaces;
  }

  private parseNamespace(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/namespace\s+([\w.]+)\s*{/);
    if (!match) return null;

    const name = match[1];
    let braceCount = 1;
    let endIdx = startIdx;

    for (let i = startIdx + 1; i < lines.length && braceCount > 0; i++) {
      for (const char of lines[i]) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      if (braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx + 1, endIdx);
    const members = this.parseTypeDeclarations(body.join('\n'), filePath);

    const node: ASTNode = {
      type: 'NamespaceDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: members,
      metadata: {
        name,
        isFileScoped: false,
        memberCount: members.length,
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseFileScopedNamespace(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    // File-scoped namespace ends with semicolon, not braces
    const match = line.match(/namespace\s+([\w.]+)\s*;/);
    if (!match) return null;

    const name = match[1];
    
    // All remaining declarations belong to this namespace
    const remainingLines = lines.slice(startIdx + 1);
    const members = this.parseTypeDeclarations(remainingLines.join('\n'), filePath);

    const node: ASTNode = {
      type: 'NamespaceDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, lines.length, 0),
      children: members,
      metadata: {
        name,
        isFileScoped: true,
        memberCount: members.length,
      },
    };

    return { node, endIndex: lines.length - 1 };
  }

  private parseTypeDeclarations(source: string, filePath: string): ASTNode[] {
    const declarations: ASTNode[] = [];
    const lines = source.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      // Skip empty lines, comments, attributes
      if (!line || line.startsWith('//') || line.startsWith('#') || line.startsWith('[')) {
        if (line.startsWith('[')) {
          // Parse attributes
          const attrDecl = this.parseAttribute(lines, i, filePath);
          if (attrDecl) {
            i = attrDecl.endIndex + 1;
            continue;
          }
        }
        i++;
        continue;
      }

      // Class
      if (this.isClassDeclaration(line)) {
        const classDecl = this.parseClass(lines, i, filePath);
        if (classDecl) {
          declarations.push(classDecl.node);
          i = classDecl.endIndex + 1;
          continue;
        }
      }

      // Interface
      if (this.isInterfaceDeclaration(line)) {
        const ifaceDecl = this.parseInterface(lines, i, filePath);
        if (ifaceDecl) {
          declarations.push(ifaceDecl.node);
          i = ifaceDecl.endIndex + 1;
          continue;
        }
      }

      // Struct
      if (this.isStructDeclaration(line)) {
        const structDecl = this.parseStruct(lines, i, filePath);
        if (structDecl) {
          declarations.push(structDecl.node);
          i = structDecl.endIndex + 1;
          continue;
        }
      }

      // Enum
      if (this.isEnumDeclaration(line)) {
        const enumDecl = this.parseEnum(lines, i, filePath);
        if (enumDecl) {
          declarations.push(enumDecl.node);
          i = enumDecl.endIndex + 1;
          continue;
        }
      }

      // Record
      if (this.isRecordDeclaration(line)) {
        const recordDecl = this.parseRecord(lines, i, filePath);
        if (recordDecl) {
          declarations.push(recordDecl.node);
          i = recordDecl.endIndex + 1;
          continue;
        }
      }

      // Delegate
      if (this.isDelegateDeclaration(line)) {
        const delegateDecl = this.parseDelegate(lines, i, filePath);
        if (delegateDecl) {
          declarations.push(delegateDecl.node);
          i = delegateDecl.endIndex + 1;
          continue;
        }
      }

      i++;
    }

    return declarations;
  }

  private isClassDeclaration(line: string): boolean {
    return /^(?:public|private|protected|internal|abstract|sealed|static|partial|unsafe)?\s*(?:class)\s+\w+/.test(line);
  }

  private isInterfaceDeclaration(line: string): boolean {
    return /^(?:public|private|protected|internal|partial)?\s*interface\s+\w+/.test(line);
  }

  private isStructDeclaration(line: string): boolean {
    return /^(?:public|private|protected|internal|readonly|ref|partial|unsafe)?\s*struct\s+\w+/.test(line);
  }

  private isEnumDeclaration(line: string): boolean {
    return /^(?:public|private|protected|internal)?\s*enum\s+\w+/.test(line);
  }

  private isRecordDeclaration(line: string): boolean {
    return /^(?:public|private|protected|internal|abstract|sealed|readonly|ref|partial)?\s*record\s+(?:class|struct\s+)?\w+/.test(line);
  }

  private isDelegateDeclaration(line: string): boolean {
    return /^(?:public|private|protected|internal)?\s*delegate\s+/.test(line);
  }

  private parseClass(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    // Extract modifiers and class name
    const match = line.match(/^(.*?)class\s+(\w+)(?:<([^>]+)>)?(?:\s*:\s*([^{]+))?/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const name = match[2];
    const typeParams = match[3];
    const inheritance = match[4];

    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');
    const members = this.parseClassMembers(body, filePath);

    const node: ASTNode = {
      type: 'ClassDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: members,
      metadata: {
        name,
        modifiers,
        typeParameters: typeParams ? typeParams.split(',').map(p => p.trim()) : [],
        isGeneric: !!typeParams,
        isAbstract: modifiers.includes('abstract'),
        isSealed: modifiers.includes('sealed'),
        isStatic: modifiers.includes('static'),
        isPartial: modifiers.includes('partial'),
        isUnsafe: modifiers.includes('unsafe'),
        inheritance: this.parseInheritance(inheritance),
        baseClass: inheritance?.split(',')[0]?.trim() || null,
        implementedInterfaces: inheritance?.split(',').slice(1).map(i => i.trim()) || [],
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseInterface(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/^(.*?)interface\s+(\w+)(?:<([^>]+)>)?(?:\s*:\s*([^{]+))?/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const name = match[2];
    const typeParams = match[3];
    const inheritance = match[4];

    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');
    const members = this.parseInterfaceMembers(body, filePath);

    const node: ASTNode = {
      type: 'InterfaceDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: members,
      metadata: {
        name,
        modifiers,
        typeParameters: typeParams ? typeParams.split(',').map(p => p.trim()) : [],
        isGeneric: !!typeParams,
        isPartial: modifiers.includes('partial'),
        extendedInterfaces: inheritance?.split(',').map(i => i.trim()) || [],
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseStruct(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/^(.*?)struct\s+(\w+)(?:<([^>]+)>)?(?:\s*:\s*([^{]+))?/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const name = match[2];
    const typeParams = match[3];
    const inheritance = match[4];

    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');
    const members = this.parseStructMembers(body, filePath);

    const node: ASTNode = {
      type: 'StructDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: members,
      metadata: {
        name,
        modifiers,
        typeParameters: typeParams ? typeParams.split(',').map(p => p.trim()) : [],
        isGeneric: !!typeParams,
        isReadonly: modifiers.includes('readonly'),
        isRef: modifiers.includes('ref'),
        isPartial: modifiers.includes('partial'),
        isUnsafe: modifiers.includes('unsafe'),
        implementedInterfaces: inheritance?.split(',').map(i => i.trim()) || [],
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseRecord(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/^(.*?)record\s+(?:class|struct\s+)?(\w+)(?:<([^>]+)>)?(?:\s*\(([^)]*)\))?(?:\s*:\s*([^{]+))?/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const name = match[2];
    const typeParams = match[3];
    const positionalParams = match[4];
    const inheritance = match[5];

    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if ((foundOpenBrace && braceCount === 0) || (positionalParams && !inheritance && lines[i].includes(';'))) {
        endIdx = i;
        break;
      }
    }

    const node: ASTNode = {
      type: 'RecordDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        name,
        modifiers,
        typeParameters: typeParams ? typeParams.split(',').map(p => p.trim()) : [],
        isGeneric: !!typeParams,
        isClass: !modifiers.includes('struct') && !line.includes('record struct'),
        isStruct: modifiers.includes('struct') || line.includes('record struct'),
        positionalParameters: positionalParams ? positionalParams.split(',').map(p => p.trim()) : [],
        inheritance: this.parseInheritance(inheritance),
        isAbstract: modifiers.includes('abstract'),
        isSealed: modifiers.includes('sealed'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseEnum(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/^(.*?)enum\s+(\w+)(?:\s*:\s*(\w+))?/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const name = match[2];
    const underlyingType = match[3] || 'int';

    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');
    const values = this.extractEnumValues(body);

    const node: ASTNode = {
      type: 'EnumDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        name,
        modifiers,
        underlyingType,
        values,
        hasFlagsAttribute: modifiers.includes('[Flags]') || body.includes('[Flags]'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseDelegate(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/^(.*?)delegate\s+([\w<>\[\],\s]+)\s+(\w+)\s*\(([^)]*)\)\s*;/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const returnType = match[2].trim();
    const name = match[3];
    const parameters = match[4];

    const node: ASTNode = {
      type: 'DelegateDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, line.length),
      children: [],
      metadata: {
        name,
        modifiers,
        returnType,
        parameters: parameters ? parameters.split(',').map(p => p.trim()) : [],
      },
    };

    return { node, endIndex: startIdx };
  }

  private parseAttribute(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/^\[([\w]+)(?:\(([^)]*)\))?\]\s*(?:$|\/\/)/);
    if (!match) return null;

    const name = match[1];
    const arguments_ = match[2];

    // Check if it's a target-specific attribute [target: Attribute]
    const targetMatch = line.match(/^\[(\w+):\s*([\w]+)/);

    const node: ASTNode = {
      type: 'Attribute',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, line.length),
      children: [],
      metadata: {
        name: targetMatch ? targetMatch[2] : name,
        target: targetMatch ? targetMatch[1] : null,
        arguments: arguments_ || null,
      },
    };

    return { node, endIndex: startIdx };
  }

  private parseClassMembers(body: string, filePath: string): ASTNode[] {
    const members: ASTNode[] = [];
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('//') || line.startsWith('/*')) continue;

      // Method
      if (this.isMethodDeclaration(line)) {
        const methodDecl = this.parseMethod(lines, i, filePath);
        if (methodDecl) {
          members.push(methodDecl.node);
          i = methodDecl.endIndex;
        }
      }

      // Property
      if (this.isPropertyDeclaration(line)) {
        const propDecl = this.parseProperty(lines, i, filePath);
        if (propDecl) {
          members.push(propDecl.node);
          i = propDecl.endIndex;
        }
      }

      // Field
      if (this.isFieldDeclaration(line)) {
        const fieldDecl = this.parseField(lines, i, filePath);
        if (fieldDecl) {
          members.push(fieldDecl.node);
          i = fieldDecl.endIndex;
        }
      }

      // Constructor
      if (this.isConstructorDeclaration(line)) {
        const ctorDecl = this.parseConstructor(lines, i, filePath);
        if (ctorDecl) {
          members.push(ctorDecl.node);
          i = ctorDecl.endIndex;
        }
      }

      // Destructor/Finalizer
      if (line.includes('~' + this.extractClassName(body))) {
        const dtorDecl = this.parseDestructor(lines, i, filePath);
        if (dtorDecl) {
          members.push(dtorDecl.node);
          i = dtorDecl.endIndex;
        }
      }

      // Event
      if (this.isEventDeclaration(line)) {
        const eventDecl = this.parseEvent(lines, i, filePath);
        if (eventDecl) {
          members.push(eventDecl.node);
          i = eventDecl.endIndex;
        }
      }

      // Indexer
      if (this.isIndexerDeclaration(line)) {
        const indexerDecl = this.parseIndexer(lines, i, filePath);
        if (indexerDecl) {
          members.push(indexerDecl.node);
          i = indexerDecl.endIndex;
        }
      }

      // Operator
      if (this.isOperatorDeclaration(line)) {
        const operatorDecl = this.parseOperator(lines, i, filePath);
        if (operatorDecl) {
          members.push(operatorDecl.node);
          i = operatorDecl.endIndex;
        }
      }

      // Nested type
      if (this.isNestedTypeDeclaration(line)) {
        const nestedDecl = this.parseNestedType(lines, i, filePath);
        if (nestedDecl) {
          members.push(nestedDecl.node);
          i = nestedDecl.endIndex;
        }
      }
    }

    return members;
  }

  private parseInterfaceMembers(body: string, filePath: string): ASTNode[] {
    const members: ASTNode[] = [];
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Method signature
      const methodMatch = line.match(/([\w<>\[\],\s]+)\s+(\w+)\s*\(([^)]*)\)\s*;/);
      if (methodMatch) {
        members.push({
          type: 'MethodDeclaration',
          id: `${filePath}:${i + 1}:0`,
          location: this.createLocation(filePath, i + 1, 0, i + 1, line.length),
          children: [],
          metadata: {
            name: methodMatch[2],
            returnType: methodMatch[1].trim(),
            parameters: methodMatch[3],
            isAbstract: true,
          },
        });
      }

      // Property signature
      const propMatch = line.match(/([\w<>\[\],\s]+)\s+(\w+)\s*\{\s*(get|set)\s*;\s*(?:get|set)?\s*;?\s*\}/);
      if (propMatch) {
        members.push({
          type: 'PropertyDeclaration',
          id: `${filePath}:${i + 1}:0`,
          location: this.createLocation(filePath, i + 1, 0, i + 1, line.length),
          children: [],
          metadata: {
            name: propMatch[2],
            type: propMatch[1].trim(),
            hasGetter: line.includes('get'),
            hasSetter: line.includes('set'),
          },
        });
      }

      // Indexer signature
      const indexerMatch = line.match(/([\w<>\[\],\s]+)\s+this\s*\[([^\]]+)\]\s*\{/);
      if (indexerMatch) {
        members.push({
          type: 'IndexerDeclaration',
          id: `${filePath}:${i + 1}:0`,
          location: this.createLocation(filePath, i + 1, 0, i + 1, line.length),
          children: [],
          metadata: {
            type: indexerMatch[1].trim(),
            parameters: indexerMatch[2],
          },
        });
      }

      // Event signature
      const eventMatch = line.match(/event\s+([\w<>]+)\s+(\w+)\s*;/);
      if (eventMatch) {
        members.push({
          type: 'EventDeclaration',
          id: `${filePath}:${i + 1}:0`,
          location: this.createLocation(filePath, i + 1, 0, i + 1, line.length),
          children: [],
          metadata: {
            name: eventMatch[2],
            type: eventMatch[1].trim(),
          },
        });
      }
    }

    return members;
  }

  private parseStructMembers(body: string, filePath: string): ASTNode[] {
    // Structs have same members as classes
    return this.parseClassMembers(body, filePath);
  }

  private isMethodDeclaration(line: string): boolean {
    return /(?:public|private|protected|internal|static|virtual|abstract|override|sealed|extern|async|partial|unsafe)?\s*(?:[\w<>\[\],\s]+)\s+\w+\s*\(/.test(line) &&
           !line.includes('class ') &&
           !line.includes('struct ') &&
           !line.includes('interface ') &&
           !line.includes('enum ') &&
           !line.includes('delegate ') &&
           !line.includes('record ');
  }

  private isPropertyDeclaration(line: string): boolean {
    return /(?:public|private|protected|internal|static|virtual|abstract|override|sealed|extern)?\s*(?:[\w<>\[\],\s]+)\s+\w+\s*\{/.test(line) &&
           !line.includes('class ') &&
           !line.includes('new ') &&
           !line.includes('(');
  }

  private isFieldDeclaration(line: string): boolean {
    return /(?:public|private|protected|internal|static|readonly|volatile|const|fixed|unsafe)?\s*(?:[\w<>\[\],\s]+)\s+\w+\s*(?:=|;)/.test(line) &&
           !line.includes('(') &&
           !line.includes('{') &&
           !line.includes('class ') &&
           !line.includes('struct ') &&
           !line.includes('interface ');
  }

  private isConstructorDeclaration(line: string): boolean {
    return /(?:public|private|protected|internal|static|extern|unsafe)?\s*\w+\s*\([^)]*\)\s*(?::\s*base\s*\(|:\s*this\s*\()?\s*\{/.test(line);
  }

  private isEventDeclaration(line: string): boolean {
    return /(?:public|private|protected|internal|static|virtual|abstract|override|sealed|extern)?\s*event\s+/.test(line);
  }

  private isIndexerDeclaration(line: string): boolean {
    return /(?:public|private|protected|internal|static|virtual|abstract|override|sealed|extern)?\s*(?:[\w<>\[\],\s]+)\s+this\s*\[/.test(line);
  }

  private isOperatorDeclaration(line: string): boolean {
    return /(?:public|static|extern)?\s*(?:[\w<>\[\],\s]+)\s+operator\s+/.test(line);
  }

  private isNestedTypeDeclaration(line: string): boolean {
    return /(?:public|private|protected|internal)?\s*(?:class|struct|interface|enum|record)\s+/.test(line);
  }

  private parseMethod(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    // Match method signature with modifiers
    const match = line.match(/^(.*?)\s*([\w<>\[\],\s]+)\s+(\w+)\s*\(([^)]*)\)(?:\s*where\s+[^;]+)?\s*\{/);
    if (!match) {
      // Check for expression-bodied method
      const exprMatch = line.match(/^(.*?)\s*([\w<>\[\],\s]+)\s+(\w+)\s*\(([^)]*)\)\s*=>\s*(.+);/);
      if (exprMatch) {
        return this.parseExpressionBodiedMethod(lines, startIdx, filePath, exprMatch);
      }
      return null;
    }

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const returnType = match[2].trim();
    const name = match[3];
    const parameters = match[4];

    // Find method body end
    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const node: ASTNode = {
      type: 'MethodDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        name,
        returnType,
        parameters: parameters ? parameters.split(',').map(p => p.trim()) : [],
        modifiers,
        isPublic: modifiers.includes('public'),
        isPrivate: modifiers.includes('private'),
        isProtected: modifiers.includes('protected'),
        isInternal: modifiers.includes('internal'),
        isStatic: modifiers.includes('static'),
        isVirtual: modifiers.includes('virtual'),
        isAbstract: modifiers.includes('abstract'),
        isOverride: modifiers.includes('override'),
        isSealed: modifiers.includes('sealed'),
        isExtern: modifiers.includes('extern'),
        isAsync: modifiers.includes('async'),
        isPartial: modifiers.includes('partial'),
        isUnsafe: modifiers.includes('unsafe'),
        isExpressionBodied: false,
        hasBody: true,
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseExpressionBodiedMethod(lines: string[], startIdx: number, filePath: string, match: RegExpMatchArray): { node: ASTNode; endIndex: number } | null {
    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const returnType = match[2].trim();
    const name = match[3];
    const parameters = match[4];

    const node: ASTNode = {
      type: 'MethodDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, lines[startIdx].length),
      children: [],
      metadata: {
        name,
        returnType,
        parameters: parameters ? parameters.split(',').map(p => p.trim()) : [],
        modifiers,
        isPublic: modifiers.includes('public'),
        isStatic: modifiers.includes('static'),
        isVirtual: modifiers.includes('virtual'),
        isOverride: modifiers.includes('override'),
        isAsync: modifiers.includes('async'),
        isExpressionBodied: true,
        hasBody: true,
      },
    };

    return { node, endIndex: startIdx };
  }

  private parseProperty(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    // Auto-property or full property
    const match = line.match(/^(.*?)\s*([\w<>\[\],\s]+)\s+(\w+)\s*\{/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const type = match[2].trim();
    const name = match[3];

    // Find property end
    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      const currentLine = lines[i];
      for (const char of currentLine) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
      // Expression-bodied property
      if (currentLine.includes('=>') && !foundOpenBrace) {
        if (currentLine.includes(';')) {
          endIdx = i;
          break;
        }
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');

    const node: ASTNode = {
      type: 'PropertyDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        name,
        type,
        modifiers,
        hasGetter: body.includes('get'),
        hasSetter: body.includes('set'),
        isAutoProperty: body.includes('get;') && body.includes('set;') && !body.includes('{ get {'),
        isInitOnly: body.includes('init;'),
        isExpressionBodied: body.includes('=>'),
        isRequired: modifiers.includes('required'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseField(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    const match = line.match(/^(.*?)\s*([\w<>\[\],\s]+)\s+(\w+)\s*(?:=\s*([^;]+))?;/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const type = match[2].trim();
    const name = match[3];
    const initializer = match[4];

    const node: ASTNode = {
      type: 'FieldDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, line.length),
      children: [],
      metadata: {
        name,
        type,
        modifiers,
        isPublic: modifiers.includes('public'),
        isPrivate: modifiers.includes('private'),
        isProtected: modifiers.includes('protected'),
        isInternal: modifiers.includes('internal'),
        isStatic: modifiers.includes('static'),
        isReadonly: modifiers.includes('readonly'),
        isVolatile: modifiers.includes('volatile'),
        isConst: modifiers.includes('const'),
        isFixed: modifiers.includes('fixed'),
        initializer: initializer?.trim(),
      },
    };

    return { node, endIndex: startIdx };
  }

  private parseConstructor(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    const match = line.match(/^(.*?)\s*(\w+)\s*\(([^)]*)\)(?:\s*:\s*(base|this)\s*\(([^)]*)\))?\s*\{/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const name = match[2];
    const parameters = match[3];
    const initializerType = match[4]; // base or this
    const initializerArgs = match[5];

    // Find constructor body end
    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const node: ASTNode = {
      type: 'ConstructorDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        name,
        parameters: parameters ? parameters.split(',').map(p => p.trim()) : [],
        modifiers,
        isPublic: modifiers.includes('public'),
        isPrivate: modifiers.includes('private'),
        isProtected: modifiers.includes('protected'),
        isInternal: modifiers.includes('internal'),
        isStatic: modifiers.includes('static'), // Static constructor
        initializerType,
        initializerArgs,
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseDestructor(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    const match = line.match(/^(.*?)\s*~(\w+)\s*\(\s*\)\s*\{/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const name = match[2];

    // Find destructor body end
    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const node: ASTNode = {
      type: 'DestructorDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        name,
        modifiers,
        isExtern: modifiers.includes('extern'),
        isUnsafe: modifiers.includes('unsafe'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseEvent(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    // Event field or property
    const fieldMatch = line.match(/^(.*?)\s*event\s+([\w<>]+)\s+(\w+)\s*(?:=\s*([^;]+))?;/);
    if (fieldMatch) {
      const modifiers = fieldMatch[1].trim().split(/\s+/).filter(m => m);
      const type = fieldMatch[2].trim();
      const name = fieldMatch[3];

      const node: ASTNode = {
        type: 'EventDeclaration',
        id: `${filePath}:${startIdx + 1}:0`,
        location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, line.length),
        children: [],
        metadata: {
          name,
          type,
          modifiers,
          isField: true,
          isPublic: modifiers.includes('public'),
          isStatic: modifiers.includes('static'),
          isVirtual: modifiers.includes('virtual'),
          isAbstract: modifiers.includes('abstract'),
          isOverride: modifiers.includes('override'),
          isSealed: modifiers.includes('sealed'),
        },
      };

      return { node, endIndex: startIdx };
    }

    // Event property (with add/remove)
    const propMatch = line.match(/^(.*?)\s*event\s+([\w<>]+)\s+(\w+)\s*\{/);
    if (propMatch) {
      const modifiers = propMatch[1].trim().split(/\s+/).filter(m => m);
      const type = propMatch[2].trim();
      const name = propMatch[3];

      // Find property end
      let endIdx = startIdx;
      let braceCount = 0;
      let foundOpenBrace = false;

      for (let i = startIdx; i < lines.length; i++) {
        for (const char of lines[i]) {
          if (char === '{') {
            braceCount++;
            foundOpenBrace = true;
          }
          if (char === '}') braceCount--;
        }
        if (foundOpenBrace && braceCount === 0) {
          endIdx = i;
          break;
        }
      }

      const body = lines.slice(startIdx, endIdx + 1).join('\n');

      const node: ASTNode = {
        type: 'EventDeclaration',
        id: `${filePath}:${startIdx + 1}:0`,
        location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
        children: [],
        metadata: {
          name,
          type,
          modifiers,
          isField: false,
          hasAdd: body.includes('add'),
          hasRemove: body.includes('remove'),
        },
      };

      return { node, endIndex: endIdx };
    }

    return null;
  }

  private parseIndexer(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    const match = line.match(/^(.*?)\s*([\w<>\[\],\s]+)\s+this\s*\[([^\]]+)\]\s*\{/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const type = match[2].trim();
    const parameters = match[3];

    // Find indexer body end
    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const body = lines.slice(startIdx, endIdx + 1).join('\n');

    const node: ASTNode = {
      type: 'IndexerDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        type,
        parameters: parameters.split(',').map(p => p.trim()),
        modifiers,
        hasGetter: body.includes('get'),
        hasSetter: body.includes('set'),
        isPublic: modifiers.includes('public'),
        isVirtual: modifiers.includes('virtual'),
        isAbstract: modifiers.includes('abstract'),
        isOverride: modifiers.includes('override'),
        isSealed: modifiers.includes('sealed'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseOperator(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    const match = line.match(/^(.*?)\s*([\w<>\[\],\s]+)\s+operator\s+(\S+)\s*\(([^)]*)\)\s*\{/);
    if (!match) return null;

    const modifiers = match[1].trim().split(/\s+/).filter(m => m);
    const returnType = match[2].trim();
    const operator = match[3];
    const parameters = match[4];

    // Find operator body end
    let endIdx = startIdx;
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        }
        if (char === '}') braceCount--;
      }
      if (foundOpenBrace && braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const node: ASTNode = {
      type: 'OperatorDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        operator,
        returnType,
        parameters: parameters ? parameters.split(',').map(p => p.trim()) : [],
        modifiers,
        isImplicit: operator === 'implicit',
        isExplicit: operator === 'explicit',
        isConversion: operator === 'implicit' || operator === 'explicit',
        isPublic: modifiers.includes('public'),
        isStatic: modifiers.includes('static'),
        isExtern: modifiers.includes('extern'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseNestedType(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();

    if (line.includes('class ')) {
      return this.parseClass(lines, startIdx, filePath);
    } else if (line.includes('struct ')) {
      return this.parseStruct(lines, startIdx, filePath);
    } else if (line.includes('interface ')) {
      return this.parseInterface(lines, startIdx, filePath);
    } else if (line.includes('enum ')) {
      return this.parseEnum(lines, startIdx, filePath);
    } else if (line.includes('record ')) {
      return this.parseRecord(lines, startIdx, filePath);
    }

    return null;
  }

  private parseTopLevelStatements(source: string, filePath: string): ASTNode[] {
    const statements: ASTNode[] = [];
    // C# 9.0+ allows top-level statements (no Main method required)
    // Check if there are any top-level statements before namespace/class declarations
    const lines = source.split('\n');
    let foundTypeDeclaration = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip comments and usings
      if (!line || line.startsWith('//') || line.startsWith('using ') || line.startsWith('#')) continue;

      // Check for type declaration
      if (/^(?:public|internal|private|protected|class|struct|interface|enum|record)\s+/.test(line)) {
        foundTypeDeclaration = true;
        break;
      }

      // This is likely a top-level statement
      if (!foundTypeDeclaration && line && !line.startsWith('{') && !line.startsWith('}')) {
        statements.push({
          type: 'TopLevelStatement',
          id: `${filePath}:${i + 1}:0`,
          location: this.createLocation(filePath, i + 1, 0, i + 1, line.length),
          children: [],
          metadata: {
            statement: line,
          },
        });
      }
    }

    return statements;
  }

  private parseInheritance(inheritance?: string): { type: string; name: string; isInterface: boolean }[] {
    if (!inheritance) return [];
    
    const result: { type: string; name: string; isInterface: boolean }[] = [];
    const parts = inheritance.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        // In C#, first type is base class (if class), rest are interfaces
        // Or all are interfaces (if struct/interface)
        result.push({
          type: trimmed,
          name: trimmed,
          isInterface: trimmed.startsWith('I') && /^I[A-Z]/.test(trimmed),
        });
      }
    }

    return result;
  }

  private extractEnumValues(body: string): { name: string; value?: number; flags?: boolean }[] {
    const values: { name: string; value?: number; flags?: boolean }[] = [];
    const valueRegex = /(\w+)\s*(?:=\s*([^,\n]+))?/g;
    let match;

    while ((match = valueRegex.exec(body)) !== null) {
      const name = match[1];
      if (name && !['enum', 'class', 'struct', 'public', 'private', 'protected', 'internal'].includes(name)) {
        const valueStr = match[2]?.trim();
        const value = valueStr ? parseInt(valueStr) : undefined;
        
        values.push({
          name,
          value: isNaN(value as number) ? undefined : value,
          flags: valueStr?.includes('<<') || valueStr?.includes('|'),
        });
      }
    }

    return values;
  }

  private extractClassName(body: string): string {
    const match = body.match(/class\s+(\w+)/);
    return match ? match[1] : '';
  }

  private findSyntaxErrors(): any[] {
    const errors: any[] = [];
    let braceCount = 0;
    let parenCount = 0;
    let angleBracketCount = 0;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      let inString = false;
      let stringChar = '';

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const prevChar = j > 0 ? line[j - 1] : '';

        // Handle strings
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (stringChar === char) {
            inString = false;
          }
          continue;
        }

        if (inString) continue;

        // Handle comments
        if (char === '/' && line[j + 1] === '/') break; // Single line comment
        if (char === '/' && line[j + 1] === '*') {
          // Multi-line comment start - skip until end
          j++;
          continue;
        }

        // Count braces, parens, angle brackets
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (char === '<' && /[\w\s]/.test(line[j + 1] || '')) angleBracketCount++;
        if (char === '>' && /[\w\s,.)\]]/.test(line[j + 1] || '')) angleBracketCount--;
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
    if (parenCount > 0) {
      errors.push({ message: `Unclosed parentheses: ${parenCount}`, line: this.lines.length, severity: 'error' });
    }

    return errors;
  }

  private findPreprocessorIssues(): any[] {
    const warnings: any[] = [];
    
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i].trim();
      
      // Check for missing #nullable directive in modern C#
      if (i === 0 && !line.includes('#nullable')) {
        warnings.push({
          message: 'Consider adding #nullable enable for null safety',
          line: 1,
          severity: 'info',
        });
      }

      // Check for region directives without endregion
      if (line.startsWith('#region') && !this.source.includes('#endregion')) {
        warnings.push({
          message: '#region directive without matching #endregion',
          line: i + 1,
          severity: 'warning',
        });
      }
    }

    return warnings;
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

    // Block comments (simplified)
    const blockRegex = /\/\*[\s\S]*?\*\//g;
    let match;
    let sourceIndex = 0;
    while ((match = blockRegex.exec(this.source)) !== null) {
      const lineNum = this.source.substring(0, match.index).split('\n').length;
      comments.push({
        type: 'Block',
        value: match[0].substring(2, match[0].length - 2).trim(),
        line: lineNum,
      });
    }

    // XML documentation comments
    const xmlDocRegex = /\/\/\/\s*(.+)/g;
    while ((match = xmlDocRegex.exec(this.source)) !== null) {
      const lineNum = this.source.substring(0, match.index).split('\n').length;
      comments.push({
        type: 'Documentation',
        value: match[1].trim(),
        line: lineNum,
      });
    }

    return comments;
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

  private fallbackParse(filePath: string): ParseResult {
    return {
      ast: this.parseCSharp(this.source, filePath),
      errors: this.findSyntaxErrors(),
      warnings: this.findPreprocessorIssues(),
      tokens: [],
      comments: this.extractComments(),
    };
  }
}

export class CSharpAnalyzer {
  analyze(ast: ASTNode, context: any): AnalysisResult {
    const symbolTable = this.buildSymbolTable(ast);
    const asyncAnalysis = this.analyzeAsyncPatterns(ast);
    const linqAnalysis = this.analyzeLinqUsage(ast);
    const nullableAnalysis = this.analyzeNullableReferenceTypes(ast);
    const securityIssues = this.findSecurityIssues(ast);
    const dotnetAnalysis = this.analyzeDotNetPatterns(ast);

    return {
      symbols: symbolTable,
      callGraph: this.buildCallGraph(ast),
      dataFlow: { definitions: new Map(), uses: new Map(), taintedSources: [], sinks: [] },
      controlFlow: { nodes: [], edges: [], loops: [], branches: [] },
      typeInference: new Map(),
      metrics: this.calculateMetrics(ast),
      suggestions: [
        ...asyncAnalysis.suggestions,
        ...linqAnalysis.suggestions,
        ...nullableAnalysis.suggestions,
        ...dotnetAnalysis.suggestions,
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

  private analyzeAsyncPatterns(ast: ASTNode): { suggestions: any[] } {
    const suggestions: any[] = [];
    let asyncMethodCount = 0;
    let syncOverAsyncCount = 0;
    let missingAwaitCount = 0;

    const traverse = (node: ASTNode) => {
      // Count async methods
      if (node.type === 'MethodDeclaration' && node.metadata.isAsync) {
        asyncMethodCount++;
      }

      // Check for sync-over-async (Task.Result, Task.Wait(), .GetAwaiter().GetResult())
      if (node.type === 'MethodInvocation') {
        const method = node.metadata.method || '';
        if (method.includes('.Result') || method.includes('.Wait()') || method.includes('.GetAwaiter().GetResult()')) {
          syncOverAsyncCount++;
          suggestions.push({
            type: 'performance',
            severity: 'warning',
            message: 'Sync-over-async detected - can cause deadlocks',
            remediation: 'Use await instead of .Result or .Wait()',
          });
        }
      }

      // Check for missing await on async methods
      if (node.type === 'MethodInvocation') {
        const method = node.metadata.method || '';
        const isAsyncCall = method.includes('Async');
        if (isAsyncCall && !node.metadata.isAwaited) {
          missingAwaitCount++;
        }
      }

      node.children.forEach(traverse);
    };

    traverse(ast);

    if (asyncMethodCount > 0 && syncOverAsyncCount > 0) {
      suggestions.push({
        type: 'performance',
        severity: 'warning',
        message: `Found ${syncOverAsyncCount} sync-over-async calls in async codebase`,
        remediation: 'Consider using async/await throughout the call stack',
      });
    }

    return { suggestions };
  }

  private analyzeLinqUsage(ast: ASTNode): { suggestions: any[] } {
    const suggestions: any[] = [];
    let deferredExecutionCount = 0;
    let immediateExecutionCount = 0;
    let multipleEnumerationCount = 0;

    const traverse = (node: ASTNode) => {
      // Check for LINQ method calls
      if (node.type === 'MethodInvocation') {
        const method = node.metadata.method || '';
        
        // Deferred execution methods (ToList, ToArray, First, Single, etc. trigger execution)
        const immediateMethods = ['ToList', 'ToArray', 'First', 'FirstOrDefault', 'Single', 'SingleOrDefault', 'Last', 'LastOrDefault', 'Count', 'Any', 'All'];
        const deferredMethods = ['Where', 'Select', 'OrderBy', 'ThenBy', 'GroupBy', 'Join', 'Skip', 'Take', 'Distinct'];

        if (immediateMethods.some(m => method.includes(m))) {
          immediateExecutionCount++;
        }
        if (deferredMethods.some(m => method.includes(m))) {
          deferredExecutionCount++;
        }

        // Multiple enumeration pattern
        if (method.includes('Count()') || method.includes('Any()')) {
          // Check if same enumerable is used again later
          const parent = node.parent;
          if (parent && parent.children) {
            const sameVarUsages = parent.children.filter(c => 
              c.metadata?.variable === node.metadata.variable
            );
            if (sameVarUsages.length > 1) {
              multipleEnumerationCount++;
            }
          }
        }
      }

      node.children.forEach(traverse);
    };

    traverse(ast);

    if (deferredExecutionCount > 0 && immediateExecutionCount === 0) {
      suggestions.push({
        type: 'performance',
        severity: 'info',
        message: 'LINQ query without terminal operator - deferred execution may cause multiple evaluations',
        remediation: 'Add .ToList() or .ToArray() if the result is enumerated multiple times',
      });
    }

    return { suggestions };
  }

  private analyzeNullableReferenceTypes(ast: ASTNode): { suggestions: any[] } {
    const suggestions: any[] = [];
    let nullableEnabled = false;
    let nullForgivingCount = 0;
    let potentialNullDereferenceCount = 0;

    const traverse = (node: ASTNode) => {
      // Check for #nullable directive
      if (node.type === 'PreprocessorDirective' && node.metadata.directive === 'nullable') {
        nullableEnabled = node.metadata.value?.includes('enable');
      }

      // Check for null-forgiving operator (!)
      if (node.type === 'MemberAccess' && node.metadata.hasNullForgiving) {
        nullForgivingCount++;
      }

      // Check for potential null dereference
      if (node.type === 'MemberAccess') {
        const variable = node.metadata.variable || '';
        const isNullable = node.metadata.isNullable;
        const hasNullCheck = node.metadata.hasNullCheck;

        if (isNullable && !hasNullCheck && !node.metadata.hasNullForgiving) {
          potentialNullDereferenceCount++;
        }
      }

      node.children.forEach(traverse);
    };

    traverse(ast);

    if (!nullableEnabled) {
      suggestions.push({
        type: 'modernization',
        severity: 'info',
        message: 'Nullable reference types not enabled',
        remediation: 'Add #nullable enable to enable null safety analysis',
      });
    }

    if (nullForgivingCount > 5) {
      suggestions.push({
        type: 'code-quality',
        severity: 'warning',
        message: `Excessive use of null-forgiving operator (!) - ${nullForgivingCount} instances`,
        remediation: 'Review null safety assumptions and add proper null checks',
      });
    }

    return { suggestions };
  }

  private analyzeDotNetPatterns(ast: ASTNode): { suggestions: any[] } {
    const suggestions: any[] = [];
    let disposableNotDisposed = 0;
    let stringConcatInLoop = 0;
    let boxingCount = 0;

    const traverse = (node: ASTNode) => {
      // IDisposable not disposed
      if (node.type === 'VariableDeclaration' && node.metadata.type) {
        const type = node.metadata.type;
        const disposableTypes = ['Stream', 'HttpClient', 'SqlConnection', 'DbContext', 'FileStream', 'MemoryStream'];
        
        if (disposableTypes.some(t => type.includes(t))) {
          const hasUsing = node.metadata.hasUsingDeclaration || node.metadata.isInUsingBlock;
          if (!hasUsing) {
            disposableNotDisposed++;
            suggestions.push({
              type: 'resource-leak',
              severity: 'warning',
              message: `IDisposable type '${type}' may not be disposed properly`,
              remediation: 'Use using declaration or try-finally with Dispose()',
            });
          }
        }
      }

      // String concatenation in loop
      if (node.type === 'ForStatement' || node.type === 'WhileStatement' || node.type === 'ForEachStatement') {
        const body = node.children.find(c => c.type === 'Block');
        if (body) {
          const hasStringConcat = body.children.some(c => 
            c.type === 'BinaryExpression' && 
            (c.metadata.operator === '+' || c.metadata.operator === '+=') &&
            (c.metadata.leftType === 'string' || c.metadata.rightType === 'string')
          );
          if (hasStringConcat) {
            stringConcatInLoop++;
            suggestions.push({
              type: 'performance',
              severity: 'warning',
              message: 'String concatenation in loop detected',
              remediation: 'Use StringBuilder for efficient string concatenation in loops',
            });
          }
        }
      }

      // Boxing/unboxing
      if (node.type === 'CastExpression') {
        const fromType = node.metadata.fromType;
        const toType = node.metadata.toType;
        
        if ((fromType === 'int' || fromType === 'double' || fromType === 'bool') && toType === 'object') {
          boxingCount++;
        }
      }

      node.children.forEach(traverse);
    };

    traverse(ast);

    if (boxingCount > 5) {
      suggestions.push({
        type: 'performance',
        severity: 'info',
        message: `Potential boxing operations detected: ${boxingCount}`,
        remediation: 'Use generics to avoid boxing, or ensure type safety at compile time',
      });
    }

    return { suggestions };
  }

  private findSecurityIssues(ast: ASTNode): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    const traverse = (node: ASTNode) => {
      // SQL Injection
      if (node.type === 'MethodInvocation') {
        const method = node.metadata.method || '';
        
        if (method.includes('ExecuteSqlCommand') || method.includes('FromSqlRaw') || method.includes('FromSqlInterpolated')) {
          const hasInterpolation = node.metadata.hasStringInterpolation;
          const isRaw = method.includes('Raw') || !method.includes('Interpolated');
          
          if (isRaw && hasInterpolation) {
            issues.push({
              id: 'CS001',
              severity: 'critical',
              category: 'sql-injection',
              location: node.location,
              description: 'Potential SQL injection via string interpolation',
              remediation: 'Use parameterized queries or FromSqlInterpolated instead',
              falsePositiveLikelihood: 0.2,
            });
          }
        }

        // Path traversal
        if (method.includes('File.ReadAllText') || method.includes('File.Open') || method.includes('FileStream')) {
          const hasUserInput = node.metadata.hasUserInput;
          if (hasUserInput && !node.metadata.hasPathValidation) {
            issues.push({
              id: 'CS002',
              severity: 'high',
              category: 'path-traversal',
              location: node.location,
              description: 'Potential path traversal vulnerability',
              remediation: 'Validate file paths using Path.GetFullPath and check for directory traversal',
              falsePositiveLikelihood: 0.3,
            });
          }
        }

        // Deserialization
        if (method.includes('JsonSerializer.Deserialize') || method.includes('BinaryFormatter.Deserialize')) {
          if (method.includes('BinaryFormatter')) {
            issues.push({
              id: 'CS003',
              severity: 'critical',
              category: 'deserialization',
              location: node.location,
              description: 'BinaryFormatter is obsolete and insecure',
              remediation: 'Use JsonSerializer with TypeInfoHandling.None or DataContractSerializer',
              falsePositiveLikelihood: 0.1,
            });
          }
          
          const hasTypeNameHandling = node.metadata.hasTypeNameHandling;
          if (hasTypeNameHandling) {
            issues.push({
              id: 'CS004',
              severity: 'critical',
              category: 'deserialization',
              location: node.location,
              description: 'TypeNameHandling can lead to remote code execution',
              remediation: 'Disable TypeNameHandling or use a custom SerializationBinder',
              falsePositiveLikelihood: 0.1,
            });
          }
        }

        // Insecure random
        if (method.includes('Random.') || method.includes('new Random()')) {
          if (node.metadata.isSecuritySensitive) {
            issues.push({
              id: 'CS005',
              severity: 'medium',
              category: 'weak-cryptography',
              location: node.location,
              description: 'System.Random is not cryptographically secure',
              remediation: 'Use RandomNumberGenerator for security-sensitive operations',
              falsePositiveLikelihood: 0.5,
            });
          }
        }

        // Debug.Assert in production
        if (method.includes('Debug.Assert')) {
          issues.push({
            id: 'CS006',
            severity: 'low',
            category: 'debug-code',
            location: node.location,
            description: 'Debug.Assert is removed in release builds',
            remediation: 'Use proper validation with exceptions for production code',
            falsePositiveLikelihood: 0.7,
          });
        }
      }

      // Weak hashing
      if (node.type === 'MethodInvocation') {
        const method = node.metadata.method || '';
        if (method.includes('MD5') || method.includes('SHA1')) {
          issues.push({
            id: 'CS007',
            severity: 'high',
            category: 'weak-cryptography',
            location: node.location,
            description: 'Weak hashing algorithm detected',
            remediation: 'Use SHA256 or SHA512 for hashing',
            falsePositiveLikelihood: 0.3,
          });
        }
      }

      // Hardcoded secrets
      if (node.type === 'VariableDeclaration' && node.metadata.initializer) {
        const init = node.metadata.initializer;
        const name = node.metadata.name || '';
        
        if (/password|secret|key|token|connectionstring/i.test(name)) {
          if (init.includes('"') && init.length > 10) {
            issues.push({
              id: 'CS008',
              severity: 'critical',
              category: 'secrets',
              location: node.location,
              description: 'Potential hardcoded secret detected',
              remediation: 'Use configuration files or secret management (Azure Key Vault, AWS Secrets Manager)',
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

export const CSharpLanguageSupport = {
  id: 'csharp',
  name: 'C#',
  extensions: ['.cs', '.csx', '.cake'],
  parser: new CSharpParser(),
  analyzer: new CSharpAnalyzer(),
};
