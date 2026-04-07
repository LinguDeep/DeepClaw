/**
 * RAG Memory system backed by SemanticMemory (TF-IDF + SQLite)
 * No external dependencies like lancedb required.
 */

import path from 'path';
import fs from 'fs';
import { CodeChunk } from './types';
import { getLogger } from './logger';
import { SemanticMemory } from './semantic-memory';
import { parseTypeScriptFile, parseGenericFile, ParsedChunk } from './code-parser';

const logger = getLogger();

export class RAGMemory {
  projectRoot: string;
  available: boolean;
  private semanticMemory: SemanticMemory;
  private indexedCount: number = 0;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    const dbPath = path.join(this.projectRoot, '.linguclaw', 'rag-memory.db');
    this.semanticMemory = new SemanticMemory(dbPath);
    this.available = false;
  }

  /**
   * Initialize memory
   */
  async init(): Promise<boolean> {
    try {
      const ok = this.semanticMemory.init();
      if (ok) {
        this.available = true;
        const stats = this.semanticMemory.getStats();
        this.indexedCount = stats.totalDocuments;
        logger.info(`RAG memory initialized (${this.indexedCount} chunks indexed)`);
      }
      return ok;
    } catch (error: any) {
      logger.warn(`RAG memory init failed: ${error.message}`);
      this.available = false;
      return false;
    }
  }

  /**
   * Index project codebase
   */
  async indexProject(force: boolean = false): Promise<number> {
    if (!this.available) {
      logger.warn('RAG memory not available');
      return 0;
    }

    const stats = this.getStats();
    if (stats.count > 0 && !force) {
      logger.info(`Memory already has ${stats.count} chunks, use force=true to reindex`);
      return 0;
    }

    // Find all code files
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.h'];
    const files: string[] = [];
    
    const findFiles = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules' && entry !== 'dist' && entry !== 'tests' && entry !== '__pycache__') {
            findFiles(fullPath);
          } else if (stat.isFile() && extensions.some(ext => entry.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      } catch (err: any) {
        logger.debug(`Skipping unreadable directory ${dir}: ${err.message}`);
      }
    };

    findFiles(this.projectRoot);

    // Parse and index files with AST for TypeScript
    let indexed = 0;
    const parsedChunks: ParsedChunk[] = [];

    for (const file of files) {
      try {
        const ext = path.extname(file);
        if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
          // Use AST-based parsing for TypeScript/JavaScript
          const chunks = parseTypeScriptFile(file);
          parsedChunks.push(...chunks);
          indexed += chunks.length;
        } else {
          // Use regex-based parsing for other languages
          const content = fs.readFileSync(file, 'utf-8');
          const chunks = parseGenericFile(file, content);
          parsedChunks.push(...chunks);
          indexed += chunks.length;
        }
      } catch (error) {
        logger.warn(`Failed to index ${file}: ${error}`);
      }
    }

    // Store chunks in semantic memory with rich metadata
    for (const chunk of parsedChunks) {
      this.semanticMemory.store(chunk.id, chunk.content, 'code', {
        file_path: chunk.filePath,
        chunk_type: chunk.chunkType,
        name: chunk.name,
        line_start: chunk.lineStart,
        line_end: chunk.lineEnd,
        signature: chunk.signature,
        documentation: chunk.documentation,
        is_exported: chunk.isExported,
        dependencies: chunk.dependencies,
        dependents: chunk.dependents,
      });
    }

    // Rebuild TF-IDF index after batch insert
    if (parsedChunks.length > 0) {
      this.semanticMemory.rebuildIndex();
    }

    this.indexedCount = parsedChunks.length;
    logger.info(`Indexed ${indexed} AST chunks from ${files.length} files`);
    return indexed;
  }

  /**
   * Parse file into chunks
   */
  private parseFile(filePath: string, content: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath);

    // Simple parsing: Split into logical sections
    // In production, you'd use AST parsing
    let currentChunk: Partial<CodeChunk> = {
      id: `${filePath}-chunk-0`,
      file_path: filePath,
      content: '',
      chunk_type: 'other',
      name: baseName,
      line_start: 1,
      line_end: 1,
    };

    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Detect function/class definitions (simplified)
      const isFunction = /^(export\s+)?(async\s+)?function\s+\w+/.test(line) ||
                        /^(export\s+)?(async\s+)?\w+\s*\([^)]*\)\s*\{?\s*$/.test(line);
      const isClass = /^(export\s+)?class\s+\w+/.test(line);

      if ((isFunction || isClass) && currentChunk.content) {
        // Save previous chunk
        chunks.push({
          ...currentChunk as CodeChunk,
          id: `${filePath}-chunk-${chunkIndex++}`,
          line_end: i,
        });

        // Start new chunk
        currentChunk = {
          id: '',
          file_path: filePath,
          content: line,
          chunk_type: isFunction ? 'function' : 'class',
          name: this.extractName(line) || baseName,
          line_start: i + 1,
          line_end: i + 1,
        };
      } else {
        currentChunk.content += '\n' + line;
        currentChunk.line_end = i + 1;
      }
    }

    // Add final chunk
    if (currentChunk.content) {
      chunks.push({
        ...currentChunk as CodeChunk,
        id: `${filePath}-chunk-${chunkIndex}`,
      });
    }

    return chunks;
  }

  /**
   * Extract name from definition line
   */
  private extractName(line: string): string | null {
    const match = line.match(/(?:function|class)\s+(\w+)/);
    return match ? match[1] : null;
  }

  /**
   * Search codebase with smart context
   */
  async search(query: string, k: number = 5): Promise<string> {
    if (!this.available) {
      return '[Memory unavailable]';
    }

    try {
      const results = this.semanticMemory.search(query, k, 'code');

      if (!results || results.length === 0) {
        return '[No relevant code found]';
      }

      const formatted = results.map((r, i) => {
        const meta = r.metadata || {};
        let context = `[${i + 1}] ${meta.chunk_type || 'code'}: ${meta.name || 'unknown'} (${meta.file_path || '?'}:${meta.line_start || '?'})`;
        if (meta.signature) context += `\n   Signature: ${meta.signature}`;
        if (meta.documentation) context += `\n   Docs: ${meta.documentation.substring(0, 100)}...`;
        if (meta.dependencies?.length > 0) context += `\n   Uses: ${meta.dependencies.slice(0, 5).join(', ')}`;
        context += `\n${r.content.slice(0, 200)}...`;
        return context;
      });

      return formatted.join('\n\n');
    } catch (error: any) {
      logger.error(`Search error: ${error.message}`);
      return `[Search error: ${error.message}]`;
    }
  }

  /**
   * Get memory stats
   */
  getStats(): { count: number } {
    if (!this.available) {
      return { count: 0 };
    }

    try {
      const stats = this.semanticMemory.getStats();
      return { count: stats.totalDocuments };
    } catch (err: any) {
      logger.debug(`getStats error: ${err.message}`);
      return { count: 0 };
    }
  }

  /**
   * Get related code for a symbol
   */
  getRelated(symbol: string, k: number = 3): string {
    if (!this.available) return '[Memory unavailable]';
    
    try {
      // Find the symbol
      const all = this.semanticMemory.search(symbol, 50, 'code');
      const target = all.find(r => r.metadata?.name === symbol);
      if (!target) return `[Symbol '${symbol}' not found]`;

      // Get dependencies and dependents
      const meta = target.metadata || {};
      const deps = meta.dependencies || [];
      const dps = meta.dependents || [];
      
      let result = `Related to ${symbol}:\n\n`;
      if (deps.length > 0) result += `Dependencies: ${deps.slice(0, k).join(', ')}\n`;
      if (dps.length > 0) result += `Used by: ${dps.slice(0, k).join(', ')}\n`;
      
      return result;
    } catch (err: any) {
      logger.error(`getRelated error: ${err.message}`);
      return `[Error: ${err.message}]`;
    }
  }
}
