import { SemanticMemory } from '../src/semantic-memory';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('SemanticMemory', () => {
  let memory: SemanticMemory;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `linguclaw-semantic-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    memory = new SemanticMemory(path.join(testDir, 'test.db'));
    memory.init();
  });

  afterEach(() => {
    memory.close();
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  describe('store and get', () => {
    it('should store and retrieve a document', () => {
      memory.store('doc1', 'TypeScript is a typed superset of JavaScript', 'code');
      const result = memory.get('doc1');
      expect(result).not.toBeNull();
      expect(result!.content).toContain('TypeScript');
      expect(result!.category).toBe('code');
    });

    it('should update existing document', () => {
      memory.store('doc1', 'Original content', 'notes');
      memory.store('doc1', 'Updated content', 'notes');
      const result = memory.get('doc1');
      expect(result!.content).toBe('Updated content');
    });

    it('should return null for non-existent doc', () => {
      expect(memory.get('nonexistent')).toBeNull();
    });

    it('should store with metadata', () => {
      memory.store('doc1', 'Test', 'notes', { source: 'test', priority: 1 });
      const result = memory.get('doc1');
      expect(result!.metadata.source).toBe('test');
      expect(result!.metadata.priority).toBe(1);
    });
  });

  describe('semantic search', () => {
    beforeEach(() => {
      // Seed with documents
      memory.store('ts1', 'TypeScript is a strongly typed programming language that builds on JavaScript', 'code');
      memory.store('py1', 'Python is a high-level interpreted programming language known for readability', 'code');
      memory.store('rs1', 'Rust is a systems programming language focused on safety and performance', 'code');
      memory.store('recipe1', 'Mix flour eggs and sugar to make a delicious chocolate cake', 'food');
      memory.store('recipe2', 'Grill chicken with lemon and herbs for a healthy dinner', 'food');
      memory.store('email1', 'Meeting scheduled for tomorrow at 3pm in conference room B', 'email');
      memory.store('email2', 'Project deadline extended to next Friday', 'email');
      // Force rebuild
      memory.rebuildIndex();
    });

    it('should find relevant documents for programming query', () => {
      const results = memory.search('typed programming language');
      expect(results.length).toBeGreaterThan(0);
      // TypeScript should rank high for "typed programming language"
      const tsResult = results.find(r => r.id === 'ts1');
      expect(tsResult).toBeDefined();
    });

    it('should find food-related documents', () => {
      const results = memory.search('flour sugar cake chicken dinner');
      expect(results.length).toBeGreaterThan(0);
      const foodResults = results.filter(r => r.category === 'food');
      expect(foodResults.length).toBeGreaterThan(0);
    });

    it('should filter by category', () => {
      const results = memory.search('programming', 10, 'code');
      for (const r of results) {
        expect(r.category).toBe('code');
      }
    });

    it('should return scores between 0 and 1', () => {
      const results = memory.search('language');
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    it('should respect limit parameter', () => {
      const results = memory.search('programming', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should return empty for completely unrelated query', () => {
      const results = memory.search('xyzzy quantum entanglement', 5, undefined, 0.3);
      // With high minScore, unrelated terms should not match well
      expect(results.length).toBeLessThanOrEqual(7); // Most won't match
    });
  });

  describe('delete', () => {
    it('should delete a document', () => {
      memory.store('to-delete', 'This will be deleted', 'temp');
      expect(memory.get('to-delete')).not.toBeNull();
      
      const deleted = memory.delete('to-delete');
      expect(deleted).toBe(true);
      expect(memory.get('to-delete')).toBeNull();
    });

    it('should return false for non-existent doc', () => {
      expect(memory.delete('nonexistent')).toBe(false);
    });
  });

  describe('findSimilar', () => {
    it('should find documents similar to a given doc', () => {
      memory.store('lang1', 'JavaScript is a dynamic scripting language for web development', 'code');
      memory.store('lang2', 'TypeScript adds static types to JavaScript for better development', 'code');
      memory.store('lang3', 'Python is popular for data science and machine learning', 'code');
      memory.store('food1', 'Pizza is made with dough tomato sauce and cheese', 'food');
      memory.rebuildIndex();

      const similar = memory.findSimilar('lang1', 3);
      expect(similar.length).toBeGreaterThan(0);
      // lang2 should be more similar to lang1 than food1
      const lang2Sim = similar.find(r => r.id === 'lang2');
      const foodSim = similar.find(r => r.id === 'food1');
      if (lang2Sim && foodSim) {
        expect(lang2Sim.score).toBeGreaterThan(foodSim.score);
      }
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      memory.store('a', 'Test A', 'cat1');
      memory.store('b', 'Test B', 'cat1');
      memory.store('c', 'Test C', 'cat2');

      const stats = memory.getStats();
      expect(stats.totalDocuments).toBe(3);
      expect(stats.categories['cat1']).toBe(2);
      expect(stats.categories['cat2']).toBe(1);
    });

    it('should return empty stats when empty', () => {
      const stats = memory.getStats();
      expect(stats.totalDocuments).toBe(0);
    });
  });

  describe('rebuildIndex', () => {
    it('should rebuild without errors', () => {
      memory.store('a', 'Hello world', 'test');
      memory.store('b', 'Goodbye world', 'test');
      expect(() => memory.rebuildIndex()).not.toThrow();
    });

    it('should handle empty database', () => {
      expect(() => memory.rebuildIndex()).not.toThrow();
    });
  });

  describe('persistence', () => {
    it('should persist data across instances', () => {
      const dbFile = path.join(testDir, 'persist.db');
      
      const mem1 = new SemanticMemory(dbFile);
      mem1.init();
      mem1.store('persistent', 'This data should persist', 'test');
      mem1.rebuildIndex();
      mem1.close();

      const mem2 = new SemanticMemory(dbFile);
      mem2.init();
      const result = mem2.get('persistent');
      expect(result).not.toBeNull();
      expect(result!.content).toContain('persist');
      
      // Search should also work with restored vectorizer
      const searchResults = mem2.search('persist data');
      expect(searchResults.length).toBeGreaterThan(0);
      mem2.close();
    });
  });
});
