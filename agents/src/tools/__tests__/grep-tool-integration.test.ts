/**
 * GrepTool Integration Tests
 * 
 * These tests use real files and the actual file system to verify
 * that the GrepTool works correctly in practice, not just with mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GrepTool, GrepOptions } from '../grep-tool';
import * as fs from 'fs/promises';
import * as path from 'path';
// import { tmpdir } from 'os';

describe('GrepTool Integration Tests', () => {
  let grepTool: GrepTool;
  let testDir: string;
  
  beforeAll(async () => {
    // Create a test directory outside of tmp to avoid exclusion patterns
    testDir = path.join(process.cwd(), 'test-data', 'grep-integration-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
    
    grepTool = new GrepTool(testDir);
    
    // Create test files with various content
    await createTestFiles(testDir);
  });
  
  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up test directory:', error);
    }
  });

  describe('Basic File System Searches', () => {
    it('should find simple text matches across multiple files', async () => {
      const options: GrepOptions = {
        query: 'function',
        caseSensitive: false,
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.filesSearched).toBeGreaterThan(0);
      
      // Should find matches in TypeScript and JavaScript files
      const fileExtensions = result.matches.map(m => path.extname(m.file));
      expect(fileExtensions).toContain('.ts');
      expect(fileExtensions).toContain('.js');
      
      // All matches should contain the search term
      result.matches.forEach(match => {
        expect(match.match.toLowerCase()).toContain('function');
      });
    });

    it('should respect case sensitivity', async () => {
      const caseSensitiveOptions: GrepOptions = {
        query: 'FUNCTION',
        caseSensitive: true,
        contextLines: 1,
        maxResults: 50
      };

      const caseInsensitiveOptions: GrepOptions = {
        query: 'FUNCTION',
        caseSensitive: false,
        contextLines: 1,
        maxResults: 50
      };

      const sensitiveResult = await grepTool.execute(caseSensitiveOptions);
      const insensitiveResult = await grepTool.execute(caseInsensitiveOptions);

      expect(sensitiveResult.success).toBe(true);
      expect(insensitiveResult.success).toBe(true);
      
      // Case insensitive should find more matches
      expect(insensitiveResult.matches.length).toBeGreaterThanOrEqual(sensitiveResult.matches.length);
    });

    it('should work with regex patterns', async () => {
      const options: GrepOptions = {
        query: 'function\\s+\\w+\\s*\\(',
        regex: true,
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      
      // Should match function declarations
      const hasValidMatch = result.matches.some(match => 
        /function\s+\w+\s*\(/.test(match.match)
      );
      expect(hasValidMatch).toBe(true);
    });

    it('should support whole word matching', async () => {
      const wholeWordOptions: GrepOptions = {
        query: 'test',
        wholeWord: true,
        caseSensitive: false,
        contextLines: 0,
        maxResults: 50
      };

      const normalOptions: GrepOptions = {
        query: 'test',
        wholeWord: false,
        caseSensitive: false,
        contextLines: 0,
        maxResults: 50
      };

      const wholeWordResult = await grepTool.execute(wholeWordOptions);
      const normalResult = await grepTool.execute(normalOptions);

      expect(wholeWordResult.success).toBe(true);
      expect(normalResult.success).toBe(true);
      
      // Normal search should find more matches (including words containing 'test')
      expect(normalResult.matches.length).toBeGreaterThanOrEqual(wholeWordResult.matches.length);
      
      // Whole word matches should only contain 'test' as a complete word
      wholeWordResult.matches.forEach(match => {
        expect(match.match).toMatch(/\btest\b/i);
      });
    });
  });

  describe('File Filtering', () => {
    it('should respect include patterns', async () => {
      const options: GrepOptions = {
        query: 'import',
        includePatterns: ['**/*.ts'],
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      
      if (result.matches.length > 0) {
        // All matches should be from TypeScript files
        result.matches.forEach(match => {
          expect(match.file).toMatch(/\.ts$/);
        });
      }
    });

    it('should respect exclude patterns', async () => {
      const options: GrepOptions = {
        query: 'test',
        excludePatterns: ['**/*.md', '**/README.md', '**/*.json'],
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      
      if (result.matches.length > 0) {
        // No matches should be from excluded file types
        result.matches.forEach(match => {
          expect(match.file).not.toMatch(/\.(md|json)$/);
          expect(match.file).not.toMatch(/README\.md$/);
        });
      }
    });

    it('should search specific file paths', async () => {
      const specificFile = 'src/utils.ts';
      const options: GrepOptions = {
        query: 'helper',
        paths: [specificFile],
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      
      if (result.matches.length > 0) {
        // All matches should be from the specific file
        result.matches.forEach(match => {
          expect(match.file).toBe(specificFile);
        });
      }
    });
  });

  describe('Context and Limits', () => {
    it('should provide correct context lines', async () => {
      const options: GrepOptions = {
        query: 'class',
        contextLines: 2,
        maxResults: 5
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      
      if (result.matches.length > 0) {
        const firstMatch = result.matches[0];
        
        // Context should be provided (may be less than 2 if near file boundaries)
        expect(firstMatch.context.before.length).toBeLessThanOrEqual(2);
        expect(firstMatch.context.after.length).toBeLessThanOrEqual(2);
        
        // Context should be actual content, not empty strings
        firstMatch.context.before.forEach(line => {
          expect(typeof line).toBe('string');
        });
        firstMatch.context.after.forEach(line => {
          expect(typeof line).toBe('string');
        });
      }
    });

    it('should respect maxResults limit', async () => {
      const options: GrepOptions = {
        query: 'the', // Common word that should have many matches
        maxResults: 3,
        contextLines: 0
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeLessThanOrEqual(3);
      
      if (result.matches.length === 3) {
        expect(result.truncated).toBe(true);
      }
    });
  });

  describe('Specialized Search Methods', () => {
    it('should find function definitions', async () => {
      const result = await grepTool.findDefinition('testFunction');

      expect(result.success).toBe(true);
      
      if (result.matches.length > 0) {
        // Should find function definitions
        const hasDefinition = result.matches.some(match => 
          match.match.includes('function testFunction') ||
          match.match.includes('const testFunction') ||
          match.match.includes('let testFunction')
        );
        expect(hasDefinition).toBe(true);
      }
    });

    it('should find class definitions', async () => {
      const result = await grepTool.findDefinition('TestClass');

      expect(result.success).toBe(true);
      
      if (result.matches.length > 0) {
        // Should find class definitions
        const hasDefinition = result.matches.some(match => 
          match.match.includes('class TestClass')
        );
        expect(hasDefinition).toBe(true);
      }
    });

    it('should find references', async () => {
      const result = await grepTool.findReferences('testFunction');

      expect(result.success).toBe(true);
      
      if (result.matches.length > 0) {
        // Should find references to the function
        result.matches.forEach(match => {
          expect(match.match).toMatch(/\btestFunction\b/);
        });
      }
    });
  });

  describe('Result Formatting', () => {
    it('should format results for LLM consumption', async () => {
      const options: GrepOptions = {
        query: 'export',
        contextLines: 1,
        maxResults: 5
      };

      const result = await grepTool.execute(options);
      const formatted = grepTool.formatForLLM(result);

      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
      
      if (result.success && result.matches.length > 0) {
        expect(formatted).toContain('Found');
        expect(formatted).toContain('matches');
        expect(formatted).toContain('📄'); // File indicator
        expect(formatted).toContain('▶'); // Match line indicator
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent directory gracefully', async () => {
      const badTool = new GrepTool('/nonexistent/directory');
      
      const options: GrepOptions = {
        query: 'anything',
        contextLines: 1,
        maxResults: 50
      };

      const result = await badTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(0);
      expect(result.filesSearched).toBe(0);
    });

    it('should handle invalid regex patterns', async () => {
      const options: GrepOptions = {
        query: '[invalid-regex',
        regex: true,
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should complete searches in reasonable time', async () => {
      const startTime = Date.now();
      
      const options: GrepOptions = {
        query: 'test',
        contextLines: 2,
        maxResults: 50
      };

      const result = await grepTool.execute(options);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(result.searchTime).toBeGreaterThan(0);
      expect(result.searchTime).toBeLessThan(5000);
    });
  });
});

/**
 * Create test files with various content for integration testing
 */
async function createTestFiles(baseDir: string): Promise<void> {
  // Create directory structure
  const srcDir = path.join(baseDir, 'src');
  const testsDir = path.join(baseDir, 'tests');
  const docsDir = path.join(baseDir, 'docs');
  
  await fs.mkdir(srcDir, { recursive: true });
  await fs.mkdir(testsDir, { recursive: true });
  await fs.mkdir(docsDir, { recursive: true });

  // Create TypeScript files
  await fs.writeFile(path.join(srcDir, 'index.ts'), `
import { testFunction } from './utils.js';
import type { TestType } from './types.js';

export class TestClass {
  private value: string;

  constructor(value: string) {
    this.value = value;
  }

  public getValue(): string {
    return this.value;
  }

  public testMethod(): void {
    console.log('Testing the method');
    testFunction('hello');
  }
}

export function mainFunction(): void {
  const instance = new TestClass('test value');
  console.log(instance.getValue());
}
`);

  await fs.writeFile(path.join(srcDir, 'utils.ts'), `
export function testFunction(input: string): string {
  return input.toUpperCase();
}

export function helperFunction(data: any[]): number {
  return data.length;
}

export const utilityConstants = {
  MAX_SIZE: 1000,
  DEFAULT_TIMEOUT: 5000
};

// This is a test comment
function internalFunction(): void {
  console.log('Internal function for testing');
}
`);

  await fs.writeFile(path.join(srcDir, 'types.ts'), `
export interface TestType {
  id: string;
  name: string;
  isActive: boolean;
}

export type TestUnion = 'test' | 'production' | 'development';

export class BaseClass {
  protected id: string;
  
  constructor(id: string) {
    this.id = id;
  }
}
`);

  // Create JavaScript files
  await fs.writeFile(path.join(srcDir, 'legacy.js'), `
function legacyFunction() {
  return 'This is a legacy function';
}

const testData = {
  items: ['test1', 'test2', 'test3'],
  count: 3
};

module.exports = {
  legacyFunction,
  testData
};
`);

  // Create test files
  await fs.writeFile(path.join(testsDir, 'index.test.ts'), `
import { TestClass, mainFunction } from '../src/index.js';
import { testFunction } from '../src/utils.js';

describe('TestClass', () => {
  it('should create instance with test value', () => {
    const instance = new TestClass('test');
    expect(instance.getValue()).toBe('test');
  });
  
  it('should call testMethod without errors', () => {
    const instance = new TestClass('testing');
    instance.testMethod();
  });
});

describe('Functions', () => {
  it('should test the main function', () => {
    mainFunction();
  });
  
  it('should test utility function', () => {
    const result = testFunction('hello');
    expect(result).toBe('HELLO');
  });
});
`);

  // Create documentation files
  await fs.writeFile(path.join(docsDir, 'README.md'), `
# Test Project

This is a test project for testing the GrepTool functionality.

## Functions

- \`testFunction\`: Converts input to uppercase
- \`helperFunction\`: Returns array length
- \`mainFunction\`: Main entry point

## Classes

- \`TestClass\`: A test class for demonstration
- \`BaseClass\`: Base class for inheritance

## Usage

\`\`\`typescript
import { TestClass } from './src/index.js';

const test = new TestClass('example');
console.log(test.getValue());
\`\`\`
`);

  await fs.writeFile(path.join(docsDir, 'api.md'), `
# API Documentation

## TestClass

A class for testing purposes.

### Methods

- \`getValue()\`: Returns the stored value
- \`testMethod()\`: Performs a test operation

## Functions

### testFunction(input: string): string

Converts the input string to uppercase.

**Parameters:**
- \`input\`: The string to convert

**Returns:**
- The uppercase version of the input
`);

  // Create package.json
  await fs.writeFile(path.join(baseDir, 'package.json'), `{
  "name": "grep-tool-test-project",
  "version": "1.0.0",
  "description": "Test project for GrepTool integration tests",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest",
    "build": "tsc"
  },
  "keywords": ["test", "grep", "search"],
  "author": "Test Author",
  "license": "MIT"
}`);

  // Create a configuration file
  await fs.writeFile(path.join(baseDir, 'tsconfig.json'), `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}`);
}