/**
 * C++ Language Support for LinguClaw
 * Advanced C++ parser with template and memory management analysis
 */

import type {
  ASTNode, ParseResult, AnalysisResult, SymbolTable,
  FunctionInfo, ClassInfo, SecurityIssue
} from '../core/engine';

export class CppParser {
  private source: string = '';
  private lines: string[] = [];

  parse(source: string, filePath: string): ParseResult {
    this.source = source;
    this.lines = source.split('\n');

    try {
      const ast = this.parseCpp(source, filePath);
      
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

  private parseCpp(source: string, filePath: string): ASTNode {
    const root: ASTNode = {
      type: 'TranslationUnit',
      id: `${filePath}:0:0`,
      location: this.createLocation(filePath, 0, 0, this.lines.length, 0),
      children: [],
      metadata: { language: 'cpp' },
    };

    // Parse preprocessor directives
    const preprocessor = this.parsePreprocessor(source, filePath);
    root.children.push(...preprocessor);

    // Parse declarations
    const declarations = this.parseDeclarations(source, filePath);
    root.children.push(...declarations);

    return root;
  }

  private parsePreprocessor(source: string, filePath: string): ASTNode[] {
    const directives: ASTNode[] = [];
    const directiveRegex = /^#(\w+)(?:\s+(.+))?$/gm;
    let match;

    while ((match = directiveRegex.exec(source)) !== null) {
      const directive = match[1];
      const value = match[2]?.trim();
      const lineNum = source.substring(0, match.index).split('\n').length;

      const node: ASTNode = {
        type: 'PreprocessorDirective',
        id: `${filePath}:${lineNum}:0`,
        location: this.createLocation(filePath, lineNum, 0, lineNum, match[0].length),
        children: [],
        metadata: {
          directive,
          value,
          isInclude: directive === 'include',
          isDefine: directive === 'define',
          isIfdef: directive === 'ifdef' || directive === 'ifndef',
          isPragma: directive === 'pragma',
          includePath: directive === 'include' ? this.extractIncludePath(value || '') : undefined,
        },
      };

      directives.push(node);
    }

    return directives;
  }

  private extractIncludePath(value: string): string {
    const match = value.match(/[<"](.+)[>"]/);
    return match ? match[1] : value;
  }

  private parseDeclarations(source: string, filePath: string): ASTNode[] {
    const declarations: ASTNode[] = [];
    const lines = source.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('//') || line.startsWith('#')) {
        i++;
        continue;
      }

      // Namespace
      if (line.startsWith('namespace ')) {
        const nsDecl = this.parseNamespace(lines, i, filePath);
        if (nsDecl) {
          declarations.push(nsDecl.node);
          i = nsDecl.endIndex + 1;
          continue;
        }
      }

      // Class/Struct/Union
      if (this.isClassDeclaration(line)) {
        const classDecl = this.parseClass(lines, i, filePath);
        if (classDecl) {
          declarations.push(classDecl.node);
          i = classDecl.endIndex + 1;
          continue;
        }
      }

      // Function
      if (this.isFunctionDeclaration(line)) {
        const funcDecl = this.parseFunction(lines, i, filePath);
        if (funcDecl) {
          declarations.push(funcDecl.node);
          i = funcDecl.endIndex + 1;
          continue;
        }
      }

      // Variable declaration
      if (this.isVariableDeclaration(line)) {
        const varDecl = this.parseVariableDeclaration(lines, i, filePath);
        if (varDecl) {
          declarations.push(varDecl.node);
          i = varDecl.endIndex + 1;
          continue;
        }
      }

      // Template
      if (line.startsWith('template<')) {
        const templateDecl = this.parseTemplate(lines, i, filePath);
        if (templateDecl) {
          declarations.push(templateDecl.node);
          i = templateDecl.endIndex + 1;
          continue;
        }
      }

      // Enum
      if (line.startsWith('enum ')) {
        const enumDecl = this.parseEnum(lines, i, filePath);
        if (enumDecl) {
          declarations.push(enumDecl.node);
          i = enumDecl.endIndex + 1;
          continue;
        }
      }

      // Using/Type alias
      if (line.startsWith('using ') || line.startsWith('typedef ')) {
        const aliasDecl = this.parseTypeAlias(lines, i, filePath);
        if (aliasDecl) {
          declarations.push(aliasDecl.node);
          i = aliasDecl.endIndex + 1;
          continue;
        }
      }

      // Extern
      if (line.startsWith('extern ')) {
        const externDecl = this.parseExtern(lines, i, filePath);
        if (externDecl) {
          declarations.push(externDecl.node);
          i = externDecl.endIndex + 1;
          continue;
        }
      }

      i++;
    }

    return declarations;
  }

  private isClassDeclaration(line: string): boolean {
    return /^(?:class|struct|union)(?:\s+\w+|$)/.test(line) ||
           /^(?:template\s*<[^>]+>\s+)?(?:class|struct)/.test(line);
  }

  private isFunctionDeclaration(line: string): boolean {
    // Matches function signatures but not variable declarations with initializers
    return /(?:^|::)(\w+)\s*\([^)]*\)\s*(?:const|volatile|&|&&|\{|->|noexcept)?\s*$/.test(line) ||
           /^(?:inline|virtual|static|explicit|constexpr|consteval)\s+/.test(line);
  }

  private isVariableDeclaration(line: string): boolean {
    return /^(?:const|constexpr|static|extern|volatile|mutable|thread_local)?\s*[\w:<>,\s*&*]+\s+\w+\s*(?:=|;)/.test(line) ||
           /^[\w:<>,\s*&*]+\s+\w+\s*\{[^}]*\}/.test(line);
  }

  private parseNamespace(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/namespace\s+(\w+)?/);
    if (!match) return null;

    const name = match[1] || 'anonymous';
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

    const body = lines.slice(startIdx + 1, endIdx);
    const nested = this.parseDeclarations(body.join('\n'), filePath);

    const node: ASTNode = {
      type: 'NamespaceDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: nested,
      metadata: {
        name,
        isAnonymous: !match[1],
        isInline: line.includes('inline'),
        isNested: false,
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseClass(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    // Handle template prefix
    let templatePrefix = '';
    let actualLine = line;
    
    if (line.startsWith('template')) {
      // Find the actual class line
      for (let i = startIdx + 1; i < lines.length; i++) {
        if (lines[i].includes('class') || lines[i].includes('struct')) {
          actualLine = lines[i].trim();
          break;
        }
      }
    }

    const match = actualLine.match(/(class|struct|union)\s+(?:\w+\s+)?(\w+)(?:<([^>]+)>)?(?:\s*:\s*([^{]+))?/);
    if (!match) return null;

    const kind = match[1];
    const name = match[2];
    const templateParams = match[3];
    const inheritance = match[4];

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
    const members = this.parseClassMembers(body, filePath);

    const node: ASTNode = {
      type: kind === 'class' ? 'ClassDeclaration' : kind === 'struct' ? 'StructDeclaration' : 'UnionDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: members,
      metadata: {
        name,
        templateParameters: templateParams ? templateParams.split(',').map(p => p.trim()) : [],
        isTemplate: !!templateParams,
        isStruct: kind === 'struct',
        isUnion: kind === 'union',
        inheritance: this.parseInheritance(inheritance),
        accessSpecifiers: this.extractAccessSpecifiers(body),
        hasVirtualDestructor: body.includes('~' + name) && body.includes('virtual'),
        isAbstract: body.includes('= 0') || body.includes('=0'),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseClassMembers(body: string, filePath: string): ASTNode[] {
    const members: ASTNode[] = [];
    const lines = body.split('\n');

    // Simple member extraction - this could be more sophisticated
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Access specifiers
      if (line.match(/^(public|private|protected):/)) {
        members.push({
          type: 'AccessSpecifier',
          id: `${filePath}:${i + 1}:0`,
          location: this.createLocation(filePath, i + 1, 0, i + 1, line.length),
          children: [],
          metadata: { access: line.replace(':', '') },
        });
        continue;
      }

      // Member variables
      const varMatch = line.match(/([\w:<>,\s&*]+)\s+(\w+)\s*(?:=\s*([^;]+))?;/);
      if (varMatch && !line.includes('(')) {
        members.push({
          type: 'FieldDeclaration',
          id: `${filePath}:${i + 1}:0`,
          location: this.createLocation(filePath, i + 1, 0, i + 1, line.length),
          children: [],
          metadata: {
            name: varMatch[2],
            type: varMatch[1].trim(),
            initializer: varMatch[3]?.trim(),
          },
        });
      }

      // Member functions
      const funcMatch = line.match(/(?:virtual\s+)?(?:static\s+)?(?:const\s+)?([\w:<>,\s&*]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:const|override|final|noexcept)?\s*(?:=\s*0)?/);
      if (funcMatch && line.includes('(')) {
        members.push({
          type: 'MethodDeclaration',
          id: `${filePath}:${i + 1}:0`,
          location: this.createLocation(filePath, i + 1, 0, i + 1, line.length),
          children: [],
          metadata: {
            name: funcMatch[2],
            returnType: funcMatch[1].trim(),
            parameters: funcMatch[3],
            isVirtual: line.includes('virtual'),
            isPureVirtual: line.includes('= 0') || line.includes('=0'),
            isOverride: line.includes('override'),
            isFinal: line.includes('final'),
            isConst: line.includes('const'),
          },
        });
      }

      // Constructors
      const ctorMatch = line.match(/(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/);
      if (ctorMatch && !line.match(/^[\w:]+\s+\w+\s*\(/)) {
        // Heuristic: if name matches class and not a return type pattern
        members.push({
          type: 'ConstructorDeclaration',
          id: `${filePath}:${i + 1}:0`,
          location: this.createLocation(filePath, i + 1, 0, i + 1, line.length),
          children: [],
          metadata: {
            parameters: ctorMatch[2],
            initializerList: ctorMatch[3],
            isExplicit: line.includes('explicit'),
            isDefault: line.includes('= default'),
            isDeleted: line.includes('= delete'),
          },
        });
      }
    }

    return members;
  }

  private parseFunction(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    // Handle template functions
    let templateParams: string | undefined;
    let actualStart = startIdx;
    
    if (line.startsWith('template<')) {
      templateParams = line.match(/template<(.+)>/)?.[1];
      actualStart = startIdx + 1;
    }

    const actualLine = lines[actualStart]?.trim() || line;
    
    // Match function signature
    const match = actualLine.match(/(?:template<[^>]+>\s*)?(?:(\w+)::)?(?:~)?(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^{]+))?/);
    if (!match && !actualLine.includes('(')) return null;

    // Find function body
    let endIdx = actualStart;
    let braceCount = 0;
    let hasBody = false;

    for (let i = actualStart; i < lines.length; i++) {
      const currentLine = lines[i];
      
      // Check for function try block
      if (currentLine.includes('try') && i === actualStart) {
        continue;
      }

      for (const char of currentLine) {
        if (char === '{') {
          braceCount++;
          hasBody = true;
        }
        if (char === '}') braceCount--;
      }

      if (hasBody && braceCount === 0) {
        endIdx = i;
        break;
      }

      // Function declaration without body
      if (currentLine.includes(';') && !hasBody && i > actualStart) {
        endIdx = i;
        break;
      }
    }

    const isDestructor = actualLine.includes('~');
    const isOperator = actualLine.match(/operator\s*\W+/);

    const node: ASTNode = {
      type: 'FunctionDeclaration',
      id: `${filePath}:${actualStart + 1}:0`,
      location: this.createLocation(filePath, actualStart + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        name: isDestructor ? 'destructor' : isOperator ? 'operator' : match?.[2] || 'unknown',
        isTemplate: !!templateParams,
        templateParameters: templateParams ? templateParams.split(',').map(p => p.trim()) : [],
        isDestructor,
        isOperator: !!isOperator,
        isConstexpr: actualLine.includes('constexpr'),
        isConsteval: actualLine.includes('consteval'),
        isNoexcept: actualLine.includes('noexcept'),
        isInline: actualLine.includes('inline'),
        isStatic: actualLine.includes('static'),
        isExtern: actualLine.includes('extern'),
        hasBody,
        trailingReturn: match?.[4]?.trim(),
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseVariableDeclaration(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    // Match variable declarations including modern C++ features
    const match = line.match(/^(?:(const|constexpr|static|extern|volatile|mutable|thread_local|inline)\s+)*([\w:<>,\s&*]+?)\s+(\w+)(?:\[(\d+)\])?\s*(?:=\s*([^;{]+|\{[^}]*\}))?(?:;|$)/);
    if (!match) return null;

    const node: ASTNode = {
      type: 'VariableDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, line.length),
      children: [],
      metadata: {
        name: match[3],
        type: match[2].trim(),
        isConst: line.includes('const') && !line.includes('const&') && !line.includes('const*'),
        isConstexpr: line.includes('constexpr'),
        isStatic: line.includes('static'),
        isExtern: line.includes('extern'),
        isMutable: line.includes('mutable'),
        isThreadLocal: line.includes('thread_local'),
        isArray: !!match[4],
        arraySize: match[4] ? parseInt(match[4]) : undefined,
        initializer: match[5]?.trim(),
        isBraceInit: match[5]?.startsWith('{'),
        isAuto: match[2].trim() === 'auto',
      },
    };

    return { node, endIndex: startIdx };
  }

  private parseTemplate(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/template<(.+)>/);
    if (!match) return null;

    // The actual declaration follows the template
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].includes('{') || lines[i].includes(';')) {
        endIdx = i;
        break;
      }
    }

    const node: ASTNode = {
      type: 'TemplateDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        parameters: match[1].split(',').map(p => {
          const param = p.trim();
          const typenameMatch = param.match(/(?:typename|class)\s+(\w+)/);
          const typeMatch = param.match(/(\w+)\s+(\w+)/);
          
          return {
            kind: param.startsWith('typename') ? 'typename' : 
                  param.startsWith('class') ? 'class' : 'type',
            name: typenameMatch?.[1] || typeMatch?.[2] || param,
            defaultValue: param.includes('=') ? param.split('=')[1].trim() : undefined,
          };
        }),
        isVariadic: match[1].includes('...'),
        requiresClause: lines.slice(startIdx, endIdx).join(' ').match(/requires\s+(.+)/)?.[1],
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseEnum(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/enum\s+(?:class\s+)?(\w+)(?:\s*:\s*(\w+))?/);
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
    const values = this.extractEnumValues(body);

    const node: ASTNode = {
      type: 'EnumDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        name: match[1],
        isScoped: line.includes('enum class') || line.includes('enum struct'),
        underlyingType: match[2],
        values,
        hasAssignedValues: body.includes('='),
      },
    };

    return { node, endIndex: endIdx };
  }

  private extractEnumValues(body: string): { name: string; value?: string }[] {
    const values: { name: string; value?: string }[] = [];
    const valueRegex = /(\w+)\s*(?:=\s*([^,]+))?/g;
    let match;

    while ((match = valueRegex.exec(body)) !== null) {
      if (!['enum', 'class', 'struct'].includes(match[1])) {
        values.push({
          name: match[1],
          value: match[2]?.trim(),
        });
      }
    }

    return values;
  }

  private parseTypeAlias(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    
    // Using alias
    const usingMatch = line.match(/using\s+(\w+)\s*=\s*(.+);/);
    if (usingMatch) {
      const node: ASTNode = {
        type: 'TypeAliasDeclaration',
        id: `${filePath}:${startIdx + 1}:0`,
        location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, line.length),
        children: [],
        metadata: {
          name: usingMatch[1],
          target: usingMatch[2],
          isUsing: true,
          isTemplateAlias: line.includes('template'),
        },
      };
      return { node, endIndex: startIdx };
    }

    // Typedef
    const typedefMatch = line.match(/typedef\s+([\w<>,\s&*]+)\s+(\w+);/);
    if (typedefMatch) {
      const node: ASTNode = {
        type: 'TypeAliasDeclaration',
        id: `${filePath}:${startIdx + 1}:0`,
        location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, line.length),
        children: [],
        metadata: {
          name: typedefMatch[2],
          target: typedefMatch[1].trim(),
          isUsing: false,
        },
      };
      return { node, endIndex: startIdx };
    }

    return null;
  }

  private parseExtern(lines: string[], startIdx: number, filePath: string): { node: ASTNode; endIndex: number } | null {
    const line = lines[startIdx].trim();
    const match = line.match(/extern\s+"(\w+)"\s*\{/);
    if (!match) {
      // Single extern declaration
      const singleMatch = line.match(/extern\s+([\w<>,\s&*]+)\s+(\w+)\s*;/);
      if (singleMatch) {
        const node: ASTNode = {
          type: 'ExternDeclaration',
          id: `${filePath}:${startIdx + 1}:0`,
          location: this.createLocation(filePath, startIdx + 1, 0, startIdx + 1, line.length),
          children: [],
          metadata: {
            language: 'C',
            isBlock: false,
          },
        };
        return { node, endIndex: startIdx };
      }
      return null;
    }

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

    const node: ASTNode = {
      type: 'ExternDeclaration',
      id: `${filePath}:${startIdx + 1}:0`,
      location: this.createLocation(filePath, startIdx + 1, 0, endIdx + 1, lines[endIdx]?.length || 0),
      children: [],
      metadata: {
        language: match[1],
        isBlock: true,
      },
    };

    return { node, endIndex: endIdx };
  }

  private parseInheritance(inheritance?: string): { class: string; visibility: string; isVirtual: boolean }[] {
    if (!inheritance) return [];
    
    const result: { class: string; visibility: string; isVirtual: boolean }[] = [];
    const parts = inheritance.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      const virtual = trimmed.includes('virtual');
      const visibility = trimmed.match(/(public|private|protected)/)?.[1] || 'private';
      const className = trimmed.replace(/virtual|public|private|protected/g, '').trim();

      if (className) {
        result.push({ class: className, visibility, isVirtual: virtual });
      }
    }

    return result;
  }

  private extractAccessSpecifiers(body: string): string[] {
    const specifiers: string[] = [];
    const regex = /(public|private|protected):/g;
    let match;

    while ((match = regex.exec(body)) !== null) {
      specifiers.push(match[1]);
    }

    return specifiers;
  }

  private findSyntaxErrors(): any[] {
    const errors: any[] = [];
    let braceCount = 0;
    let parenCount = 0;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      
      // Skip preprocessor lines and comments
      if (line.trim().startsWith('#') || line.trim().startsWith('//')) continue;

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

  private findPreprocessorIssues(): any[] {
    const warnings: any[] = [];
    
    // Check for common issues
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      
      // Missing header guard
      if (i === 0 && !line.includes('#ifndef') && !line.includes('#pragma once')) {
        // Only for .h/.hpp files
        if (line.includes('.h') || line.includes('.hpp')) {
          warnings.push({
            message: 'Missing header guard (consider using #pragma once or #ifndef)',
            line: 1,
            severity: 'warning',
          });
        }
      }

      // Deprecated macros
      if (line.includes('malloc') || line.includes('free') || line.includes('sprintf')) {
        warnings.push({
          message: 'Using C-style memory/string functions, consider C++ alternatives',
          line: i + 1,
          severity: 'info',
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
      ast: this.parseCpp(this.source, filePath),
      errors: this.findSyntaxErrors(),
      warnings: this.findPreprocessorIssues(),
      tokens: [],
      comments: this.extractComments(),
    };
  }
}

export class CppAnalyzer {
  analyze(ast: ASTNode, context: any): AnalysisResult {
    const symbolTable = this.buildSymbolTable(ast);
    const memoryAnalysis = this.analyzeMemoryManagement(ast);
    const templateAnalysis = this.analyzeTemplates(ast);
    const securityIssues = this.findSecurityIssues(ast);

    return {
      symbols: symbolTable,
      callGraph: this.buildCallGraph(ast),
      dataFlow: { definitions: new Map(), uses: new Map(), taintedSources: [], sinks: [] },
      controlFlow: { nodes: [], edges: [], loops: [], branches: [] },
      typeInference: new Map(),
      metrics: this.calculateMetrics(ast),
      suggestions: [
        ...memoryAnalysis.suggestions,
        ...templateAnalysis.suggestions,
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

  private analyzeMemoryManagement(ast: ASTNode): { suggestions: any[] } {
    const suggestions: any[] = [];
    let rawPointerCount = 0;
    let newCount = 0;
    let deleteCount = 0;
    let uniquePtrCount = 0;
    let sharedPtrCount = 0;

    const traverse = (node: ASTNode) => {
      // Check for raw pointers
      if (node.type === 'VariableDeclaration') {
        const type = node.metadata.type || '';
        if (type.includes('*') && !type.includes('const*') && !type.includes('const *')) {
          rawPointerCount++;
        }
      }

      // Check for new/delete
      if (node.type === 'MethodInvocation' || node.type === 'FunctionCall') {
        const method = node.metadata.method || node.metadata.name || '';
        if (method === 'new' || method.includes('::operator new')) newCount++;
        if (method === 'delete' || method === 'delete[]') deleteCount++;
      }

      // Check for smart pointers
      const type = node.metadata.type || '';
      if (type.includes('unique_ptr')) uniquePtrCount++;
      if (type.includes('shared_ptr')) sharedPtrCount++;

      node.children.forEach(traverse);
    };

    traverse(ast);

    // Memory management suggestions
    if (newCount > 0 && deleteCount === 0) {
      suggestions.push({
        type: 'memory',
        severity: 'warning',
        message: `Using 'new' ${newCount} times without corresponding 'delete' - potential memory leak`,
        remediation: 'Use smart pointers (std::unique_ptr, std::shared_ptr) or RAII containers',
      });
    }

    if (rawPointerCount > 0 && uniquePtrCount + sharedPtrCount === 0) {
      suggestions.push({
        type: 'modernization',
        severity: 'info',
        message: `Using ${rawPointerCount} raw pointers - consider smart pointers`,
        remediation: 'Replace raw pointers with std::unique_ptr for ownership, std::shared_ptr for shared ownership',
      });
    }

    return { suggestions };
  }

  private analyzeTemplates(ast: ASTNode): { suggestions: any[] } {
    const suggestions: any[] = [];
    let templateCount = 0;
    let deepNesting = 0;

    const traverse = (node: ASTNode, depth = 0) => {
      if (node.type === 'TemplateDeclaration') {
        templateCount++;
        if (depth > 2) {
          deepNesting++;
        }
      }

      node.children.forEach(child => traverse(child, depth + 1));
    };

    traverse(ast);

    if (deepNesting > 0) {
      suggestions.push({
        type: 'complexity',
        severity: 'warning',
        message: `Deep template nesting detected (${deepNesting} instances)`,
        remediation: 'Consider using type aliases or concepts to simplify template instantiation',
      });
    }

    return { suggestions };
  }

  private findSecurityIssues(ast: ASTNode): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    const traverse = (node: ASTNode) => {
      // Check for unsafe functions
      if (node.type === 'MethodInvocation' || node.type === 'FunctionCall') {
        const method = node.metadata.method || node.metadata.name || '';
        
        // Buffer overflow risks
        const unsafeFunctions = ['strcpy', 'strcat', 'sprintf', 'gets', 'scanf'];
        if (unsafeFunctions.some(f => method.includes(f))) {
          issues.push({
            id: 'CPP001',
            severity: 'critical',
            category: 'memory-safety',
            location: node.location,
            description: `Using unsafe C function: ${method} - buffer overflow risk`,
            remediation: 'Use safe alternatives: strncpy, strncat, snprintf, fgets',
            falsePositiveLikelihood: 0.1,
          });
        }

        // Memory management issues
        if (method === 'malloc' || method === 'calloc' || method === 'realloc') {
          const parent = node.parent;
          if (!parent || parent.type !== 'VariableDeclaration') {
            issues.push({
              id: 'CPP002',
              severity: 'medium',
              category: 'memory-safety',
              location: node.location,
              description: 'C-style memory allocation without immediate assignment',
              remediation: 'Use new/delete or smart pointers',
              falsePositiveLikelihood: 0.3,
            });
          }
        }
      }

      // Check for missing virtual destructor
      if (node.type === 'ClassDeclaration') {
        const hasVirtualMethod = node.children.some(c => 
          c.type === 'MethodDeclaration' && c.metadata.isVirtual
        );
        const hasVirtualDestructor = node.metadata.hasVirtualDestructor;

        if (hasVirtualMethod && !hasVirtualDestructor) {
          issues.push({
            id: 'CPP003',
            severity: 'high',
            category: 'memory-safety',
            location: node.location,
            description: `Class ${node.metadata.name} has virtual methods but non-virtual destructor`,
            remediation: 'Add virtual ~ClassName() = default; or mark class as final',
            falsePositiveLikelihood: 0.2,
          });
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

export const CppLanguageSupport = {
  id: 'cpp',
  name: 'C++',
  extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.h', '.hh', '.hxx'],
  parser: new CppParser(),
  analyzer: new CppAnalyzer(),
};
