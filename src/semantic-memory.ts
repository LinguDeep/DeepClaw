/**
 * Semantic Memory - TF-IDF based vector search using SQLite
 * No external API or ML library required. Production-ready.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getLogger } from './logger';

const logger = getLogger();

interface Document {
  id: string;
  content: string;
  category: string;
  metadata: string; // JSON string
  embedding: string; // JSON string of number[]
  created_at: string;
  updated_at: string;
}

interface SearchResult {
  id: string;
  content: string;
  category: string;
  metadata: Record<string, any>;
  score: number;
}

/**
 * TF-IDF Vectorizer - converts text to numerical vectors for similarity search
 */
class TFIDFVectorizer {
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private vocabSize: number = 0;
  private documentCount: number = 0;
  private documentFreq: Map<string, number> = new Map();

  // Tokenize text into terms
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && t.length < 50)
      .filter(t => !this.isStopWord(t));
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
      'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
      'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
      'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
      'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
      'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this', 'it',
      'its', 'his', 'her', 'their', 'my', 'your', 'our', 'we', 'they',
      'he', 'she', 'me', 'him', 'them', 'what', 'which', 'who', 'whom',
      've', 've', 'll', 're', 'don', 'doesn', 'didn', 'won', 'wouldn',
      'bir', 've', 'ile', 'bu', 'da', 'de', 'den', 'dan', 'bir',
      'var', 'yok', 'ama', 'fakat', 'icin', 'için', 'gibi', 'kadar',
    ]);
    return stopWords.has(word);
  }

  // Build or update vocabulary from a set of documents
  buildVocabulary(documents: string[]): void {
    this.documentCount = documents.length;
    this.documentFreq.clear();

    // Count document frequency for each term
    for (const doc of documents) {
      const terms = new Set(this.tokenize(doc));
      for (const term of terms) {
        this.documentFreq.set(term, (this.documentFreq.get(term) || 0) + 1);
      }
    }

    // Build vocabulary (top N terms by document frequency, excluding very rare)
    const maxVocab = 5000;
    const sorted = Array.from(this.documentFreq.entries())
      .filter(([_, freq]) => freq >= 1) // At least 1 document
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxVocab);

    this.vocabulary.clear();
    sorted.forEach(([term], idx) => this.vocabulary.set(term, idx));
    this.vocabSize = this.vocabulary.size;

    // Compute IDF
    this.idf.clear();
    for (const [term, freq] of this.documentFreq) {
      if (this.vocabulary.has(term)) {
        this.idf.set(term, Math.log((this.documentCount + 1) / (freq + 1)) + 1);
      }
    }
  }

  // Convert text to TF-IDF vector
  vectorize(text: string): number[] {
    if (this.vocabSize === 0) return [];

    const terms = this.tokenize(text);
    const tf: Map<string, number> = new Map();

    // Count term frequency
    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }

    // Build TF-IDF vector
    const vector = new Array(this.vocabSize).fill(0);
    const totalTerms = terms.length || 1;

    for (const [term, count] of tf) {
      const idx = this.vocabulary.get(term);
      if (idx !== undefined) {
        const termFreq = count / totalTerms;
        const idfVal = this.idf.get(term) || 1;
        vector[idx] = termFreq * idfVal;
      }
    }

    // L2 normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  // Compute cosine similarity between two vectors
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot; // Vectors are already L2 normalized
  }

  // Serialize/deserialize for persistence
  serialize(): string {
    return JSON.stringify({
      vocabulary: Array.from(this.vocabulary.entries()),
      idf: Array.from(this.idf.entries()),
      vocabSize: this.vocabSize,
      documentCount: this.documentCount,
      documentFreq: Array.from(this.documentFreq.entries()),
    });
  }

  static deserialize(data: string): TFIDFVectorizer {
    const v = new TFIDFVectorizer();
    try {
      const parsed = JSON.parse(data);
      v.vocabulary = new Map(parsed.vocabulary);
      v.idf = new Map(parsed.idf);
      v.vocabSize = parsed.vocabSize;
      v.documentCount = parsed.documentCount;
      v.documentFreq = new Map(parsed.documentFreq);
    } catch (err: any) {
      logger.warn(`Failed to deserialize vectorizer: ${err.message}`);
    }
    return v;
  }
}

/**
 * SemanticMemory - Full semantic search with TF-IDF vectors stored in SQLite
 */
export class SemanticMemory {
  private db: Database.Database | null = null;
  private vectorizer: TFIDFVectorizer;
  private dbPath: string;
  private dirty: boolean = false; // Needs re-vectorization
  private initialized: boolean = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.env.HOME || '~', '.linguclaw', 'semantic-memory.db');
    this.vectorizer = new TFIDFVectorizer();
  }

  init(): boolean {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      this.db = new Database(this.dbPath);

      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          category TEXT DEFAULT 'general',
          metadata TEXT DEFAULT '{}',
          embedding TEXT DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS vectorizer_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          state TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      this.db.exec('CREATE INDEX IF NOT EXISTS idx_doc_category ON documents(category)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_doc_created ON documents(created_at)');

      // Restore vectorizer state
      const stateRow = this.db.prepare('SELECT state FROM vectorizer_state WHERE id = 1').get() as { state: string } | undefined;
      if (stateRow) {
        this.vectorizer = TFIDFVectorizer.deserialize(stateRow.state);
      }

      this.initialized = true;
      logger.info(`Semantic memory initialized at ${this.dbPath}`);
      return true;
    } catch (err: any) {
      logger.error(`Semantic memory init failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Store a document with automatic embedding
   */
  store(id: string, content: string, category: string = 'general', metadata: Record<string, any> = {}): boolean {
    if (!this.db || !this.initialized) return false;

    try {
      const now = new Date().toISOString();
      const embedding = this.vectorizer.vectorize(content);

      this.db.prepare(`
        INSERT OR REPLACE INTO documents (id, content, category, metadata, embedding, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM documents WHERE id = ?), ?), ?)
      `).run(id, content, category, JSON.stringify(metadata), JSON.stringify(embedding), id, now, now);

      this.dirty = true;
      return true;
    } catch (err: any) {
      logger.error(`Semantic store failed for ${id}: ${err.message}`);
      return false;
    }
  }

  /**
   * Semantic search - find documents similar to query
   */
  search(query: string, limit: number = 10, category?: string, minScore: number = 0.05): SearchResult[] {
    if (!this.db || !this.initialized) return [];

    try {
      // Rebuild index if needed
      if (this.dirty) {
        this.rebuildIndex();
      }

      const queryVector = this.vectorizer.vectorize(query);
      if (queryVector.length === 0) {
        // Fallback to text search if vectorizer has no vocabulary
        return this.textSearch(query, limit, category);
      }

      // Load all documents and compute similarity
      let sql = 'SELECT id, content, category, metadata, embedding FROM documents';
      const params: any[] = [];

      if (category) {
        sql += ' WHERE category = ?';
        params.push(category);
      }

      const rows = this.db.prepare(sql).all(...params) as Document[];

      const scored: SearchResult[] = [];
      for (const row of rows) {
        try {
          const docVector = JSON.parse(row.embedding);
          if (docVector.length !== queryVector.length) continue;

          const score = TFIDFVectorizer.cosineSimilarity(queryVector, docVector);
          if (score >= minScore) {
            scored.push({
              id: row.id,
              content: row.content,
              category: row.category,
              metadata: JSON.parse(row.metadata),
              score,
            });
          }
        } catch {
          // Skip documents with invalid embeddings
        }
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    } catch (err: any) {
      logger.error(`Semantic search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Text-based fallback search
   */
  private textSearch(query: string, limit: number, category?: string): SearchResult[] {
    if (!this.db) return [];

    let sql = 'SELECT id, content, category, metadata FROM documents WHERE content LIKE ?';
    const params: any[] = [`%${query}%`];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => {
      let metadata = {};
      try { metadata = JSON.parse(row.metadata || '{}'); } catch { /* skip invalid */ }
      return {
        id: row.id,
        content: row.content,
        category: row.category,
        metadata,
        score: 0.5,
      };
    });
  }

  /**
   * Rebuild TF-IDF index from all documents
   */
  rebuildIndex(): void {
    if (!this.db) return;

    try {
      const rows = this.db.prepare('SELECT id, content FROM documents').all() as { id: string; content: string }[];

      if (rows.length === 0) {
        this.dirty = false;
        return;
      }

      // Rebuild vocabulary
      this.vectorizer.buildVocabulary(rows.map(r => r.content));

      // Re-embed all documents
      const updateStmt = this.db.prepare('UPDATE documents SET embedding = ? WHERE id = ?');
      const transaction = this.db.transaction(() => {
        for (const row of rows) {
          const embedding = this.vectorizer.vectorize(row.content);
          updateStmt.run(JSON.stringify(embedding), row.id);
        }
      });
      transaction();

      // Save vectorizer state
      this.db.prepare(`
        INSERT OR REPLACE INTO vectorizer_state (id, state, updated_at)
        VALUES (1, ?, ?)
      `).run(this.vectorizer.serialize(), new Date().toISOString());

      this.dirty = false;
      logger.info(`Semantic index rebuilt: ${rows.length} documents`);
    } catch (err: any) {
      logger.error(`Index rebuild failed: ${err.message}`);
    }
  }

  /**
   * Retrieve a specific document by ID
   */
  get(id: string): { content: string; category: string; metadata: Record<string, any> } | null {
    if (!this.db) return null;

    try {
      const row = this.db.prepare('SELECT content, category, metadata FROM documents WHERE id = ?').get(id) as any;
      if (!row) return null;
      return { content: row.content, category: row.category, metadata: JSON.parse(row.metadata || '{}') };
    } catch (err: any) {
      logger.error(`Semantic get failed for ${id}: ${err.message}`);
      return null;
    }
  }

  /**
   * Delete a document
   */
  delete(id: string): boolean {
    if (!this.db) return false;
    try {
      const result = this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      if (result.changes > 0) this.dirty = true;
      return result.changes > 0;
    } catch (err: any) {
      logger.error(`Semantic delete failed for ${id}: ${err.message}`);
      return false;
    }
  }

  /**
   * Get stats
   */
  getStats(): { totalDocuments: number; categories: Record<string, number>; vocabularySize: number } {
    if (!this.db) return { totalDocuments: 0, categories: {}, vocabularySize: 0 };

    try {
      const total = (this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as any).count;
      const catRows = this.db.prepare('SELECT category, COUNT(*) as count FROM documents GROUP BY category').all() as any[];
      const categories: Record<string, number> = {};
      for (const row of catRows) {
        categories[row.category] = row.count;
      }

      return {
        totalDocuments: total,
        categories,
        vocabularySize: this.vectorizer['vocabSize'] || 0,
      };
    } catch (err: any) {
      logger.error(`Semantic stats failed: ${err.message}`);
      return { totalDocuments: 0, categories: {}, vocabularySize: 0 };
    }
  }

  /**
   * Find similar documents to a given document
   */
  findSimilar(docId: string, limit: number = 5): SearchResult[] {
    const doc = this.get(docId);
    if (!doc) return [];
    return this.search(doc.content, limit + 1).filter(r => r.id !== docId).slice(0, limit);
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Global instance
let semanticMemoryInstance: SemanticMemory | null = null;

export function getSemanticMemory(): SemanticMemory {
  if (!semanticMemoryInstance) {
    semanticMemoryInstance = new SemanticMemory();
    semanticMemoryInstance.init();
  }
  return semanticMemoryInstance;
}
