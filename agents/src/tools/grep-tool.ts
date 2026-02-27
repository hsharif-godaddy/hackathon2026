import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { glob } from 'glob';
import { minimatch } from 'minimatch';

import { createDevSupervisorClientForApp } from '../utils/dev-supervisor-client-factory.js';
import { logger } from '../logging/index.js';
import { deriveAssetsDir, validateNoEscapingSymlinks } from '../utils/path-helper.js';
import { RipgrepUtil } from '../utils/ripgrep-util.js';
import { toolCodeSearchEvents, toolGrepEvents } from '../logging/events/index.js';

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
  private appId?: string;
  private cache: Map<string, { content: string[]; timestamp: number }> = new Map();
  private cacheMaxAge = 5000; // 5 seconds

  constructor(workingDirectory: string = process.cwd(), appId?: string) {
    this.workingDirectory = workingDirectory;
    if (appId !== undefined) {
      this.appId = appId;
    }
  }

  /**
   * Validate that a file path is within the working directory.
   * Allows symlinks to the known assets directory for bind mount compatibility.
   */
  private isPathSafe(filePath: string): boolean {
    try {
      const resolved = path.resolve(filePath);

      const rel = path.relative(this.workingDirectory, resolved);
      if (rel.startsWith('..')) {
        return false;
      }

      const assetsDir = deriveAssetsDir(this.workingDirectory);
      validateNoEscapingSymlinks(resolved, this.workingDirectory, assetsDir ? [assetsDir] : []);

      return true;
    } catch (error) {
      return false;
    }
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
      // Try ripgrep first (primary choice, fastest)
      if (this.appId && !params.findDefinition && !params.findReferences && !params.wholeWord) {
        const ripgrepResult = await this.searchWithRipgrep(params, startTime);
        if (ripgrepResult) {
          return ripgrepResult;
        }
      }

      // Fall back to Node.js search (always works)
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

  /**
   * Search using ripgrep (primary/fastest method)
   * Returns null if ripgrep unavailable or fails (triggers Node.js fallback)
   */
  private async searchWithRipgrep(params: GrepOptions, startTime: number): Promise<GrepResult | null> {
    try {
      const supervisor = createDevSupervisorClientForApp(this.appId!);
      if (!supervisor) {
        toolCodeSearchEvents.fallback(logger, {
          toolName: 'grep',
          message: 'Dev-supervisor not available, using Node.js fallback'
        });
        return null;
      }

      const hasRipgrep = await RipgrepUtil.isAvailable(supervisor);
      if (!hasRipgrep) {
        toolCodeSearchEvents.fallback(logger, {
          toolName: 'grep',
          message: 'Ripgrep not installed in container, using Node.js fallback'
        });
        return null;
      }

      const ripgrepOptions = {
        caseSensitive: params.caseSensitive,
        regex: params.regex,
        maxResults: params.maxResults,
        contextLines: params.contextLines
      };

      const ripgrepResult = await RipgrepUtil.search(
        supervisor,
        this.workingDirectory,
        params.query,
        ripgrepOptions,
        (filePath: string) => this.isPathSafe(path.join(this.workingDirectory, filePath))
      );

      if (ripgrepResult.error) {
        return null;
      }

      const matches: Match[] = ripgrepResult.matches.map(m => ({
        file: m.path,
        line: m.line,
        column: m.column,
        match: m.text,
        context: {
          before: [],
          after: []
        }
      }));

      const result = {
        success: true,
        query: params.query,
        matches,
        totalMatches: ripgrepResult.totalMatches,
        filesSearched: ripgrepResult.matches.length,
        truncated: ripgrepResult.truncated,
        searchTime: Date.now() - startTime
      };

      toolGrepEvents.success(logger, {
        toolName: 'grep',
        query: params.query,
        ...(params.paths && { paths: params.paths }),
        searchOptions: {
          regex: params.regex || false,
          caseSensitive: params.caseSensitive || false,
          wholeWord: false,
          contextLines: params.contextLines || 3,
          maxResults: params.maxResults || 50,
          maxFilesSearched: params.maxFilesSearched || 1000,
        },
        resultStats: {
          totalMatches: ripgrepResult.totalMatches,
          filesSearched: ripgrepResult.matches.length,
          truncated: ripgrepResult.truncated,
          searchTime: result.searchTime,
        },
      });

      return result;
    } catch (error) {
      logger.warn('grep.ripgrep.fallback', {
        error: error instanceof Error ? error.message : String(error),
        message: 'Ripgrep search failed, falling back to Node.js'
      });
      return null;
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
      // Specific paths provided - validate each one
      searchPaths = [];
      for (const p of options.paths) {
        const resolved = path.isAbsolute(p) ? p : path.join(this.workingDirectory, p);
        
        // Security check: ensure path is within working directory
        if (this.isPathSafe(resolved)) {
          searchPaths.push(resolved);
        } else {
          logger.warn('grep-tool.path-rejected', {
            path: p,
            resolved,
            workingDirectory: this.workingDirectory,
            reason: 'Path is outside working directory or contains unsafe symlinks'
          });
        }
      }
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
        // Use glob patterns directly with cwd set to searchPath
        // This is more reliable than path.join which can break glob patterns
        for (const includePattern of options.includePatterns) {
          const files = await glob(includePattern, {
            ignore: options.excludePatterns,
            nodir: true,
            absolute: true,
            cwd: searchPath  // Set cwd so patterns resolve relative to searchPath
          });

          // Validate each file from glob results
          files.forEach(f => {
            if (this.isPathSafe(f)) {
              allFiles.add(f);
            }
          });
        }
      }
    }

    // Filter out excluded patterns and validate safety
    const filteredFiles = Array.from(allFiles).filter(file => {
      const relativePath = path.relative(this.workingDirectory, file);

      // Check if file should be excluded
      for (const excludePattern of options.excludePatterns) {
        if (minimatch(relativePath, excludePattern)) {
          return false;
        }
      }

      // Final safety check
      return this.isPathSafe(file);
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
