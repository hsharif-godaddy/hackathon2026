import { dirname, resolve, relative, basename } from 'path';
import { diffLines, createPatch } from 'diff';
import type { FileSystemOperations } from '../filesystem/index.js';
import { LocalFileSystemOperations, defaultLocalFs } from '../filesystem/index.js';
import { GitTool } from './git-tool.js';
import { translateDockerPath, deriveAssetsDir, validateNoEscapingSymlinks } from '../utils/path-helper.js';
import { logger } from '../logging/index.js';
import { createForWorkspace } from '../workspace/index.js';
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
 * File Edit Tool
 * Provides file editing capabilities with safety features
 */
export class FileEditTool {
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

  constructor(private readonly fs: FileSystemOperations = new LocalFileSystemOperations()) {}

  async editFile(appPath: string, options: FileEditOptions, context?: { appId?: string; conversationId?: string }): Promise<FileEditResult> {
    let filePath: string;
    try {
      filePath = resolveFilePath(appPath, options.path);
    } catch (error) {
      return {
        success: false,
        path: options.path,
        mode: options.mode || 'edit',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (isProtectedWorkspacePath(filePath, appPath)) {
      return {
        success: false,
        path: options.path,
        mode: options.mode || 'edit',
        error: `${options.path} is in a protected directory and cannot be modified.`,
      };
    }

    let mode: 'create' | 'edit' | 'rewrite' | 'delete';
    try {
      mode = options.mode || await this.detectMode(filePath, options);
    } catch (error) {
      return {
        success: false,
        path: options.path,
        mode: options.mode || 'edit',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      if (mode !== 'create') {
        const immutable = await isFileImmutable(filePath, this.fs);
        if (immutable) {
          return {
            success: false,
            path: options.path,
            mode,
            error: 'This file is marked as immutable and cannot be edited. The file contains "TREAT AS IMMUTABLE" in its first line.',
          };
        }
      }

      switch (mode) {
        case 'create':
          return await this.handleCreate(filePath, options, appPath, context);
        case 'rewrite':
          return await this.handleRewrite(filePath, options, appPath, context);
        case 'edit':
          return await this.handleEdit(filePath, options, appPath, context);
        case 'delete':
          return await this.handleDelete(filePath, options, appPath, context);
        default:
          return { success: false, path: options.path, mode, error: `Unknown edit mode: ${mode}` };
      }
    } catch (error) {
      return {
        success: false,
        path: options.path,
        mode,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveSourceFile(
    appId: string,
    targetPath: string,
    appBasePath: string
  ): Promise<boolean> {
    try {
      const filename = basename(targetPath);
      const pathBuilder = createSafePathBuilder(appBasePath);
      const fullTargetPath = pathBuilder.join(targetPath);

      const match = await fileUploadService.findMatchingUpload(appId, filename);

      if (await this.fs.exists(fullTargetPath)) {
        if (!match) {
          logger.debug('file-edit.auto-resolve.target-exists', {
            appId,
            filename,
            targetPath: fullTargetPath
          });
          return false;
        }
        logger.info('file-edit.auto-resolve.overwriting', {
          appId,
          filename,
          matchedOriginalName: match.file.originalName,
          uploadedAt: match.file.uploadedAt
        });
      }

      if (!match) {
        logger.debug('file-edit.auto-resolve.no-match', { appId, filename });
        return false;
      }

      const { file: matchingFile, sourcePath } = match;

      await this.fs.mkdir(dirname(fullTargetPath), { recursive: true });
      const sourceContent = await this.fs.readFile(sourcePath);
      await this.fs.writeFile(fullTargetPath, sourceContent);

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
    const exists = await this.fs.exists(filePath);

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
    // Try auto-resolution from uploads if appId is available
    if (context?.appId && !options.dryRun) {
      const resolved = await this.resolveSourceFile(context.appId, options.path, appPath);

      if (resolved) {
        // File was auto-resolved from uploads
        // Check if it's a binary file (images, fonts, etc.)
        const isBinaryFile = BINARY_FILE_REGEX.test(filePath)

        if (isBinaryFile) {
          // For binary files, don't try to read as text
          const stats = await this.fs.stat(filePath)
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
        const resolvedContent = await this.fs.readFile(filePath, 'utf-8');
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

    if (await this.fs.exists(filePath)) {
      return {
        success: false,
        path: options.path,
        mode: 'create',
        error: 'File already exists. Use mode "rewrite" to overwrite or "edit" to modify',
      };
    }

    // Create parent directories if needed
    if (options.createDirs !== false) {
      await this.fs.mkdir(dirname(filePath), { recursive: true });
    }

    const diff = createPatch(
      options.path,
      '',
      options.content,
      'non-existent',
      'new file'
    );

    if (!options.dryRun) {
      await this.fs.writeFile(filePath, options.content, 'utf-8');
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
    if (context?.appId && !(await this.fs.exists(filePath)) && !options.dryRun) {
      const resolved = await this.resolveSourceFile(context.appId, options.path, appPath);

      if (resolved) {
        // File was auto-resolved from uploads
        const resolvedContent = await this.fs.readFile(filePath, 'utf-8');
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
    if (await this.fs.exists(filePath)) {
      try {
        originalContent = await this.fs.readFile(filePath, 'utf-8');
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
        await this.fs.mkdir(dirname(filePath), { recursive: true });
      }
      await this.fs.writeFile(filePath, options.content, 'utf-8');
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

    if (!(await this.fs.exists(filePath))) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: 'File does not exist. Use mode "create" to create a new file',
      };
    }

    let content: string;
    try {
      content = await this.fs.readFile(filePath, 'utf-8');
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
      await this.fs.writeFile(filePath, content, 'utf-8');
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
    if (!(await this.fs.exists(filePath))) {
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
      await this.fs.unlink(filePath);
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
      const workspace = createForWorkspace(context.appId, 'preview');
      const gitTool = new GitTool(workspace?.tasks)

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

}

/**
 * Exported Security Utilities (for reuse in text editor tool)
 */

// Protected workspace paths that cannot be modified via LLM file-edit tools.
const PROTECTED_PATH_PREFIXES = ['.airo'];

/**
 * Returns true when filePath falls on or inside a protected workspace directory.
 */
export function isProtectedWorkspacePath(filePath: string, appPath: string): boolean {
  const normalizedApp = resolve(appPath);
  for (const prefix of PROTECTED_PATH_PREFIXES) {
    const protectedDir = resolve(normalizedApp, prefix);
    if (filePath === protectedDir || filePath.startsWith(protectedDir + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a file is marked as immutable
 * Files with "TREAT AS IMMUTABLE" in the first line cannot be edited
 * Only reads the first 500 bytes for efficiency
 */
export async function isFileImmutable(filePath: string, fsOps: FileSystemOperations = defaultLocalFs): Promise<boolean> {
  // No outer catch — EACCES/EPERM must surface so the caller sees a permission
  // error instead of silently treating a protected file as mutable (which would
  // bypass the "TREAT AS IMMUTABLE" guard). fsOps.exists() only returns false
  // for ENOENT; other errors propagate.
  if (!(await fsOps.exists(filePath))) {
    return false;
  }

  const buffer = Buffer.alloc(500);
  const fd = await fsOps.open(filePath, 'r');
  try {
    const { bytesRead } = await fd.read(buffer, 0, 500, 0);
    const firstLine = buffer.toString('utf-8', 0, bytesRead).split('\n')[0] ?? '';
    return firstLine.includes('TREAT AS IMMUTABLE');
  } finally {
    await fd.close();
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
 * Resolve file path safely within the app directory.
 * Allows symlinks that point to the known assets directory (for the
 * public/assets → ../../assets/public bind mount compatibility symlink).
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

  const assetsDir = deriveAssetsDir(appPath);
  validateNoEscapingSymlinks(resolved, appPath, assetsDir ? [assetsDir] : []);

  return resolved;
}


/**
 * Attempt to resolve a file from the uploads directory.
 * Returns the resolved content if successful, null otherwise.
 *
 * For binary files (JPEG, PNG, etc.) when fullTargetPath is provided,
 * copies the file directly as a raw Buffer to avoid UTF-8 corruption.
 */
export async function resolveSourceFile(
  appId: string,
  targetPath: string,
  content: string,
  fullTargetPath?: string,
  fsOps: FileSystemOperations = defaultLocalFs
): Promise<{ content: string; binaryCopied?: boolean } | null> {
  try {
    const filename = basename(targetPath);

    if (content !== '') {
      return null;
    }

    const match = await fileUploadService.findMatchingUpload(appId, filename);

    if (!match) {
      logger.debug('file-edit.auto-resolve.no-match', { appId, filename });
      return null;
    }

    const { file: matchingFile, sourcePath } = match;
    const isBinary = BINARY_FILE_REGEX.test(filename) && !filename.toLowerCase().endsWith('.svg');

    if (isBinary && fullTargetPath) {
      await fsOps.mkdir(dirname(fullTargetPath), { recursive: true });
      await fsOps.writeFile(fullTargetPath, await fsOps.readFile(sourcePath));

      logger.info('file-edit.auto-resolved', {
        appId,
        filename,
        originalName: matchingFile.originalName,
        from: sourcePath,
        size: matchingFile.size,
        binary: true
      });

      return { content: '', binaryCopied: true };
    }

    logger.info('file-edit.auto-resolved', {
      appId,
      filename,
      originalName: matchingFile.originalName,
      from: sourcePath,
      size: matchingFile.size
    });

    return { content: await fsOps.readFile(sourcePath, 'utf-8') };
  } catch (error) {
    logger.error('file-edit.auto-resolve.error', {
      appId,
      targetPath,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
