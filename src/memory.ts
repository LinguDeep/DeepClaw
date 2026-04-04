/**
 * RAG Memory system with LanceDB
 * TypeScript equivalent of Python memory.py
 */

import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { CodeChunk } from './types';
import { getLogger } from './logger';

const execAsync = promisify(execCallback);
const logger = getLogger();

export class RAGMemory {
  projectRoot: string;
  dbPath: string;
  available: boolean;
  private lancedb: any;
  private table: any;
  private embeddingFunction: any;
  private db: any;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.dbPath = path.join(this.projectRoot, '.linguclaw', 'memory');
    this.available = false;
    this.lancedb = null;
    this.table = null;
    this.embeddingFunction = null;
  }

  /**
   * Initialize LanceDB connection
   */
  async init(): Promise<boolean> {
    try {
      // Dynamic import for optional dependency
      let lancedb: any;
      try {
        lancedb = require('vectordb');
      } catch (e) {
        logger.warn('vectordb module not installed, RAG memory unavailable');
        return false;
      }
      this.lancedb = lancedb;
      
      // Connect to/create database
      this.db = await lancedb.connect(this.dbPath);
      
      // Setup embedding function (using sentence-transformers via API or local)
      // In production, you'd use a proper embedding model
      this.embeddingFunction = {
        sourceColumn: 'content',
        embed: async (texts: string[]): Promise<number[][]> => {
          // Placeholder: In real implementation, use sentence-transformers
          return texts.map(() => new Array(384).fill(0).map(() => Math.random()));
        },
      };

      // Open or create table
      try {
        this.table = await this.db.openTable('codebase', this.embeddingFunction);
      } catch {
        this.table = await this.db.createTable('codebase', [], this.embeddingFunction);
      }

      this.available = true;
      logger.info(`RAG memory initialized at ${this.dbPath}`);
      return true;
    } catch (error: any) {
      logger.warn(`RAG memory unavailable: ${error.message}`);
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
          
          if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
            findFiles(fullPath);
          } else if (stat.isFile() && extensions.some(ext => entry.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    findFiles(this.projectRoot);

    // Parse and index files
    let indexed = 0;
    const chunks: CodeChunk[] = [];

    for (const file of files.slice(0, 100)) { // Limit to 100 files
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const fileChunks = this.parseFile(file, content);
        chunks.push(...fileChunks);
        indexed += fileChunks.length;
      } catch (error) {
        logger.warn(`Failed to index ${file}: ${error}`);
      }
    }

    // Add to LanceDB
    if (chunks.length > 0) {
      const records = chunks.map(chunk => ({
        id: chunk.id,
        content: chunk.content,
        file_path: chunk.file_path,
        chunk_type: chunk.chunk_type,
        name: chunk.name,
        line_start: chunk.line_start,
        line_end: chunk.line_end,
      }));

      await this.table.add(records);
    }

    logger.info(`Indexed ${indexed} chunks from ${files.length} files`);
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
   * Search codebase
   */
  async search(query: string, k: number = 5): Promise<string> {
    if (!this.available || !this.table) {
      return '[Memory unavailable]';
    }

    try {
      const results = await this.table.search(query).limit(k).execute();
      
      if (!results || results.length === 0) {
        return '[No relevant code found]';
      }

      const formatted = results.map((r: any, i: number) => 
        `[${i + 1}] ${r.chunk_type}: ${r.name} (${r.file_path}:${r.line_start})\n${r.content.slice(0, 200)}...`
      );

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
    if (!this.available || !this.table) {
      return { count: 0 };
    }

    try {
      // LanceDB doesn't have a simple count method
      // This is a simplified version
      return { count: 0 };
    } catch {
      return { count: 0 };
    }
  }
}
