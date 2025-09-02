/**
 * GrepTool Tests
 * 
 * Comprehensive test suite for the GrepTool to identify and fix issues
 * with text search functionality across the codebase.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GrepTool, GrepOptions, GrepResult } from '../grep-tool';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('glob');

describe('GrepTool', () => {
  let grepTool: GrepTool;
  let mockReadFile: any;
  let mockStat: any;
  let mockGlob: any;
  let testWorkingDir: string;

  beforeEach(() => {
    testWorkingDir = '/test/project';
    grepTool = new GrepTool(testWorkingDir);
    
    mockReadFile = vi.mocked(fs.readFile);
    mockStat = vi.mocked(fs.stat);
    mockGlob = vi.mocked(glob);
    
    // Reset mocks
    mockReadFile.mockClear();
    mockStat.mockClear();
    mockGlob.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should use process.cwd() when no working directory provided', () => {
      const tool = new GrepTool();
      expect(tool).toBeInstanceOf(GrepTool);
    });

    it('should set custom working directory', () => {
      const customDir = '/custom/path';
      const tool = new GrepTool(customDir);
      expect(tool).toBeInstanceOf(GrepTool);
    });
  });

  describe('Basic Search Functionality', () => {
    beforeEach(() => {
      // Setup default mocks for file operations
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue([
        '/test/project/src/file1.ts',
        '/test/project/src/file2.js',
        '/test/project/README.md'
      ]);
      
      mockReadFile.mockImplementation((filePath: string) => {
        const fileName = path.basename(filePath);
        if (fileName === 'file1.ts') {
          return Promise.resolve('function searchFunction(query: string) {\n  return query.toLowerCase();\n}\n\nconst result = searchFunction("TEST");');
        } else if (fileName === 'file2.js') {
          return Promise.resolve('// This is a search test file\nfunction search(term) {\n  console.log("Searching for:", term);\n}\nsearch("example");');
        } else if (fileName === 'README.md') {
          return Promise.resolve('# Project Search\n\nThis project includes search functionality.\nUse the search function to find items.');
        }
        return Promise.resolve('');
      });
    });

    it('should find simple text matches', async () => {
      const options: GrepOptions = {
        query: 'search',
        caseSensitive: false,
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.query).toBe('search');
      
      // Should find matches in multiple files
      const fileNames = result.matches.map(m => path.basename(m.file));
      expect(fileNames).toContain('file1.ts');
      expect(fileNames).toContain('file2.js');
      expect(fileNames).toContain('README.md');
    });

    it('should handle case sensitive search', async () => {
      const options: GrepOptions = {
        query: 'Search',
        caseSensitive: true,
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      // Should only find exact case matches
      const matchingLines = result.matches.map(m => m.match);
      matchingLines.forEach(line => {
        expect(line).toMatch(/Search/); // Capital S
      });
    });

    it('should handle case insensitive search', async () => {
      const options: GrepOptions = {
        query: 'SEARCH',
        caseSensitive: false,
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      // Should find matches regardless of case
    });

    it('should support regex patterns', async () => {
      const options: GrepOptions = {
        query: 'function\\s+\\w+\\(',
        regex: true,
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      
      // Should find function definitions
      const hasFunction = result.matches.some(m => 
        m.match.includes('function searchFunction') || 
        m.match.includes('function search')
      );
      expect(hasFunction).toBe(true);
    });

    it('should support whole word matching', async () => {
      const options: GrepOptions = {
        query: 'search',
        wholeWord: true,
        caseSensitive: false,
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      
      // Should only match whole words, not parts of words like "searchFunction"
      result.matches.forEach(match => {
        const queryRegex = /\bsearch\b/i;
        expect(match.match).toMatch(queryRegex);
      });
    });
  });

  describe('File Filtering', () => {
    beforeEach(() => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
    });

    it('should respect include patterns', async () => {
      mockGlob
        .mockResolvedValueOnce(['/test/project/src/file1.ts', '/test/project/src/file2.ts'])
        .mockResolvedValueOnce([]);

      const options: GrepOptions = {
        query: 'function',
        includePatterns: ['**/*.ts'],
        contextLines: 1,
        maxResults: 50
      };

      await grepTool.execute(options);

      expect(mockGlob).toHaveBeenCalledWith(
        expect.stringContaining('**/*.ts'),
        expect.objectContaining({
          ignore: expect.any(Array),
          nodir: true,
          absolute: true
        })
      );
    });

    it('should respect exclude patterns', async () => {
      mockGlob.mockResolvedValue(['/test/project/src/file1.ts']);

      const options: GrepOptions = {
        query: 'function',
        excludePatterns: ['**/node_modules/**', '**/dist/**'],
        contextLines: 1,
        maxResults: 50
      };

      await grepTool.execute(options);

      expect(mockGlob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          ignore: expect.arrayContaining(['**/node_modules/**', '**/dist/**'])
        })
      );
    });

    it('should search specific file paths when provided', async () => {
      const specificFile = '/test/project/src/specific.ts';
      
      mockStat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false
      });
      
      mockReadFile.mockResolvedValue('function specificFunction() {}');

      const options: GrepOptions = {
        query: 'function',
        paths: ['src/specific.ts'],
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(mockStat).toHaveBeenCalledWith(specificFile);
    });

    it('should handle non-existent paths gracefully', async () => {
      mockStat.mockRejectedValue(new Error('File not found'));

      const options: GrepOptions = {
        query: 'function',
        paths: ['nonexistent/file.ts'],
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(0);
      expect(result.filesSearched).toBe(0);
    });
  });

  describe('Context and Limits', () => {
    beforeEach(() => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue(['/test/project/src/context.ts']);
      
      mockReadFile.mockResolvedValue(
        'line 1\n' +
        'line 2\n' +
        'line 3 with search term\n' +
        'line 4\n' +
        'line 5\n' +
        'line 6 with another search term\n' +
        'line 7\n' +
        'line 8\n'
      );
    });

    it('should include correct context lines', async () => {
      const options: GrepOptions = {
        query: 'search term',
        contextLines: 2,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBe(2);

      const firstMatch = result.matches[0];
      expect(firstMatch.context.before).toHaveLength(2);
      expect(firstMatch.context.after).toHaveLength(2);
      expect(firstMatch.context.before).toEqual(['line 1', 'line 2']);
      expect(firstMatch.context.after).toEqual(['line 4', 'line 5']);
    });

    it('should respect maxResults limit', async () => {
      // Mock many files with matches
      mockGlob.mockResolvedValue([
        '/test/project/file1.ts',
        '/test/project/file2.ts',
        '/test/project/file3.ts'
      ]);
      
      mockReadFile.mockImplementation(() => 
        Promise.resolve('search\nsearch\nsearch\nsearch\nsearch')
      );

      const options: GrepOptions = {
        query: 'search',
        maxResults: 3,
        contextLines: 0
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeLessThanOrEqual(3);
      expect(result.truncated).toBe(true);
    });

    it('should respect maxFilesSearched limit', async () => {
      // Mock many files
      const files = Array.from({ length: 10 }, (_, i) => `/test/project/file${i}.ts`);
      mockGlob.mockResolvedValue(files);
      
      mockReadFile.mockImplementation(() => 
        Promise.resolve('some content with search term')
      );

      const options: GrepOptions = {
        query: 'search',
        maxFilesSearched: 3,
        maxResults: 100
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.filesSearched).toBeLessThanOrEqual(3);
      expect(result.truncated).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle file reading errors gracefully', async () => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue(['/test/project/src/error.ts']);
      
      // Mock file reading to throw an error
      mockReadFile.mockRejectedValue(new Error('Permission denied'));

      const options: GrepOptions = {
        query: 'search',
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(0);
      expect(result.filesSearched).toBe(1);
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

    it('should handle glob errors', async () => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockRejectedValue(new Error('Glob error'));

      const options: GrepOptions = {
        query: 'search',
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Specialized Search Methods', () => {
    beforeEach(() => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue(['/test/project/src/definitions.ts']);
    });

    it('should find function definitions', async () => {
      mockReadFile.mockResolvedValue(
        'export function myFunction(param: string) {\n' +
        '  return param.toUpperCase();\n' +
        '}\n\n' +
        'const myFunction = (param: string) => {\n' +
        '  return param.toLowerCase();\n' +
        '}\n'
      );

      const result = await grepTool.findDefinition('myFunction');

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      
      // Should find function definition patterns
      const hasDefinition = result.matches.some(m => 
        m.match.includes('function myFunction') || 
        m.match.includes('const myFunction')
      );
      expect(hasDefinition).toBe(true);
    });

    it('should find class definitions', async () => {
      mockReadFile.mockResolvedValue(
        'export class MyClass {\n' +
        '  constructor() {}\n' +
        '}\n\n' +
        'class MyClass extends BaseClass {\n' +
        '  method() {}\n' +
        '}\n'
      );

      const result = await grepTool.findDefinition('MyClass');

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      
      // Should find class definition patterns
      const hasClassDefinition = result.matches.some(m => 
        m.match.includes('class MyClass')
      );
      expect(hasClassDefinition).toBe(true);
    });

    it('should find references', async () => {
      mockReadFile.mockResolvedValue(
        'import { myFunction } from "./utils";\n' +
        'const result = myFunction("test");\n' +
        'console.log("Using myFunction:", myFunction);\n' +
        'anotherFunction(myFunction);\n'
      );

      const result = await grepTool.findReferences('myFunction');

      expect(result.success).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      
      // Should find all references to the symbol
      expect(result.matches.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Result Formatting', () => {
    it('should format successful results for LLM consumption', () => {
      const result: GrepResult = {
        success: true,
        query: 'search',
        matches: [
          {
            file: 'src/test.ts',
            line: 3,
            column: 10,
            match: 'function search(term) {',
            context: {
              before: ['// Test file', 'import { utils } from "./utils";'],
              after: ['  return utils.find(term);', '}']
            }
          }
        ],
        totalMatches: 1,
        filesSearched: 1,
        truncated: false,
        searchTime: 150
      };

      const formatted = grepTool.formatForLLM(result);

      expect(formatted).toContain('Found 1 matches in 1 files');
      expect(formatted).toContain('📄 src/test.ts');
      expect(formatted).toContain('▶    3 │ function search(term) {');
      expect(formatted).toContain('// Test file');
      expect(formatted).toContain('return utils.find(term);');
    });

    it('should format failed results', () => {
      const result: GrepResult = {
        success: false,
        query: 'search',
        matches: [],
        totalMatches: 0,
        filesSearched: 0,
        truncated: false,
        error: 'Invalid regex pattern',
        searchTime: 50
      };

      const formatted = grepTool.formatForLLM(result);

      expect(formatted).toContain('Search failed: Invalid regex pattern');
    });

    it('should format no matches result', () => {
      const result: GrepResult = {
        success: true,
        query: 'nonexistent',
        matches: [],
        totalMatches: 0,
        filesSearched: 5,
        truncated: false,
        searchTime: 100
      };

      const formatted = grepTool.formatForLLM(result);

      expect(formatted).toContain('No matches found for "nonexistent"');
    });

    it('should indicate truncated results', () => {
      const result: GrepResult = {
        success: true,
        query: 'search',
        matches: [
          {
            file: 'src/test.ts',
            line: 1,
            column: 1,
            match: 'search result',
            context: { before: [], after: [] }
          }
        ],
        totalMatches: 100,
        filesSearched: 10,
        truncated: true,
        searchTime: 200
      };

      const formatted = grepTool.formatForLLM(result);

      expect(formatted).toContain('⚠️ Results truncated');
    });
  });

  describe('Caching', () => {
    beforeEach(() => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue(['/test/project/src/cached.ts']);
    });

    it('should cache file contents', async () => {
      const fileContent = 'function cached() { return "cached"; }';
      mockReadFile.mockResolvedValue(fileContent);

      const options: GrepOptions = {
        query: 'cached',
        contextLines: 1,
        maxResults: 50
      };

      // First call
      await grepTool.execute(options);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await grepTool.execute(options);
      expect(mockReadFile).toHaveBeenCalledTimes(1); // No additional call
    });

    it('should respect cache expiry', async () => {
      const fileContent = 'function expired() { return "expired"; }';
      mockReadFile.mockResolvedValue(fileContent);

      // Create tool with short cache time for testing
      const shortCacheTool = new GrepTool(testWorkingDir);
      (shortCacheTool as any).cacheMaxAge = 1; // 1ms

      const options: GrepOptions = {
        query: 'expired',
        contextLines: 1,
        maxResults: 50
      };

      // First call
      await shortCacheTool.execute(options);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second call should read file again
      await shortCacheTool.execute(options);
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle empty files', async () => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue(['/test/project/empty.ts']);
      mockReadFile.mockResolvedValue('');

      const options: GrepOptions = {
        query: 'anything',
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(0);
      expect(result.filesSearched).toBe(1);
    });

    it('should handle files with only whitespace', async () => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue(['/test/project/whitespace.ts']);
      mockReadFile.mockResolvedValue('   \n\n  \t  \n   ');

      const options: GrepOptions = {
        query: 'anything',
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(0);
      expect(result.filesSearched).toBe(1);
    });

    it('should handle very long lines', async () => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue(['/test/project/longlines.ts']);
      
      const longLine = 'x'.repeat(10000) + ' search term ' + 'y'.repeat(10000);
      mockReadFile.mockResolvedValue(`normal line\n${longLine}\nanother normal line`);

      const options: GrepOptions = {
        query: 'search term',
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBe(1);
      expect(result.matches[0].match).toContain('search term');
    });

    it('should measure search time accurately', async () => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue(['/test/project/timed.ts']);
      
      // Add delay to file reading
      mockReadFile.mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve('search content'), 50)
        )
      );

      const options: GrepOptions = {
        query: 'search',
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.searchTime).toBeGreaterThan(40); // Should be at least 40ms due to delay
    });
  });

  describe('Pattern Escaping', () => {
    beforeEach(() => {
      mockStat.mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true
      });
      
      mockGlob.mockResolvedValue(['/test/project/src/special.ts']);
    });

    it('should escape special regex characters in non-regex mode', async () => {
      mockReadFile.mockResolvedValue(
        'const pattern = /[.*+?^${}()|[\\]\\\\]/g;\n' +
        'const literal = "[.*+?^${}()|[\\]\\\\]";\n' +
        'console.log("Special chars: [.*+?^${}()|[\\]\\\\]");'
      );

      const options: GrepOptions = {
        query: '[.*+?^${}()|[\\]\\\\]', // Special regex characters
        regex: false, // Should be escaped
        contextLines: 1,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      // Should find literal matches, not treat as regex
      expect(result.matches.length).toBeGreaterThan(0);
    });

    it('should not escape characters in regex mode', async () => {
      mockReadFile.mockResolvedValue(
        'const test1 = "abc";\n' +
        'const test2 = "def";\n' +
        'const test3 = "xyz";'
      );

      const options: GrepOptions = {
        query: 'test[12]', // Should match test1 and test2
        regex: true,
        contextLines: 0,
        maxResults: 50
      };

      const result = await grepTool.execute(options);

      expect(result.success).toBe(true);
      expect(result.matches.length).toBe(2); // Should match test1 and test2, not test3
    });
  });
});