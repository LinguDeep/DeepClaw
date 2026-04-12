/**
 * Large Codebase Performance Tests
 * Tests TF-IDF and memory performance with 10,000+ files
 */

import { SemanticMemory } from '../src/semantic-memory';
import { RAGMemory } from '../src/memory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Large Codebase Performance - 10,000+ Files', () => {
  let tempDir: string;
  let semanticMemory: SemanticMemory;
  let ragMemory: RAGMemory;

  beforeAll(async () => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguclaw-large-test-'));
    semanticMemory = new SemanticMemory(tempDir);
    ragMemory = new RAGMemory(tempDir);
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('File Generation', () => {
    it('should generate 10000 TypeScript files', () => {
      const fileCount = 10000;
      const batchSize = 1000;
      
      console.log(`Generating ${fileCount} files...`);
      const startTime = Date.now();

      for (let batch = 0; batch < fileCount / batchSize; batch++) {
        for (let i = 0; i < batchSize; i++) {
          const fileIndex = batch * batchSize + i;
          const filePath = path.join(tempDir, `module-${Math.floor(fileIndex / 100)}`, `file-${fileIndex}.ts`);
          
          // Create directory if needed
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          // Generate realistic TypeScript code with varying complexity
          const code = generateTypeScriptFile(fileIndex);
          fs.writeFileSync(filePath, code);
        }
        
        console.log(`  Batch ${batch + 1}/${fileCount / batchSize} complete`);
      }

      const duration = Date.now() - startTime;
      console.log(`Generated ${fileCount} files in ${duration}ms`);

      // Verify
      const stats = countFiles(tempDir);
      expect(stats).toBeGreaterThanOrEqual(fileCount);
    }, 300000); // 5 minute timeout
  });

  describe('Indexing Performance', () => {
    it('should index 10000 files within reasonable time', async () => {
      const startTime = Date.now();
      
      await ragMemory.init();
      
      const duration = Date.now() - startTime;
      console.log(`Indexed in ${duration}ms`);
      
      // Should complete within 5 minutes
      expect(duration).toBeLessThan(300000);
      
      // Check memory stats
      const stats = ragMemory.getStats();
      console.log('Memory stats:', stats);
    }, 300000);

    it('should handle vocabulary size efficiently', async () => {
      const startTime = Date.now();
      
      // Search multiple times to test TF-IDF performance
      const queries = [
        'calculate function',
        'export class',
        'async await',
        'interface Props',
        'useEffect hook',
      ];

      for (const query of queries) {
        const searchStart = Date.now();
        const results = await ragMemory.search(query, 10);
        const searchDuration = Date.now() - searchStart;
        
        console.log(`Query "${query}": ${searchDuration}ms, ${results.length} results`);
        expect(searchDuration).toBeLessThan(5000); // Each query under 5s
      }

      const totalDuration = Date.now() - startTime;
      console.log(`All searches completed in ${totalDuration}ms`);
    }, 60000);
  });

  describe('Memory Usage', () => {
    it('should not exceed memory limits during indexing', async () => {
      const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      await ragMemory.init();
      
      const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      const memoryIncrease = finalMemory - initialMemory;
      
      console.log(`Memory increase: ${memoryIncrease.toFixed(2)} MB`);
      console.log(`Final heap: ${finalMemory.toFixed(2)} MB`);
      
      // Should use less than 2GB for 10k files
      expect(memoryIncrease).toBeLessThan(2048);
    }, 300000);
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent searches', async () => {
      await ragMemory.init();
      
      const startTime = Date.now();
      
      // Run 50 concurrent searches
      const promises = Array(50).fill(0).map((_, i) => 
        ragMemory.search(`query ${i}`, 5)
      );
      
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      console.log(`50 concurrent searches in ${duration}ms`);
      expect(duration).toBeLessThan(30000); // Under 30s
      expect(results).toHaveLength(50);
    }, 60000);
  });

  describe('Semantic Memory at Scale', () => {
    it('should store and retrieve 10000 documents', () => {
      const startTime = Date.now();
      
      // Store documents
      for (let i = 0; i < 10000; i++) {
        semanticMemory.store(
          `doc-${i}`,
          `Document content ${i} with various keywords for testing search functionality`,
          'test',
          { index: i, timestamp: Date.now() }
        );
        
        if (i % 1000 === 0) {
          console.log(`  Stored ${i}/10000 documents`);
        }
      }
      
      const storeDuration = Date.now() - startTime;
      console.log(`Stored 10000 documents in ${storeDuration}ms`);
      
      // Search
      const searchStart = Date.now();
      const results = semanticMemory.search('testing search', 10);
      const searchDuration = Date.now() - searchStart;
      
      console.log(`Search in ${searchDuration}ms, found ${results.length} results`);
      
      expect(storeDuration).toBeLessThan(60000);
      expect(searchDuration).toBeLessThan(1000);
    }, 120000);
  });
});

// Helper functions
function generateTypeScriptFile(index: number): string {
  const functions = [
    'calculate', 'process', 'transform', 'validate', 'parse',
    'format', 'convert', 'extract', 'filter', 'sort',
    'map', 'reduce', 'find', 'search', 'update',
  ];
  
  const classes = [
    'User', 'Product', 'Order', 'Item', 'Category',
    'Manager', 'Service', 'Controller', 'Component', 'Module',
  ];
  
  const interfaces = [
    'Props', 'Config', 'Options', 'Params', 'Result',
    'Data', 'State', 'Context', 'Response', 'Request',
  ];

  const funcName = functions[index % functions.length];
  const className = classes[index % classes.length];
  const interfaceName = interfaces[index % interfaces.length];
  
  return `
/**
 * Auto-generated file ${index}
 * Module: ${Math.floor(index / 100)}
 */

export interface ${interfaceName}${index} {
  id: number;
  name: string;
  data: any;
  timestamp: Date;
}

export class ${className}${index} {
  private items: ${interfaceName}${index}[] = [];
  
  constructor(private config: any) {}
  
  async ${funcName}(input: any): Promise<any> {
    // Process ${index}
    const result = await this.processInternal(input);
    return this.formatResult(result);
  }
  
  private async processInternal(data: any): Promise<any> {
    return { processed: true, index: ${index}, data };
  }
  
  private formatResult(result: any): any {
    return { ...result, formatted: true };
  }
  
  public addItem(item: ${interfaceName}${index}): void {
    this.items.push(item);
  }
  
  public getItems(): ${interfaceName}${index}[] {
    return this.items;
  }
}

export function ${funcName}Helper(data: any): any {
  return new ${className}${index}({}).${funcName}(data);
}

export default ${className}${index};
`;
}

function countFiles(dir: string): number {
  let count = 0;
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      count += countFiles(fullPath);
    } else if (item.endsWith('.ts')) {
      count++;
    }
  }
  
  return count;
}
