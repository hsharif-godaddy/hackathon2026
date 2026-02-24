import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { dirname, resolve, relative, basename } from 'path';
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
import { fileUploadService } from '../services/FileUploadService.js';
import { createSafePathBuilder } from '../utils/safe-path.js';
import { isSourceFile, BINARY_FILE_REGEX } from '../utils/file-types.js';

// Constants for consistent text truncation
const EDIT_RESULT_TRUNCATION_LENGTH = 50;
const DEBUG_TEXT_TRUNCATION_LENGTH = 100;

export interface FileEditOptions {
  /** Path to the file to edit (relative to app root) */
  path: string;
  /** Edit mode: edit for partial changes, rewrite for full replacement, create for new files, delete to remove files */
  mode?: 'edit' | 'rewrite' | 'create' | 'delete';
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
  mode: 'create' | 'edit' | 'rewrite' | 'delete';
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
 * Batch file edit options (multi-operation interface)
 */
export interface FileBatchEditOptions {
  /** Array of file operations to perform in sequence */
  operations: Array<{
    /** Path to the file to edit (relative to app root) */
    path: string;
    /** Edit mode: edit for partial changes, rewrite for full replacement, create for new files, delete to remove files */
    mode?: 'edit' | 'rewrite' | 'create' | 'delete';
    /** Array of search-and-replace operations for partial edits */
    edits?: Array<{
      old: string;
      new: string;
    }>;
    /** Full content for rewrite or create operations */
    content?: string;
  }>;
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

/**
 * Batch file edit result (multi-operation result)
 */
export interface FileBatchEditResult {
  /** Whether ALL operations succeeded */
  success: boolean;
  /** Total number of operations requested */
  totalOperations: number;
  /** Number of operations completed successfully */
  completedOperations: number;
  /** Array of individual operation results (reuses FileEditResult) */
  results: Array<FileEditResult>;
  /** Error message if batch operation failed */
  error?: string;
  /** Git commit hash if autoCommit was successful */
  commitHash?: string;
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
   * Execute a single file edit operation
   * @deprecated Use editFiles() for all operations (single or batch)
   * This method is maintained for backward compatibility with REST API and Memory Service
   */
  async editFile(appPath: string, options: FileEditOptions, context?: { appId?: string; conversationId?: string }): Promise<FileEditResult> {
    // Convert single operation to batch format
    const batchOptions: FileBatchEditOptions = {
      operations: [{
        path: options.path,
        ...(options.mode !== undefined && { mode: options.mode }),
        ...(options.edits !== undefined && { edits: options.edits }),
        ...(options.content !== undefined && { content: options.content }),
      }],
      ...(options.createDirs !== undefined && { createDirs: options.createDirs }),
      ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
      ...(options.fuzzyMatch !== undefined && { fuzzyMatch: options.fuzzyMatch }),
      ...(options.autoCommit !== undefined && { autoCommit: options.autoCommit }),
      ...(options.commitMessage !== undefined && { commitMessage: options.commitMessage }),
    };

    // Execute as batch operation
    const batchResult = await this.editFiles(appPath, batchOptions, context);

    // Extract first result for backward compatibility
    const [firstResult] = batchResult.results;

    if (!firstResult) {
      const errorMsg = batchResult.error || 'Internal error: operation returned no results';
      logger.error('FileEditTool.editFile: No results from batch operation', {
        path: options.path,
        mode: options.mode,
        batchError: batchResult.error,
        ...(context?.appId && { appId: context.appId }),
      });
      return {
        success: false,
        path: options.path,
        mode: options.mode || 'edit',
        error: errorMsg,
      };
    }

    return firstResult;
  }

  /**
   * Execute multiple file edit operations in sequence with fail-fast behavior.
   * Processes each operation sequentially and stops on the first error encountered.
   * Supports automatic git commit for all successful operations.
   *
   * @param appPath - Absolute path to the application directory containing files to edit
   * @param options - Batch operation configuration including array of file operations and commit settings
   * @param context - Optional execution context containing appId and conversationId for logging
   * @returns Promise resolving to batch result with success status, operation counts, and individual results
   * @throws {Error} When file path escapes app directory or symlink security validation fails
   *
   * @example
   * const result = await fileEditTool.editFiles('/tmp/apps/app123/app', {
   *   operations: [
   *     { path: 'src/index.ts', mode: 'edit', edits: [{ old: 'foo', new: 'bar' }] },
   *     { path: 'src/config.json', mode: 'rewrite', content: '{"key": "value"}' }
   *   ],
   *   autoCommit: true,
   *   commitMessage: 'Update source files'
   * }, { appId: 'app123' });
   */
  async editFiles(appPath: string, options: FileBatchEditOptions, context?: { appId?: string; conversationId?: string }): Promise<FileBatchEditResult> {
    // Validate input
    if (!options.operations || options.operations.length === 0) {
      return {
        success: false,
        totalOperations: 0,
        completedOperations: 0,
        results: [],
        error: 'At least one operation is required',
      };
    }

    // Initialize result structure
    const result: FileBatchEditResult = {
      success: true,
      totalOperations: options.operations.length,
      completedOperations: 0,
      results: [],
    };

    const modifiedFilePaths: string[] = [];
    const deletedFilePaths: string[] = [];

    // Log batch begin
    toolFileEditEvents.batchBegin(logger, {
      toolName: 'FileEditTool',
      operationCount: options.operations.length,
      ...(context?.appId && { appId: context.appId }),
    });

    // Process each operation in sequence
    for (const [index, operation] of options.operations.entries()) {
      try {
        // Resolve file path
        const filePath = resolveFilePath(appPath, operation.path);

        // Auto-detect mode if not specified (never auto-detects 'delete')
        const mode = operation.mode || await this.detectMode(filePath, operation);

        // Check immutability (skip for create mode)
        if (mode !== 'create') {
          const immutable = await isFileImmutable(filePath);
          if (immutable) {
            const errorResult: FileEditResult = {
              success: false,
              path: operation.path,
              mode,
              error: 'This file is marked as immutable and cannot be edited. The file contains "TREAT AS IMMUTABLE" in its first line.',
            };
            result.results.push(errorResult);
            result.success = false;
            result.error = `Operation ${index} failed: ${errorResult.error}`;

            toolFileEditEvents.operationFailure(logger, new Error('File is immutable'), {
              toolName: 'FileEditTool',
              operationIndex: index,
              filePath: operation.path,
              mode,
              ...(context?.appId && { appId: context.appId }),
            });

            break; // Fail-fast
          }
        }

        // Log operation begin
        toolFileEditEvents.operationBegin(logger, {
          toolName: 'FileEditTool',
          operationIndex: index,
          filePath: operation.path,
          mode,
          ...(context?.appId && { appId: context.appId }),
        });

        // Build FileEditOptions for the single operation
        const singleOperationOptions: FileEditOptions = {
          path: operation.path,
          mode,
          ...(operation.edits !== undefined && { edits: operation.edits }),
          ...(operation.content !== undefined && { content: operation.content }),
          ...(options.createDirs !== undefined && { createDirs: options.createDirs }),
          ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
          ...(options.fuzzyMatch !== undefined && { fuzzyMatch: options.fuzzyMatch }),
          autoCommit: false, // We handle batch commit separately
        };

        // Execute operation handler
        let opResult: FileEditResult;
        switch (mode) {
          case 'create':
            opResult = await this.handleCreate(filePath, singleOperationOptions, appPath, context);
            break;
          case 'rewrite':
            opResult = await this.handleRewrite(filePath, singleOperationOptions, appPath, context);
            break;
          case 'edit':
            opResult = await this.handleEdit(filePath, singleOperationOptions, appPath, context);
            break;
          case 'delete':
            opResult = await this.handleDelete(filePath, singleOperationOptions, appPath, context);
            break;
          default:
            throw new Error(`Unknown edit mode: ${mode}`);
        }

        // Add result to results array
        result.results.push(opResult);

        if (opResult.success) {
          result.completedOperations++;

          // Track file paths for git commit
          if (mode === 'delete') {
            deletedFilePaths.push(filePath);
          } else {
            modifiedFilePaths.push(filePath);
          }

          toolFileEditEvents.operationSuccess(logger, {
            toolName: 'FileEditTool',
            operationIndex: index,
            filePath: operation.path,
            mode,
            ...(context?.appId && { appId: context.appId }),
          });
        } else {
          result.success = false;
          result.error = `Operation ${index} failed: ${opResult.error}`;

          toolFileEditEvents.operationFailure(logger, new Error(opResult.error || 'Unknown error'), {
            toolName: 'FileEditTool',
            operationIndex: index,
            filePath: operation.path,
            mode,
            ...(context?.appId && { appId: context.appId }),
          });

          break; // Fail-fast
        }
      } catch (error) {
        // Handle unexpected errors
        const errorResult: FileEditResult = {
          success: false,
          path: operation.path,
          mode: operation.mode || 'edit',
          error: error instanceof Error ? error.message : String(error),
        };
        result.results.push(errorResult);
        result.success = false;
        result.error = `Operation ${index} failed: ${errorResult.error}`;

        toolFileEditEvents.operationFailure(logger, error as Error, {
          toolName: 'FileEditTool',
          operationIndex: index,
          filePath: operation.path,
          mode: operation.mode || 'edit',
          ...(context?.appId && { appId: context.appId }),
        });

        break; // Fail-fast
      }
    }

    // Batch git commit if enabled and we have completed operations
    if (!options.dryRun && result.completedOperations > 0 && context?.appId) {
      const commitResult = await this.batchCommitChanges(
        appPath,
        modifiedFilePaths,
        deletedFilePaths,
        options.commitMessage,
        result,
        context.appId
      );

      if (commitResult.success && commitResult.hash) {
        result.commitHash = commitResult.hash;
      } else if (!commitResult.success && commitResult.error) {
        // Distinguish between expected and serious errors
        const errorMessage = commitResult.error.toLowerCase();
        const isExpectedError =
          errorMessage.includes('nothing to commit') ||
          errorMessage.includes('no changes added') ||
          errorMessage.includes('working tree clean');

        if (isExpectedError) {
          // Expected error - nothing to commit (files may have been identical)
          logger.warn('tool.file.edit.git.commit.no_changes', {
            appPath,
            fileCount: modifiedFilePaths.length + deletedFilePaths.length,
            reason: 'nothing_to_commit',
          });
        } else {
          // Serious error - repository corruption, permission errors, etc.
          logger.error('tool.file.edit.git.commit.failure', {
            appPath,
            fileCount: modifiedFilePaths.length + deletedFilePaths.length,
            error: commitResult.error,
            errorType: this.categorizeGitError(commitResult.error),
          });
        }
      }
    }

    // Log batch completion
    if (result.success) {
      toolFileEditEvents.batchSuccess(logger, {
        toolName: 'FileEditTool',
        operationCount: result.totalOperations,
        completedOperations: result.completedOperations,
        ...(context?.appId && { appId: context.appId }),
      });
    } else {
      toolFileEditEvents.batchFailure(logger, new Error(result.error || 'Batch operation failed'), {
        toolName: 'FileEditTool',
        operationCount: result.totalOperations,
        completedOperations: result.completedOperations,
        ...(context?.appId && { appId: context.appId }),
      });
    }

    return result;
  }

  /**
   * Commit multiple file changes in a single git commit transaction.
   * Stages both modified/created files and deleted files, then commits with auto-generated or custom message.
   * Uses git add for both modifications and deletions (modern git behavior).
   *
   * @param appPath - Absolute path to the application directory containing the git repository
   * @param modifiedFilePaths - Array of absolute paths to files that were created or modified
   * @param deletedFilePaths - Array of absolute paths to files that were deleted
   * @param customMessage - Optional custom commit message (if undefined, generates descriptive message)
   * @param result - Batch operation result used for auto-generating commit message
   * @param appId - Application identifier for dev-supervisor client initialization
   * @returns Promise resolving to object with success status and optional commit hash
   * @throws {Error} When git staging, commit, or log operations fail with non-recoverable errors
   *
   * @example
   * const commitResult = await this.batchCommitChanges(
   *   '/tmp/apps/app123/app',
   *   ['/tmp/apps/app123/app/src/index.ts'],
   *   ['/tmp/apps/app123/app/src/old.ts'],
   *   'Update source files',
   *   batchResult,
   *   'app123'
   * );
   */
  private async batchCommitChanges(
    appPath: string,
    modifiedFilePaths: string[],
    deletedFilePaths: string[],
    customMessage: string | undefined,
    result: FileBatchEditResult,
    appId: string
  ): Promise<{ success: boolean; hash?: string; error?: string }> {
    try {
      // Create git tool with dev-supervisor
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const gitTool = new GitTool(devSupervisor || undefined);

      // Stage modified/created files
      if (modifiedFilePaths.length > 0) {
        const relativeFilePaths = modifiedFilePaths.map(fp => relative(appPath, fp));
        await gitTool.executeGitOperation(appPath, {
          operation: 'add',
          files: relativeFilePaths
        });
      }

      // Stage deleted files (git add works for deletions in modern git)
      if (deletedFilePaths.length > 0) {
        const relativeDeletedPaths = deletedFilePaths.map(fp => relative(appPath, fp));
        await gitTool.executeGitOperation(appPath, {
          operation: 'add',
          files: relativeDeletedPaths
        });
      }

      // Generate commit message if not provided
      const commitMessage = customMessage || this.generateBatchCommitMessage(result);

      // Commit the changes
      const commitResult = await gitTool.executeGitOperation(appPath, {
        operation: 'commit',
        message: commitMessage
      });

      if (!commitResult.success) {
        const errorMsg = commitResult.error || 'Git commit operation failed';
        return {
          success: false,
          error: errorMsg
        };
      }

      // Get commit hash from log
      const logResult = await gitTool.executeGitOperation(appPath, {
        operation: 'log',
        options: { count: 1 }
      });

      if (!logResult.success) {
        // Commit succeeded but couldn't retrieve hash - still consider it successful
        logger.warn('tool.file.edit.git.log.failure', {
          appPath,
          reason: 'commit_succeeded_log_failed',
          error: logResult.error || 'Failed to retrieve commit hash'
        });
        return { success: true };
      }

      const hash = logResult.commits?.[0]?.hash;
      return hash ? { success: true, hash } : { success: true };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('tool.file.edit.git.commit.failure', {
        appPath,
        fileCount: modifiedFilePaths.length + deletedFilePaths.length,
        error: errorMessage,
      });
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Categorize git errors by type for better diagnostics.
   * Analyzes error message to determine if it's a permission error, repository corruption,
   * configuration issue, or other type of failure.
   *
   * @param errorMessage - Git error message to categorize
   * @returns Error category string for logging and diagnostics
   */
  private categorizeGitError(errorMessage: string): string {
    const lowerError = errorMessage.toLowerCase();

    if (lowerError.includes('permission denied') || lowerError.includes('access denied')) {
      return 'permission_error';
    }
    if (lowerError.includes('not a git repository') || lowerError.includes('no such file or directory')) {
      return 'repository_not_found';
    }
    if (lowerError.includes('corrupt') || lowerError.includes('broken')) {
      return 'repository_corruption';
    }
    if (lowerError.includes('conflict') || lowerError.includes('merge')) {
      return 'merge_conflict';
    }
    if (lowerError.includes('lock') || lowerError.includes('.git/index.lock')) {
      return 'repository_locked';
    }
    if (lowerError.includes('disk') || lowerError.includes('space')) {
      return 'disk_space_error';
    }

    return 'unknown_error';
  }

  /**
   * Generate a descriptive commit message summarizing batch file operations.
   * Creates human-readable message by counting operation types (create, update, rewrite, delete)
   * and formatting them into a comma-separated list.
   *
   * @param result - Batch operation result containing array of individual file operation results
   * @returns Formatted commit message string describing all successful operations
   *
   * @example
   * // With multiple operation types
   * generateBatchCommitMessage(result) // Returns: "Create 2 files, Update 3 files, Delete 1 file"
   *
   * @example
   * // With single operation type
   * generateBatchCommitMessage(result) // Returns: "Update 5 files"
   *
   * @example
   * // With no successful operations
   * generateBatchCommitMessage(result) // Returns: "Update files"
   */
  private generateBatchCommitMessage(result: FileBatchEditResult): string {
    const operations = result.results;
    const created = operations.filter(r => r.success && r.mode === 'create').length;
    const edited = operations.filter(r => r.success && r.mode === 'edit').length;
    const rewritten = operations.filter(r => r.success && r.mode === 'rewrite').length;
    const deleted = operations.filter(r => r.success && r.mode === 'delete').length;

    const parts: string[] = [];
    if (created > 0) parts.push(`Create ${created} file${created > 1 ? 's' : ''}`);
    if (edited > 0) parts.push(`Update ${edited} file${edited > 1 ? 's' : ''}`);
    if (rewritten > 0) parts.push(`Rewrite ${rewritten} file${rewritten > 1 ? 's' : ''}`);
    if (deleted > 0) parts.push(`Delete ${deleted} file${deleted > 1 ? 's' : ''}`);

    if (parts.length === 0) {
      return 'Update files';
    } else if (parts.length === 1) {
      return parts[0] ?? 'Update files';
    } else {
      return parts.join(', ');
    }
  }

  /**
   * Check if a file is marked as immutable
   * Files with "TREAT AS IMMUTABLE" in the first line cannot be edited
   * Only reads the first 500 bytes for efficiency
   */
  private async isFileImmutable(filePath: string): Promise<boolean> {
    return isFileImmutable(filePath);
  }

  /**
   * Resolve file path safely within the app directory
   */
  private resolveFilePath(appPath: string, relativePath: string): string {
    return resolveFilePath(appPath, relativePath);
  }

  /**
   * Validate that no symlinks in the path chain point outside the app directory
   */
  private validateNoEscapingSymlinks(targetPath: string, appPath: string): void {
    return validateNoEscapingSymlinks(targetPath, appPath);
  }

  /**
   * Attempt to resolve a file from the uploads directory.
   * Checks if a matching file exists in /tmp/uploads/{appId}/ and copies it to the target location.
   *
   * @param appId - Application ID to search uploads for
   * @param targetPath - Relative target path within the project (e.g., 'public/logo.png')
   * @param appBasePath - Absolute base path of the application
   * @returns Promise<boolean> - true if file was resolved and copied, false otherwise
   */
  private async resolveSourceFile(
    appId: string,
    targetPath: string,
    appBasePath: string
  ): Promise<boolean> {
    try {
      const filename = basename(targetPath);
      // SECURITY: Use safe path builder to prevent path traversal attacks
      const pathBuilder = createSafePathBuilder(appBasePath);
      const fullTargetPath = pathBuilder.join(targetPath);

      // Check if file already exists in project
      if (existsSync(fullTargetPath)) {
        logger.debug('file-edit.auto-resolve.target-exists', {
          appId,
          filename,
          targetPath: fullTargetPath
        });
        return false; // Don't auto-resolve, use existing project file
      }

      // List all uploaded files for this app
      const uploadedFiles = await fileUploadService.listUploadedFiles(appId);

      if (uploadedFiles.length === 0) {
        logger.debug('file-edit.auto-resolve.no-uploads', {
          appId,
          filename
        });
        return false; // No uploads available
      }

      // Extract file extension from target filename
      const targetExt = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')).toLowerCase() : '';

      // Strategy 1: Try exact match by originalName or filename
      let matchingFile = uploadedFiles.find(
        f => f.originalName === filename || f.filename === filename
      );

      // Strategy 2: If no exact match, try matching by file extension
      if (!matchingFile && targetExt) {
        const filesWithSameExt = uploadedFiles.filter(f => {
          const uploadExt = f.originalName.includes('.')
            ? f.originalName.substring(f.originalName.lastIndexOf('.')).toLowerCase()
            : '';
          return uploadExt === targetExt;
        });

        if (filesWithSameExt.length === 1) {
          // Only one file with this extension - use it
          const matched = filesWithSameExt[0]!;
          matchingFile = matched;
          logger.info('file-edit.auto-resolve.extension-match', {
            appId,
            requestedFilename: filename,
            matchedOriginalName: matched.originalName,
            matchingStrategy: 'single-extension-match'
          });
        } else if (filesWithSameExt.length > 1) {
          // Multiple files with same extension - use most recent
          const matched = filesWithSameExt.sort((a, b) =>
            new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
          )[0]!;
          matchingFile = matched;
          logger.info('file-edit.auto-resolve.extension-match', {
            appId,
            requestedFilename: filename,
            matchedOriginalName: matched.originalName,
            candidateCount: filesWithSameExt.length,
            matchingStrategy: 'most-recent-by-extension'
          });
        }
      }

      if (!matchingFile) {
        logger.debug('file-edit.auto-resolve.no-match', {
          appId,
          filename,
          uploadedFileCount: uploadedFiles.length,
          availableFiles: uploadedFiles.map(f => f.originalName)
        });
        return false; // No matching upload found
      }

      // Get the full path to the uploaded file
      // Note: We need to find which uploadId this file belongs to
      // The metadata.files array doesn't include uploadId, so we need to scan uploads
      let sourcePath: string | null = null;

      // Re-scan to find the upload directory containing this file
      const uploadsBaseDir = fileUploadService['uploadsDir'];
      const appUploadsDir = fileUploadService['pathBuilder'].join(appId);

      if (existsSync(appUploadsDir)) {
        const { readdirSync } = await import('fs');
        const uploadDirs = readdirSync(appUploadsDir);

        for (const uploadId of uploadDirs) {
          const candidatePath = fileUploadService.getFilePath(appId, uploadId, matchingFile.filename);
          if (existsSync(candidatePath)) {
            sourcePath = candidatePath;
            break;
          }
        }
      }

      if (!sourcePath || !existsSync(sourcePath)) {
        logger.warn('file-edit.auto-resolve.source-missing', {
          appId,
          filename,
          matchingFile: matchingFile.filename
        });
        return false;
      }

      // Ensure target directory exists
      await mkdir(dirname(fullTargetPath), { recursive: true });

      // Copy file from uploads to project
      const sourceContent = await readFile(sourcePath);
      await writeFile(fullTargetPath, sourceContent);

      logger.info('file-edit.auto-resolved', {
        appId,
        filename,
        originalName: matchingFile.originalName,
        from: sourcePath,
        to: fullTargetPath,
        size: matchingFile.size
      });

      return true;
    } catch (error) {
      logger.error('file-edit.auto-resolve.error', {
        appId,
        targetPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Auto-detect the appropriate edit mode
   */
  private async detectMode(filePath: string, options: FileEditOptions): Promise<'create' | 'edit' | 'rewrite' | 'delete'> {
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
   * Validate content doesn't contain forbidden upload URLs
   * CRITICAL: Prevents upload URLs from appearing in generated source code
   */
  private validateNoApiPaths(content: string, filePath: string): { valid: boolean; error?: string } {
    return validateNoApiPaths(content, filePath);
  }

  /**
   * Handle creating a new file
   */
  private async handleCreate(filePath: string, options: FileEditOptions, appPath: string, context?: { appId?: string; conversationId?: string }): Promise<FileEditResult> {
    // Try auto-resolution from uploads if appId is available
    if (context?.appId && !options.dryRun) {
      const resolved = await this.resolveSourceFile(context.appId, options.path, appPath);

      if (resolved) {
        // File was auto-resolved from uploads
        // Check if it's a binary file (images, fonts, etc.)
        const isBinaryFile = BINARY_FILE_REGEX.test(filePath)

        if (isBinaryFile) {
          // For binary files, don't try to read as text
          const stats = await import('fs').then(fs => fs.promises.stat(filePath))
          return {
            success: true,
            path: options.path,
            mode: 'create' as const,
            diff: `Binary file auto-resolved from uploads (${stats.size} bytes)`,
            changes: {
              additions: 0,
              deletions: 0,
              totalLines: 0,
            },
          };
        }

        // For text files, read and create diff
        const resolvedContent = await readFile(filePath, 'utf-8');
        const diff = createPatch(
          options.path,
          '',
          resolvedContent,
          'non-existent',
          'auto-resolved from uploads'
        );

        return {
          success: true,
          path: options.path,
          mode: 'create' as const,
          diff,
          changes: {
            additions: resolvedContent.split('\n').length,
            deletions: 0,
            totalLines: resolvedContent.split('\n').length,
          },
        };
      }
    }

    // Allow empty string for creating empty files or auto-resolution
    // Only reject if content is undefined or null
    if (options.content === undefined || options.content === null) {
      return {
        success: false,
        path: options.path,
        mode: 'create',
        error: 'Content is required for creating a new file',
      };
    }

    // CRITICAL: Validate content doesn't contain forbidden API paths
    const validation = validateNoApiPaths(options.content, options.path);
    if (!validation.valid) {
      return {
        success: false,
        path: options.path,
        mode: 'create',
        error: validation.error,
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
    // Try auto-resolution from uploads if appId is available and file doesn't exist
    if (context?.appId && !existsSync(filePath) && !options.dryRun) {
      const resolved = await this.resolveSourceFile(context.appId, options.path, appPath);

      if (resolved) {
        // File was auto-resolved from uploads
        const resolvedContent = await readFile(filePath, 'utf-8');
        const diff = createPatch(
          options.path,
          '',
          resolvedContent,
          'non-existent',
          'auto-resolved from uploads'
        );

        return {
          success: true,
          path: options.path,
          mode: 'rewrite' as const,
          diff,
          changes: {
            additions: resolvedContent.split('\n').length,
            deletions: 0,
            totalLines: resolvedContent.split('\n').length,
          },
        };
      }
    }

    if (!options.content) {
      return {
        success: false,
        path: options.path,
        mode: 'rewrite',
        error: 'Content is required for rewrite mode',
      };
    }

    // CRITICAL: Validate content doesn't contain forbidden API paths
    const validation = validateNoApiPaths(options.content, options.path);
    if (!validation.valid) {
      return {
        success: false,
        path: options.path,
        mode: 'rewrite',
        error: validation.error,
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
      // Create parent directories if needed
      if (options.createDirs !== false) {
        await mkdir(dirname(filePath), { recursive: true });
      }
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
    const failedEdits: string[] = [];
    for (const edit of options.edits) {
      if (!edit.old || edit.old === undefined) {
        failedEdits.push(`Failed: Invalid edit - missing 'old' value`);
        continue;
      }

      const result = this.applyEdit(content, edit, options.fuzzyMatch !== false);
      if (result.success) {
        content = result.content;
      } else {
        failedEdits.push(`Failed: ${edit.old.substring(0, EDIT_RESULT_TRUNCATION_LENGTH)}${edit.old.length > EDIT_RESULT_TRUNCATION_LENGTH ? '...' : ''} - ${result.error}`);
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
        failedEdits: failedEdits,
        ...(context?.appId && { appId: context.appId }),
      });

      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: 'No changes were applied. Check that search text exists in the file.',
        ...(failedEdits.length > 0 && { warning: failedEdits.join('\n') }),
      };
    }

    // CRITICAL: Validate resulting content doesn't contain forbidden API paths
    const validation = validateNoApiPaths(content, options.path);
    if (!validation.valid) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: validation.error,
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

    // Only include warnings if there were failed edits
    if (failedEdits.length > 0) {
      result.warning = failedEdits.join('\n');
    }

    // Auto-commit if enabled
    if (options.autoCommit && !options.dryRun) {
      await this.autoCommitChanges(appPath, filePath, options, result, context);
    }


    return result;
  }

  /**
   * Handle delete mode - remove a file
   */
  private async handleDelete(filePath: string, options: FileEditOptions, appPath: string, context?: { appId?: string; conversationId?: string }): Promise<FileEditResult> {
    if (!existsSync(filePath)) {
      return {
        success: false,
        path: options.path,
        mode: 'delete',
        error: 'File does not exist',
      };
    }

    if (options.dryRun) {
      return {
        success: true,
        path: options.path,
        mode: 'delete',
        diff: `File would be deleted: ${options.path}`,
      };
    }

    try {
      await unlink(filePath);
    } catch (error) {
      return {
        success: false,
        path: options.path,
        mode: 'delete',
        error: `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const result: FileEditResult = {
      success: true,
      path: options.path,
      mode: 'delete',
      diff: `File deleted: ${options.path}`,
    };

    if (options.autoCommit) {
      await this.autoCommitChanges(appPath, filePath, options, result, context);
    }

    return result;
  }

  /**
   * Apply a single edit operation
   */
  private applyEdit(content: string, edit: { old: string; new: string }, fuzzyMatch: boolean): { success: boolean; content: string; error?: string } {
    // Check if old and new text are identical
    if (edit.old === edit.new) {
      // Check if the text exists in the file
      if (content.includes(edit.old)) {
        // Text exists and is already correct - this is a successful no-op
        return {
          success: true,
          content,
        };
      }
      // Text doesn't exist - this is an error
      return {
        success: false,
        content,
        error: 'Search text not found',
      };
    }

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
          case 'delete':
            commitMessage = `Delete file: ${relativePath}`;
            break;
        }
      }

      // Commit the changes
      await gitTool.executeGitOperation(appPath, {
        operation: 'commit',
        message: commitMessage || `Update file: ${relativePath}`
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
   * Handles both single operation and batch operation results
   */
  summarizeOperation(options: FileEditOptions | FileBatchEditOptions, result: FileEditResult | FileBatchEditResult): string {
    // Check if batch result
    if ('results' in result && Array.isArray(result.results)) {
      const batchResult = result as FileBatchEditResult;
      if (!batchResult.success) {
        return `Batch operation failed: ${batchResult.completedOperations}/${batchResult.totalOperations} completed`;
      }

      const created = batchResult.results.filter(r => r.success && r.mode === 'create').length;
      const edited = batchResult.results.filter(r => r.success && r.mode === 'edit').length;
      const rewritten = batchResult.results.filter(r => r.success && r.mode === 'rewrite').length;
      const deleted = batchResult.results.filter(r => r.success && r.mode === 'delete').length;

      const parts: string[] = [];
      if (created > 0) parts.push(`created ${created} file${created > 1 ? 's' : ''}`);
      if (edited > 0) parts.push(`modified ${edited} file${edited > 1 ? 's' : ''}`);
      if (rewritten > 0) parts.push(`rewrote ${rewritten} file${rewritten > 1 ? 's' : ''}`);
      if (deleted > 0) parts.push(`deleted ${deleted} file${deleted > 1 ? 's' : ''}`);

      return `Batch operation: ${parts.join(', ')}`;
    }

    // Single operation result (original logic)
    const singleResult = result as FileEditResult;
    if (!singleResult.success) {
      return `Failed to ${singleResult.mode} ${singleResult.path}: ${singleResult.error}`;
    }

    const fileName = singleResult.path.split('/').pop() || singleResult.path;

    switch (singleResult.mode) {
      case 'create': {
        const lines = singleResult.changes?.totalLines || 0;
        return `Created ${fileName} (${lines} lines)`;
      }
      case 'rewrite': {
        const lines = singleResult.changes?.totalLines || 0;
        return `Rewrote ${fileName} (${lines} lines)`;
      }
      case 'edit': {
        const adds = singleResult.changes?.additions || 0;
        const dels = singleResult.changes?.deletions || 0;
        return `Modified ${fileName} (+${adds} -${dels} lines)`;
      }
      case 'delete': {
        return `Deleted ${fileName}`;
      }
      default:
        return `Updated ${fileName}`;
    }
  }

  /**
   * Format the edit result for display
   */
  formatResult(result: FileEditResult | FileBatchEditResult): string {
    // Check if it's a batch result
    if ('results' in result && Array.isArray(result.results)) {
      const batchResult = result as FileBatchEditResult;
      return JSON.stringify({
        success: batchResult.success,
        totalOperations: batchResult.totalOperations,
        completedOperations: batchResult.completedOperations,
        operations: batchResult.results.map(r => ({
          path: r.path,
          mode: r.mode,
          success: r.success,
          changes: r.changes,
          diff: r.diff,
          error: r.error,
          warning: r.warning
        })),
        commitHash: batchResult.commitHash,
        error: batchResult.error
      }, null, 2);
    }

    // Single operation result (original format)
    const singleResult = result as FileEditResult;
    return JSON.stringify({
      success: singleResult.success,
      mode: singleResult.mode,
      path: singleResult.path,
      changes: singleResult.changes,
      diff: singleResult.diff,
      error: singleResult.error,
      warning: singleResult.warning
    }, null, 2);
  }
}

/**
 * Exported Security Utilities (for reuse in text editor tool)
 */

/**
 * Check if a file is marked as immutable
 * Files with "TREAT AS IMMUTABLE" in the first line cannot be edited
 * Only reads the first 500 bytes for efficiency
 */
export async function isFileImmutable(filePath: string): Promise<boolean> {
  try {
    if (!existsSync(filePath)) {
      return false; // Non-existent files are not immutable
    }

    // Only read first 500 bytes to check for marker (efficient for large files)
    const buffer = Buffer.alloc(500);
    const fs = await import('fs');
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const { bytesRead } = await fd.read(buffer, 0, 500, 0);
      const firstBytes = buffer.toString('utf-8', 0, bytesRead);
      const firstLine = firstBytes.split('\n')[0] || '';

      return firstLine.includes('TREAT AS IMMUTABLE');
    } finally {
      await fd.close();
    }
  } catch (error) {
    // If we can't read the file, assume it's not immutable
    return false;
  }
}

/**
 * Validate content doesn't contain forbidden upload URLs
 * CRITICAL: Prevents upload URLs from appearing in generated source code
 */
export function validateNoApiPaths(content: string, filePath: string): { valid: boolean; error?: string } {
  // Check if this is a source code file (not config/data files)
  if (!isSourceFile(filePath)) {
    return { valid: true }; // Don't validate non-source files
  }

  // Check for forbidden upload paths (both old proxy format and new agent format)
  if (content.includes('/api/files/') || content.includes('/files/uploads/')) {
    return {
      valid: false,
      error: `FORBIDDEN: Cannot write upload URLs to source code. These are temporary URLs that will break in production.

The content you're trying to write contains upload URLs.

REQUIRED WORKFLOW for uploaded files:
1. FIRST: Copy file to project (e.g., create new file at "public/assets/image.png")

2. THEN: Reference with project-relative path
   Example: <img src="/assets/image.png" />

DO NOT use upload URLs in source code - they are temporary and will not work in production.`
    };
  }

  return { valid: true };
}

/**
 * Validate that no symlinks in the path chain point outside the app directory
 */
export function validateNoEscapingSymlinks(targetPath: string, appPath: string): void {
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
 * Resolve file path safely within the app directory
 */
export function resolveFilePath(appPath: string, relativePath: string): string {
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
  validateNoEscapingSymlinks(resolved, appPath);

  return resolved;
}

/**
 * Attempt to resolve a file from the uploads directory.
 * Returns the resolved content if successful, null otherwise.
 */
export async function resolveSourceFile(
  appId: string,
  targetPath: string,
  content: string
): Promise<{ content: string } | null> {
  try {
    const filename = basename(targetPath);

    // Check if content is empty (signal for auto-resolution)
    if (content !== '') {
      return null; // Content provided, no need to resolve
    }

    // List all uploaded files for this app
    const uploadedFiles = await fileUploadService.listUploadedFiles(appId);

    if (uploadedFiles.length === 0) {
      logger.debug('file-edit.auto-resolve.no-uploads', {
        appId,
        filename
      });
      return null; // No uploads available
    }

    // Extract file extension from target filename
    const targetExt = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')).toLowerCase() : '';

    // Strategy 1: Try exact match by originalName or filename
    let matchingFile = uploadedFiles.find(
      f => f.originalName === filename || f.filename === filename
    );

    // Strategy 2: If no exact match, try matching by file extension
    if (!matchingFile && targetExt) {
      const filesWithSameExt = uploadedFiles.filter(f => {
        const uploadExt = f.originalName.includes('.')
          ? f.originalName.substring(f.originalName.lastIndexOf('.')).toLowerCase()
          : '';
        return uploadExt === targetExt;
      });

      if (filesWithSameExt.length === 1) {
        // Only one file with this extension - use it
        const matched = filesWithSameExt[0]!;
        matchingFile = matched;
        logger.info('file-edit.auto-resolve.extension-match', {
          appId,
          requestedFilename: filename,
          matchedOriginalName: matched.originalName,
          matchingStrategy: 'single-extension-match'
        });
      } else if (filesWithSameExt.length > 1) {
        // Multiple files with same extension - use most recent
        const matched = filesWithSameExt.sort((a, b) =>
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
        )[0]!;
        matchingFile = matched;
        logger.info('file-edit.auto-resolve.extension-match', {
          appId,
          requestedFilename: filename,
          matchedOriginalName: matched.originalName,
          candidateCount: filesWithSameExt.length,
          matchingStrategy: 'most-recent-by-extension'
        });
      }
    }

    if (!matchingFile) {
      logger.debug('file-edit.auto-resolve.no-match', {
        appId,
        filename,
        uploadedFileCount: uploadedFiles.length,
        availableFiles: uploadedFiles.map(f => f.originalName)
      });
      return null; // No matching upload found
    }

    // Get the full path to the uploaded file
    let sourcePath: string | null = null;

    // Re-scan to find the upload directory containing this file
    const appUploadsDir = fileUploadService['pathBuilder'].join(appId);

    if (existsSync(appUploadsDir)) {
      const { readdirSync } = await import('fs');
      const uploadDirs = readdirSync(appUploadsDir);

      for (const uploadId of uploadDirs) {
        const candidatePath = fileUploadService.getFilePath(appId, uploadId, matchingFile.filename);
        if (existsSync(candidatePath)) {
          sourcePath = candidatePath;
          break;
        }
      }
    }

    if (!sourcePath || !existsSync(sourcePath)) {
      logger.warn('file-edit.auto-resolve.source-missing', {
        appId,
        filename,
        matchingFile: matchingFile.filename
      });
      return null;
    }

    // Read and return content
    const sourceContent = await readFile(sourcePath, 'utf-8');

    logger.info('file-edit.auto-resolved', {
      appId,
      filename,
      originalName: matchingFile.originalName,
      from: sourcePath,
      size: matchingFile.size
    });

    return { content: sourceContent };
  } catch (error) {
    logger.error('file-edit.auto-resolve.error', {
      appId,
      targetPath,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
