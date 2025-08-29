import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import { logger } from '../logging/index.js';
import { toolGrepEvents } from '../logging/events/index.js';

// Types and Schemas
export const GrepOptionsSchema = z.object({
  query: z.string().describe('Text or regex pattern to search for'),

  // Search scope
  paths: z.array(z.string()).optional()
    .describe('Specific files or directories to search in. If not provided, searches entire project'),

  // Search options
  regex: z.boolean().optional().default(false)
    .describe('Treat query as a regular expression'),
  caseSensitive: z.boolean().optional().default(false)
    .describe('Case-sensitive search'),
  wholeWord: z.boolean().optional().default(false)
    .describe('Match whole words only'),

  // Context options
  contextLines: z.number().optional().default(3)
    .describe('Number of lines to show before and after each match'),
  maxResults: z.number().optional().default(50)
    .describe('Maximum number of results to return'),
  maxFilesSearched: z.number().optional().default(1000)
    .describe('Maximum number of files to search through'),

  // Filtering
  includePatterns: z.array(z.string()).optional()
    .default(['**/*.{ts,tsx,js,jsx,py,java,cpp,c,go,rs,rb,php,swift,kt,scala,r,m,html,css,scss,json,yaml,yml,toml,xml,md,txt}'])
    .describe('Glob patterns for files to include'),
  excludePatterns: z.array(z.string()).optional()
    .default(['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**', '**/*.min.js', '**/vendor/**', '**/.next/**', '**/.cache/**'])
    .describe('Glob patterns for files to exclude'),

  // Output options
  includeLineNumbers: z.boolean().optional().default(true)
    .describe('Include line numbers in results'),
  includePath: z.boolean().optional().default(true)
    .describe('Include file paths in results'),
  groupByFile: z.boolean().optional().default(true)
    .describe('Group results by file'),

  // Special modes
  findDefinition: z.boolean().optional().default(false)
    .describe('Try to find function/class/variable definitions'),
  findReferences: z.boolean().optional().default(false)
    .describe('Try to find all references/usages')
});

export type GrepOptions = z.infer<typeof GrepOptionsSchema>;

export interface Match {
  file: string;
  line: number;
  column: number;
  match: string;
  context: {
    before: string[];
    after: string[];
  };
}

export interface GrepResult {
  success: boolean;
  query: string;
  matches: Match[];
  totalMatches: number;
  filesSearched: number;
  truncated: boolean;
  error?: string;
  searchTime: number;
}

export class GrepTool {
  private workingDirectory: string;
  private cache: Map<string, { content: string[]; timestamp: number }> = new Map();
  private cacheMaxAge = 5000; // 5 seconds

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
  }

  async execute(params: GrepOptions): Promise<GrepResult> {
    const startTime = Date.now();

    // Log search begin
    toolGrepEvents.begin(logger, {
      toolName: 'grep',
      query: params.query,
      ...(params.paths && { paths: params.paths }),
      searchOptions: {
        regex: params.regex || false,
        caseSensitive: params.caseSensitive || false,
        wholeWord: params.wholeWord || false,
        contextLines: params.contextLines || 3,
        maxResults: params.maxResults || 50,
        maxFilesSearched: params.maxFilesSearched || 1000,
      },
    });

    try {
      // Parse and validate options with defaults
      const options = GrepOptionsSchema.parse(params);

      // Build search pattern
      const searchPattern = this.buildSearchPattern(options);

      // Get files to search
      const filesToSearch = await this.getFilesToSearch(options);

      if (filesToSearch.length === 0) {
        return {
          success: true,
          query: options.query,
          matches: [],
          totalMatches: 0,
          filesSearched: 0,
          truncated: false,
          searchTime: Date.now() - startTime
        };
      }

      // Search through files
      const allMatches: Match[] = [];
      let filesSearched = 0;
      let truncated = false;

      for (const file of filesToSearch) {
        if (filesSearched >= options.maxFilesSearched) {
          truncated = true;
          break;
        }

        const fileMatches = await this.searchFile(file, searchPattern, options);
        allMatches.push(...fileMatches);
        filesSearched++;

        if (allMatches.length >= options.maxResults) {
          truncated = true;
          allMatches.splice(options.maxResults);
          break;
        }
      }

      // Group by file if requested
      const finalMatches = options.groupByFile
        ? this.groupMatchesByFile(allMatches)
        : allMatches;

      const result = {
        success: true,
        query: options.query,
        matches: finalMatches,
        totalMatches: allMatches.length,
        filesSearched,
        truncated,
        searchTime: Date.now() - startTime
      };

      // Log search success
      toolGrepEvents.success(logger, {
        toolName: 'grep',
        query: options.query,
        ...(options.paths && { paths: options.paths }),
        searchOptions: {
          regex: options.regex,
          caseSensitive: options.caseSensitive,
          wholeWord: options.wholeWord,
          contextLines: options.contextLines,
          maxResults: options.maxResults,
          maxFilesSearched: options.maxFilesSearched,
        },
        resultStats: {
          totalMatches: allMatches.length,
          filesSearched,
          truncated,
          searchTime: result.searchTime,
        },
      });

      return result;

    } catch (error) {
      // Log search failure
      toolGrepEvents.failure(logger, error as Error, {
        toolName: 'grep',
        query: params.query,
      });

      return {
        success: false,
        query: params.query,
        matches: [],
        totalMatches: 0,
        filesSearched: 0,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
        searchTime: Date.now() - startTime
      };
    }
  }

  private buildSearchPattern(options: GrepOptions): RegExp {
    let pattern: string;

    if (options.regex) {
      pattern = options.query;
    } else {
      // Escape special regex characters
      pattern = options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      if (options.wholeWord) {
        pattern = `\\b${pattern}\\b`;
      }
    }

    const flags = options.caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  }

  private async getFilesToSearch(options: GrepOptions): Promise<string[]> {
    let searchPaths: string[];

    if (options.paths && options.paths.length > 0) {
      // Specific paths provided
      searchPaths = options.paths.map(p =>
        path.isAbsolute(p) ? p : path.join(this.workingDirectory, p)
      );
    } else {
      // Search entire project
      searchPaths = [this.workingDirectory];
    }

    const allFiles: Set<string> = new Set();

    for (const searchPath of searchPaths) {
      const stat = await fs.stat(searchPath).catch(() => null);

      if (!stat) continue;

      if (stat.isFile()) {
        allFiles.add(searchPath);
      } else if (stat.isDirectory()) {
        // Find all matching files in directory
        for (const includePattern of options.includePatterns) {
          const pattern = path.join(searchPath, includePattern);
          const files = await glob(pattern, {
            ignore: options.excludePatterns,
            nodir: true,
            absolute: true
          });

          files.forEach(f => allFiles.add(f));
        }
      }
    }

    // Filter out excluded patterns
    const filteredFiles = Array.from(allFiles).filter(file => {
      const relativePath = path.relative(this.workingDirectory, file);

      // Check if file should be excluded
      for (const excludePattern of options.excludePatterns) {
        if (minimatch(relativePath, excludePattern)) {
          return false;
        }
      }

      return true;
    });

    return filteredFiles;
  }

  private async searchFile(
    filePath: string,
    pattern: RegExp,
    options: GrepOptions
  ): Promise<Match[]> {
    try {
      const lines = await this.getFileLines(filePath);
      const matches: Match[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue; // Skip undefined lines

        const lineNumber = i + 1;

        // Reset regex state for global flag
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(line)) !== null) {
          // Get context lines
          const contextBefore: string[] = [];
          const contextAfter: string[] = [];

          // Before context
          for (let j = Math.max(0, i - options.contextLines); j < i; j++) {
            const contextLine = lines[j];
            if (contextLine !== undefined) {
              contextBefore.push(contextLine);
            }
          }

          // After context
          for (let j = i + 1; j < Math.min(lines.length, i + 1 + options.contextLines); j++) {
            const contextLine = lines[j];
            if (contextLine !== undefined) {
              contextAfter.push(contextLine);
            }
          }

          matches.push({
            file: path.relative(this.workingDirectory, filePath),
            line: lineNumber,
            column: match.index + 1,
            match: line,
            context: {
              before: contextBefore,
              after: contextAfter
            }
          });

          // Prevent infinite loop for zero-width matches
          if (match.index === pattern.lastIndex) {
            pattern.lastIndex++;
          }

          // For non-global searches, break after first match
          if (!pattern.global) {
            break;
          }
        }
      }

      return matches;
    } catch (error) {
      // Silently skip files that can't be read (binary files, permission issues, etc.)
      return [];
    }
  }

  private async getFileLines(filePath: string): Promise<string[]> {
    // Check cache
    const cached = this.cache.get(filePath);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return cached.content;
    }

    // Read file
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Update cache
    this.cache.set(filePath, {
      content: lines,
      timestamp: Date.now()
    });

    // Clean old cache entries
    if (this.cache.size > 100) {
      const cutoff = Date.now() - this.cacheMaxAge;
      for (const [key, value] of this.cache.entries()) {
        if (value.timestamp < cutoff) {
          this.cache.delete(key);
        }
      }
    }

    return lines;
  }

  private groupMatchesByFile(matches: Match[]): Match[] {
    // Already grouped by maintaining order, but we could enhance this
    // to better organize results by file
    return matches;
  }

  // Specialized search methods

  async findDefinition(symbolName: string, fileTypes?: string[]): Promise<GrepResult> {
    // Language-specific patterns for finding definitions
    const patterns = [
      `function\\s+${symbolName}\\s*\\(`,     // JavaScript/TypeScript functions
      `const\\s+${symbolName}\\s*=`,          // const definitions
      `let\\s+${symbolName}\\s*=`,            // let definitions
      `var\\s+${symbolName}\\s*=`,            // var definitions
      `class\\s+${symbolName}\\s*[{<]`,       // Class definitions
      `interface\\s+${symbolName}\\s*[{<]`,   // TypeScript interfaces
      `type\\s+${symbolName}\\s*=`,           // TypeScript type aliases
      `def\\s+${symbolName}\\s*\\(`,          // Python functions
      `class\\s+${symbolName}\\s*[(:]`,       // Python classes
      `public\\s+.*\\s+${symbolName}\\s*\\(`, // Java/C# methods
    ];

    const combinedPattern = patterns.join('|');

    const options: Partial<GrepOptions> & { query: string } = {
      query: combinedPattern,
      regex: true,
      contextLines: 5,
      maxResults: 10
    };

    if (fileTypes) {
      options.includePatterns = fileTypes;
    }

    return this.execute(options as GrepOptions);
  }

  async findReferences(symbolName: string, fileTypes?: string[]): Promise<GrepResult> {
    // Simple reference search - can be enhanced with language-specific logic
    const options: Partial<GrepOptions> & { query: string } = {
      query: symbolName,
      wholeWord: true,
      contextLines: 2,
      maxResults: 100
    };

    if (fileTypes) {
      options.includePatterns = fileTypes;
    }

    return this.execute(options as GrepOptions);
  }

  // Format results for LLM consumption
  formatForLLM(result: GrepResult): string {
    if (!result.success) {
      return `Search failed: ${result.error}`;
    }

    if (result.matches.length === 0) {
      return `No matches found for "${result.query}"`;
    }

    let output = `Found ${result.totalMatches} matches in ${result.filesSearched} files:\n\n`;

    let currentFile = '';
    for (const match of result.matches) {
      if (match.file !== currentFile) {
        currentFile = match.file;
        output += `\n📄 ${match.file}\n${'─'.repeat(match.file.length + 3)}\n`;
      }

      // Show context before
      if (match.context.before.length > 0) {
        match.context.before.forEach((line, i) => {
          const lineNum = match.line - match.context.before.length + i;
          output += `  ${lineNum.toString().padStart(4)} │ ${line}\n`;
        });
      }

      // Show matching line (highlighted)
      output += `▶ ${match.line.toString().padStart(4)} │ ${match.match}\n`;

      // Show context after
      if (match.context.after.length > 0) {
        match.context.after.forEach((line, i) => {
          const lineNum = match.line + i + 1;
          output += `  ${lineNum.toString().padStart(4)} │ ${line}\n`;
        });
      }

      output += '\n';
    }

    if (result.truncated) {
      output += `\n⚠️ Results truncated. Showing first ${result.matches.length} matches.`;
    }

    return output;
  }
}
