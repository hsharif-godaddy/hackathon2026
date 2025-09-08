import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join, resolve, relative } from 'path';
import { diffLines, createPatch } from 'diff';
import { existsSync } from 'fs';
import { TokenUsageRepository, AppRepository } from '../database/index.js';
import { GitTool } from './git-tool.js';
import { exec } from 'child_process';
import axios from 'axios';
import { translateDockerPath } from '../utils/path-helper.js';
import { logger } from '../logging/index.js';
import { toolFileEditEvents, toolBuildEvents, toolServerHealthEvents } from '../logging/events/index.js';
import { ServerManagementTool } from './server-management-tool.js';

export interface FileEditOptions {
  /** Path to the file to edit (relative to app root) */
  path: string;
  /** Edit mode: edit for partial changes, rewrite for full replacement, create for new files */
  mode?: 'edit' | 'rewrite' | 'create';
  /** Array of search-and-replace operations for partial edits */
  edits?: Array<{
    old: string;
    new: string;
  }>;
  /** Full content for rewrite or create operations */
  content?: string;
  /** Create parent directories if they don't exist */
  createDirs?: boolean;

  /** Preview changes without applying them */
  dryRun?: boolean;
  /** Use fuzzy matching for search text if exact match fails */
  fuzzyMatch?: boolean;
  /** Automatically commit changes using git */
  autoCommit?: boolean;
  /** Custom commit message for auto-commit (if not provided, a default message will be generated) */
  commitMessage?: string;
  /** Automatically run build after changes */
  autoBuild?: boolean;
}

export interface FileEditResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path that was edited */
  path: string;
  /** Edit mode that was used */
  mode: 'create' | 'edit' | 'rewrite';
  /** Diff showing changes made */
  diff?: string;

  /** Summary of changes */
  changes?: {
    additions: number;
    deletions: number;
    totalLines: number;
  };
  /** Error message if operation failed */
  error?: string;
  /** Warning message */
  warning?: string;
}

/**
 * File Edit Tool
 * Provides comprehensive file editing capabilities with safety features
 */
export class FileEditTool {
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
  private tokenUsageRepo: TokenUsageRepository;
  private appRepo: AppRepository;

  constructor() {
    this.tokenUsageRepo = new TokenUsageRepository();
    this.appRepo = new AppRepository();
  }
  private gitTool = new GitTool();
  
  /**
   * Run safe build validation after file changes without breaking dev server
   */
  private async runBuildCommand(appPath: string, appId?: string): Promise<void> {
    try {
      toolBuildEvents.begin(logger, {
        toolName: 'FileEditTool',
        appPath,
        ...(appId && { appId }),
      });
      
      // Detect which build strategy to use based on the template
      const buildCommand = await this.getSafeBuildCommand(appPath);
      
      return new Promise<void>((resolve) => {
        exec(buildCommand, { cwd: appPath }, (error, _stdout, _stderr) => {
          if (error) {
            toolBuildEvents.failure(logger, error, {
              toolName: 'FileEditTool',
              appPath,
              buildCommand,
              ...(appId && { appId }),
            });
            // Don't reject as we don't want to fail the file edit operation
            // just because the validation failed
            resolve();
            return;
          }
          
          toolBuildEvents.success(logger, {
            toolName: 'FileEditTool',
            appPath,
            buildCommand,
            buildType: 'validation',
            ...(appId && { appId }),
          });
          
          // After successful validation, ensure dev server is still healthy
          if (appId) {
            // Use a separate async function to handle the health check
            this.ensureDevServerHealth(appId).finally(() => resolve());
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      toolBuildEvents.failure(logger, error as Error, {
        toolName: 'FileEditTool',
        appPath,
        ...(appId && { appId }),
      });
      // Don't throw as we don't want to fail the file edit operation
      // just because the validation failed
    }
  }

  /**
   * Ensure the development server is healthy after file changes
   */
  private async ensureDevServerHealth(appId: string): Promise<void> {
    try {
      // Give the server a moment to process any changes
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const app = this.appRepo.findById(appId);
      if (!app) {
        logger.warn('App not found for health check', {
          appId,
          toolName: 'FileEditTool',
        });
        return;
      }

      // Check if server is responding
      const isHealthy = await this.checkServerHealth(app.port);
      
      if (!isHealthy) {
        toolServerHealthEvents.unhealthy(logger, {
          toolName: 'FileEditTool',
          appId,
          port: app.port,
          isHealthy: false,
        });
        try {
          // Use the server management tool for consistent restart behavior
          const serverTool = new ServerManagementTool();
          const restartResult = await serverTool.restartServer({ reason: 'File edit triggered restart' }, appId);
          
          if (restartResult.success) {
            toolServerHealthEvents.restart(logger, {
              toolName: 'FileEditTool',
              appId,
              port: app.port,
              isHealthy: true,
            });
          }
        } catch (restartError) {
          logger.error('Failed to restart dev server', {
            appId,
            port: app.port,
            error: restartError instanceof Error ? restartError.message : String(restartError),
          });
        }
      } else {
        toolServerHealthEvents.healthy(logger, {
          toolName: 'FileEditTool',
          appId,
          port: app.port,
          isHealthy: true,
        });
      }
    } catch (error) {
      logger.error('Error checking dev server health', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if a development server is responding on the given port
   */
  private async checkServerHealth(port: number): Promise<boolean> {
    try {
      await axios.get(`http://localhost:${port}`, {
        timeout: 3000,
        validateStatus: (status) => status < 500, // Accept any non-server-error response
      });
      
      return true; // Server is responding
    } catch (error) {
      // Check if it's a timeout or connection error vs an HTTP error
      if (axios.isAxiosError(error) && error.response && error.response.status < 500) {
        return true; // Server is responding, even if with an error page
      }
      return false; // Server not responding or internal server error
    }
  }

  /**
   * Determine the appropriate safe build command based on template type
   */
  private async getSafeBuildCommand(appPath: string): Promise<string> {
    // Check if safe build script exists
    const checkBuildScript = join(appPath, 'check-build.sh');
    if (existsSync(checkBuildScript)) {
      return './check-build.sh';
    }

    // Check package.json to determine template type
    try {
      const packageJsonPath = join(appPath, 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
        const buildScript = packageJson.scripts?.build;
        
        // V1 template: build = "npm run check" (safe)
        if (buildScript === 'npm run check') {
          return 'npm run build';
        }
        
        // V2/V3 templates: production builds (unsafe), use type-check + lint instead
        if (buildScript === 'next build' || buildScript === 'vite build') {
          return 'npx tsc --noEmit && npm run lint';
        }
      }
    } catch (error) {
      logger.warn('Could not parse package.json, using default safe command', {
        appPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Default safe command: just type check and lint
    return 'npx tsc --noEmit';
  }
  
  /**
   * Execute a file edit operation
   */
  async editFile(appPath: string, options: FileEditOptions, context?: { appId?: string; conversationId?: string }): Promise<FileEditResult> {
    try {
      // Resolve the file path within the app directory
      const filePath = this.resolveFilePath(appPath, options.path);
      
      // Auto-detect mode if not specified
      const mode = options.mode || await this.detectMode(filePath, options);
      
      // Log the beginning of the file edit operation
      toolFileEditEvents.begin(logger, {
        toolName: 'FileEditTool',
        filePath: options.path,
        mode,
        ...(context?.appId && { appId: context.appId }),
        ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
      });
      
      let result: FileEditResult;
      
      // Route to appropriate handler
      switch (mode) {
        case 'create':
          result = await this.handleCreate(filePath, options, appPath, context);
          break;
        case 'rewrite':
          result = await this.handleRewrite(filePath, options, appPath, context);
          break;
        case 'edit':
          result = await this.handleEdit(filePath, options, appPath, context);
          break;
        default:
          throw new Error(`Unknown edit mode: ${mode}`);
      }
      
      // Log success or failure
      if (result.success) {
        toolFileEditEvents.success(logger, {
          toolName: 'FileEditTool',
          filePath: options.path,
          mode,
          ...(context?.appId && { appId: context.appId }),
          ...(options.content?.length !== undefined && { contentLength: options.content.length }),
          ...(options.edits?.length !== undefined && { editsCount: options.edits.length }),
          ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
          ...(options.autoCommit !== undefined && { autoCommit: options.autoCommit }),
          ...(options.autoBuild !== undefined && { autoBuild: options.autoBuild }),
        });
      } else {
        toolFileEditEvents.failure(logger, new Error(result.error || 'Unknown error'), {
          toolName: 'FileEditTool',
          filePath: options.path,
          mode,
          ...(context?.appId && { appId: context.appId }),
        });
      }
      
      return result;
    } catch (error) {
      const errorResult = {
        success: false,
        path: options.path,
        mode: 'edit' as const,
        error: error instanceof Error ? error.message : String(error),
      };
      
      toolFileEditEvents.failure(logger, error as Error, {
        toolName: 'FileEditTool',
        filePath: options.path,
        mode: options.mode || 'edit',
        ...(context?.appId && { appId: context.appId }),
      });
      
      return errorResult;
    }
  }

  /**
   * Resolve file path safely within the app directory
   */
  private resolveFilePath(appPath: string, relativePath: string): string {
    const normalizedPath = translateDockerPath(relativePath);
    const resolved = resolve(appPath, normalizedPath);
    
    // Ensure the file is within the app directory
    if (!resolved.startsWith(appPath)) {
      throw new Error(`File path must be within the app directory. Resolved: ${resolved}, App path: ${appPath}`);
    }
    
    return resolved;
  }

  /**
   * Auto-detect the appropriate edit mode
   */
  private async detectMode(filePath: string, options: FileEditOptions): Promise<'create' | 'edit' | 'rewrite'> {
    const exists = existsSync(filePath);
    
    if (!exists) {
      return 'create';
    }
    
    if (options.content !== undefined && options.edits === undefined) {
      return 'rewrite';
    }
    
    if (options.edits !== undefined) {
      return 'edit';
    }
    
    throw new Error('Cannot determine edit mode: specify either "content" for rewrite or "edits" for partial changes');
  }

  /**
   * Handle creating a new file
   */
  private async handleCreate(filePath: string, options: FileEditOptions, appPath: string, context?: { appId?: string; conversationId?: string }): Promise<FileEditResult> {
    if (!options.content) {
      return {
        success: false,
        path: options.path,
        mode: 'create',
        error: 'Content is required for creating a new file',
      };
    }

    if (existsSync(filePath)) {
      return {
        success: false,
        path: options.path,
        mode: 'create',
        error: 'File already exists. Use mode "rewrite" to overwrite or "edit" to modify',
      };
    }

    // Create parent directories if needed
    if (options.createDirs !== false) {
      await mkdir(dirname(filePath), { recursive: true });
    }

    const diff = createPatch(
      options.path,
      '',
      options.content,
      'non-existent',
      'new file'
    );

    if (!options.dryRun) {
      await writeFile(filePath, options.content, 'utf-8');
      
      // Track token usage for file creation
      await this.trackFileEditUsage(context, 'create', options.path, options.content.length);
    }

    const result: FileEditResult = {
      success: true,
      path: options.path,
      mode: 'create' as const,
      diff,
      changes: {
        additions: options.content.split('\n').length,
        deletions: 0,
        totalLines: options.content.split('\n').length,
      },
    };

    // Auto-commit if enabled
    if (options.autoCommit && !options.dryRun) {
      await this.autoCommitChanges(appPath, filePath, options, result);
    }

    // Auto-build if enabled
    if (options.autoBuild !== false && !options.dryRun) {
      await this.runBuildCommand(appPath, context?.appId);
    }

    return result;
  }

  /**
   * Handle rewriting an entire file
   */
  private async handleRewrite(filePath: string, options: FileEditOptions, appPath: string, context?: { appId?: string; conversationId?: string }): Promise<FileEditResult> {
    if (!options.content) {
      return {
        success: false,
        path: options.path,
        mode: 'rewrite',
        error: 'Content is required for rewrite mode',
      };
    }

    // Check file size limit
    if (options.content.length > this.MAX_FILE_SIZE) {
      return {
        success: false,
        path: options.path,
        mode: 'rewrite',
        error: `File content exceeds maximum size limit (${this.MAX_FILE_SIZE} bytes)`,
      };
    }

    let originalContent = '';

    // Read original content if file exists
    if (existsSync(filePath)) {
      try {
        originalContent = await readFile(filePath, 'utf-8');
      } catch (error) {
        return {
          success: false,
          path: options.path,
          mode: 'rewrite',
          error: `Failed to read original file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const diff = createPatch(
      options.path,
      originalContent,
      options.content,
      'original',
      'modified'
    );

    if (!options.dryRun) {
      await writeFile(filePath, options.content, 'utf-8');
      
      // Track token usage for file rewrite
      await this.trackFileEditUsage(context, 'rewrite', options.path, options.content.length);
    }

    const changes = this.calculateChanges(originalContent, options.content);

    const result: FileEditResult = {
      success: true,
      path: options.path,
      mode: 'rewrite' as const,
      diff,
      changes,
    };

    // Auto-commit if enabled
    if (options.autoCommit && !options.dryRun) {
      await this.autoCommitChanges(appPath, filePath, options, result);
    }

    // Auto-build if enabled
    if (options.autoBuild !== false && !options.dryRun) {
      await this.runBuildCommand(appPath, context?.appId);
    }

    return result;
  }

  /**
   * Handle partial file edits
   */
  private async handleEdit(filePath: string, options: FileEditOptions, appPath: string, context?: { appId?: string; conversationId?: string }): Promise<FileEditResult> {
    if (!options.edits || options.edits.length === 0) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: 'Edits array is required for edit mode',
      };
    }

    if (!existsSync(filePath)) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: 'File does not exist. Use mode "create" to create a new file',
      };
    }

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch (error) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Check file size limit
    if (content.length > this.MAX_FILE_SIZE) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: `File exceeds maximum size limit (${this.MAX_FILE_SIZE} bytes)`,
      };
    }

    const originalContent = content;

    // Apply edits
    const editResults: string[] = [];
    for (const edit of options.edits) {
      if (!edit.old || edit.old === undefined) {
        editResults.push(`✗ Failed: Invalid edit - missing 'old' value`);
        continue;
      }
      
      const result = this.applyEdit(content, edit, options.fuzzyMatch !== false);
      if (result.success) {
        content = result.content;
        editResults.push(`✓ Replaced: ${edit.old.substring(0, 50)}${edit.old.length > 50 ? '...' : ''}`);
      } else {
        editResults.push(`✗ Failed: ${edit.old.substring(0, 50)}${edit.old.length > 50 ? '...' : ''} - ${result.error}`);
      }
    }

    if (content === originalContent) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: 'No changes were applied. Check that search text exists in the file.',
        warning: editResults.join('\n'),
      };
    }

    const diff = createPatch(
      options.path,
      originalContent,
      content,
      'original',
      'modified'
    );

    if (!options.dryRun) {
      await writeFile(filePath, content, 'utf-8');
      
      // Track token usage for file edit
      await this.trackFileEditUsage(context, 'edit', options.path, content.length);
    }

    const changes = this.calculateChanges(originalContent, content);

    const result: FileEditResult = {
      success: true,
      path: options.path,
      mode: 'edit',
      diff,
      changes,
    };
    
    if (editResults.length > 0) {
      result.warning = editResults.join('\n');
    }
    
    // Auto-commit if enabled
    if (options.autoCommit && !options.dryRun) {
      await this.autoCommitChanges(appPath, filePath, options, result);
    }

    // Auto-build if enabled
    if (options.autoBuild !== false && !options.dryRun) {
      await this.runBuildCommand(appPath, context?.appId);
    }
    
    return result;
  }

  /**
   * Apply a single edit operation
   */
  private applyEdit(content: string, edit: { old: string; new: string }, fuzzyMatch: boolean): { success: boolean; content: string; error?: string } {
    // Try exact match first
    if (content.includes(edit.old)) {
      return {
        success: true,
        content: content.replace(edit.old, edit.new),
      };
    }

    // Try fuzzy matching if enabled
    if (fuzzyMatch) {
      const fuzzyResult = this.fuzzySearch(content, edit.old);
      if (fuzzyResult.found) {
        return {
          success: true,
          content: content.replace(fuzzyResult.match, edit.new),
        };
      }
    }

    return {
      success: false,
      content,
      error: 'Search text not found',
    };
  }

  /**
   * Fuzzy search for text with minor differences
   */
  private fuzzySearch(content: string, searchText: string): { found: boolean; match: string } {
    const lines = content.split('\n');
    const searchLines = searchText.split('\n');
    
    // Simple fuzzy matching: ignore leading/trailing whitespace
    const normalizedSearch = searchLines.map(line => line.trim()).join('\n');
    
    for (let i = 0; i <= lines.length - searchLines.length; i++) {
      const candidateLines = lines.slice(i, i + searchLines.length);
      const normalizedCandidate = candidateLines.map(line => line.trim()).join('\n');
      
      if (normalizedCandidate === normalizedSearch) {
        return {
          found: true,
          match: candidateLines.join('\n'),
        };
      }
    }
    
    return { found: false, match: '' };
  }



  /**
   * Calculate changes between original and new content
   */
  private calculateChanges(original: string, modified: string): { additions: number; deletions: number; totalLines: number } {
    const diff = diffLines(original, modified);
    
    let additions = 0;
    let deletions = 0;
    
    for (const part of diff) {
      if (part.added) {
        additions += part.count || 0;
      } else if (part.removed) {
        deletions += part.count || 0;
      }
    }
    
    return {
      additions,
      deletions,
      totalLines: modified.split('\n').length,
    };
  }

  /**
   * Track token usage for file edit operations
   */
  private async trackFileEditUsage(
    context: { appId?: string; conversationId?: string } | undefined,
    operation: string,
    filePath: string,
    contentLength: number
  ): Promise<void> {
    if (!context?.appId) return;

    try {
      // File operations don't use LLM tokens, so both prompt and completion are 0
      await this.tokenUsageRepo.recordUsage(
        context.appId,
        'file_edit',
        0, // No prompt tokens for file edits
        0, // No completion tokens for file edits
        {
          ...(context.conversationId && { conversationId: context.conversationId }),
          description: `File ${operation}: ${filePath ? filePath.split('/').pop() : 'unknown'} (${contentLength} chars)`
        }
      );
    } catch (error) {
      logger.warn('Failed to track file edit token usage', {
        appId: context?.appId,
        operation,
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Automatically commit changes using git
   */
  private async autoCommitChanges(appPath: string, filePath: string, options: FileEditOptions, result: FileEditResult): Promise<void> {
    // Only proceed if auto-commit is enabled and the operation was successful
    if (!options.autoCommit || !result.success || options.dryRun) {
      return;
    }

    const relativePath = relative(appPath, filePath);
    
    try {
      // First, add the changed file to git
      await this.gitTool.executeGitOperation(appPath, {
        operation: 'add',
        files: [relativePath]
      });

      // Generate commit message if none provided
      let commitMessage = options.commitMessage;
      if (!commitMessage) {
        switch (result.mode) {
          case 'create':
            commitMessage = `Create file: ${relativePath}`;
            break;
          case 'rewrite':
            commitMessage = `Rewrite file: ${relativePath}`;
            break;
          case 'edit':
            commitMessage = `Update file: ${relativePath}`;
            break;
        }
      }

      // Commit the changes
      await this.gitTool.executeGitOperation(appPath, {
        operation: 'commit',
        message: commitMessage
      });
    } catch (error) {
      logger.error('Failed to auto-commit changes', {
        filePath: relativePath,
        appPath,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw error, as the file operation itself was successful
    }
  }

  /**
   * Format the edit result for display
   */
  formatResult(result: FileEditResult): string {
    const lines: string[] = [];
    
    const statusIcon = result.success ? '✅' : '❌';
    lines.push(`${statusIcon} **File ${result.mode}**: \`${result.path}\``);
    
    if (result.changes) {
      lines.push(`📊 **Changes**: +${result.changes.additions} -${result.changes.deletions} lines (${result.changes.totalLines} total)`);
    }
    

    
    if (result.error) {
      lines.push(`❌ **Error**: ${result.error}`);
    }
    
    if (result.warning) {
      lines.push(`⚠️ **Warnings**:\n${result.warning}`);
    }
    
    if (result.diff && result.success) {
      lines.push('');
      lines.push('📝 **Diff**:');
      lines.push('```diff');
      lines.push(result.diff);
      lines.push('```');
    }
    
    return lines.join('\n');
  }
}
