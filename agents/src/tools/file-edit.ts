import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, resolve, relative } from 'path';
import { diffLines, createPatch } from 'diff';
import { existsSync, realpathSync, lstatSync } from 'fs';
import { AppRepository } from '../database/index.js';
import { GitTool } from './git-tool.js';
import axios from 'axios';
import { translateDockerPath } from '../utils/path-helper.js';
import { logger } from '../logging/index.js';
import { toolFileEditEvents, toolServerHealthEvents } from '../logging/events/index.js';
import { ServerManagementTool } from './server-management-tool.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';

// Constants for consistent text truncation
const EDIT_RESULT_TRUNCATION_LENGTH = 50;
const DEBUG_TEXT_TRUNCATION_LENGTH = 100;

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
  private appRepo: AppRepository;

  constructor() {
    this.appRepo = new AppRepository();
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
    
    // Ensure the file is within the app directory (before resolving symlinks)
    // Use relative() to check for escape attempts with '..' - if the relative path
    // starts with '..' then it's trying to escape the app directory
    const rel = relative(appPath, resolved);
    if (rel.startsWith('..') || resolve(appPath) === resolved.slice(0, -1)) {
      throw new Error(`File path must be within the app directory. Resolved: ${resolved}, App path: ${appPath}`);
    }
    
    // Check all components of the path for symlinks that might escape
    this.validateNoEscapingSymlinks(resolved, appPath);
    
    return resolved;
  }

  /**
   * Validate that no symlinks in the path chain point outside the app directory
   */
  private validateNoEscapingSymlinks(targetPath: string, appPath: string): void {
    // Build up the path component by component, checking each for symlinks
    const pathParts = relative(appPath, targetPath).split('/').filter(Boolean);
    let currentPath = appPath;
    
    for (const part of pathParts) {
      currentPath = resolve(currentPath, part);
      
      // Check if this component exists and is a symlink
      if (existsSync(currentPath)) {
        try {
          const stats = lstatSync(currentPath);
          
          if (stats.isSymbolicLink()) {
            // Resolve the symlink to its real path
            const realPath = realpathSync(currentPath);
            
            // Ensure the real path is within the app directory
            // Use relative() to properly check for escape attempts
            const rel = relative(appPath, realPath);
            if (rel.startsWith('..')) {
              throw new Error(
                `Security violation: symlink points outside the app directory. ` +
                `Link: ${currentPath}, Target: ${realPath}, App path: ${appPath}`
              );
            }
            
            // NOTE: We do NOT update currentPath here. We continue traversing the original
            // path structure to ensure we check all components, even those that come after
            // a symlink. If we updated currentPath to realPath, we would skip checking
            // subsequent symlinks in the original path chain.
          }
        } catch (error) {
          // Re-throw security violation errors
          if (error instanceof Error && error.message.includes('Security violation')) {
            throw error;
          }
          // For other errors (like permission denied), continue - they'll be caught later
        }
      }
    }
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
      await this.autoCommitChanges(appPath, filePath, options, result, context);
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
      await this.autoCommitChanges(appPath, filePath, options, result, context);
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
        editResults.push(`✓ Replaced: ${edit.old.substring(0, EDIT_RESULT_TRUNCATION_LENGTH)}${edit.old.length > EDIT_RESULT_TRUNCATION_LENGTH ? '...' : ''}`);
      } else {
        editResults.push(`✗ Failed: ${edit.old.substring(0, EDIT_RESULT_TRUNCATION_LENGTH)}${edit.old.length > EDIT_RESULT_TRUNCATION_LENGTH ? '...' : ''} - ${result.error}`);
      }
    }

    if (content === originalContent) {
      // Log detailed edit failure information for debugging
      logger.error('File edit failed - no changes applied', {
        toolName: 'FileEditTool',
        filePath: options.path,
        mode: 'edit',
        editsAttempted: options.edits.length,
        editDetails: options.edits.map((edit, index) => ({
          editIndex: index,
          oldText: edit.old.length > DEBUG_TEXT_TRUNCATION_LENGTH ? `${edit.old.substring(0, DEBUG_TEXT_TRUNCATION_LENGTH)}...` : edit.old,
          newText: edit.new.length > DEBUG_TEXT_TRUNCATION_LENGTH ? `${edit.new.substring(0, DEBUG_TEXT_TRUNCATION_LENGTH)}...` : edit.new,
          oldTextLength: edit.old.length,
          newTextLength: edit.new.length,
        })),
        editResults: editResults,
        ...(context?.appId && { appId: context.appId }),
      });
      
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
      await this.autoCommitChanges(appPath, filePath, options, result, context);
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
   * Automatically commit changes using git
   */
  private async autoCommitChanges(appPath: string, filePath: string, options: FileEditOptions, result: FileEditResult, context?: { appId?: string }): Promise<void> {
    // Only proceed if auto-commit is enabled and the operation was successful
    if (!options.autoCommit || !result.success || options.dryRun || !context?.appId) {
      return;
    }

    const relativePath = relative(appPath, filePath);
    
    try {
      // Create git tool with dev-supervisor for this specific app
      const devSupervisor = DevSupervisorClientFactory.createForApp(context.appId)
      const gitTool = new GitTool(devSupervisor || undefined)
      
      // First, add the changed file to git
      await gitTool.executeGitOperation(appPath, {
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
      await gitTool.executeGitOperation(appPath, {
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
   * Create a summary of the file edit operation for conversation history
   */
  summarizeOperation(options: FileEditOptions, result: FileEditResult): string {
    if (!result.success) {
      return `Failed to ${result.mode} ${result.path}: ${result.error}`;
    }

    const fileName = result.path.split('/').pop() || result.path;
    
    switch (result.mode) {
      case 'create': {
        const createLines = result.changes?.totalLines || 0;
        return `Created ${fileName} (${createLines} lines)`;
      }
        
      case 'rewrite': {
        const rewriteLines = result.changes?.totalLines || 0;
        return `Rewrote ${fileName} (${rewriteLines} lines)`;
      }
        
      case 'edit': {
        const additions = result.changes?.additions || 0;
        const deletions = result.changes?.deletions || 0;
        return `Modified ${fileName} (+${additions} -${deletions} lines)`;
      }
        
      default:
        return `Updated ${fileName}`;
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
