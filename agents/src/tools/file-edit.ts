import { readFile, writeFile, mkdir, stat, copyFile } from 'fs/promises';
import { dirname, join, resolve, relative } from 'path';
import { createHash } from 'crypto';
import { diffLines, createPatch } from 'diff';
import { existsSync } from 'fs';
import { GitTool } from './git-tool.js';
import { exec } from 'child_process';

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
  /** Create a backup before editing */
  backup?: boolean;
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
  /** Path to backup file if created */
  backupPath?: string;
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
  private gitTool = new GitTool();
  
  /**
   * Run build command to rebuild the project after changes
   */
  private async runBuildCommand(appPath: string): Promise<void> {
    try {
      console.log('Running build after file changes...');
      return new Promise<void>((resolve) => {
        exec('npm run build', { cwd: appPath }, (error, stdout, stderr) => {
          if (error) {
            console.error(`Build error: ${error}`);
            console.error(stderr);
            // Don't reject as we don't want to fail the file edit operation
            // just because the build failed
            resolve();
            return;
          }
          
          console.log('Build completed successfully');
          console.log(stdout);
          resolve();
        });
      });
    } catch (error) {
      console.error('Failed to run build command:', error);
      // Don't throw as we don't want to fail the file edit operation
      // just because the build failed
    }
  }
  
  /**
   * Execute a file edit operation
   */
  async editFile(appPath: string, options: FileEditOptions): Promise<FileEditResult> {
    try {
      // Resolve the file path within the app directory
      const filePath = this.resolveFilePath(appPath, options.path);
      
      // Auto-detect mode if not specified
      const mode = options.mode || await this.detectMode(filePath, options);
      
      // Route to appropriate handler
      switch (mode) {
        case 'create':
          return await this.handleCreate(filePath, options, appPath);
        case 'rewrite':
          return await this.handleRewrite(filePath, options, appPath);
        case 'edit':
          return await this.handleEdit(filePath, options, appPath);
        default:
          throw new Error(`Unknown edit mode: ${mode}`);
      }
    } catch (error) {
      return {
        success: false,
        path: options.path,
        mode: 'edit',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Resolve file path safely within the app directory
   */
  private resolveFilePath(appPath: string, relativePath: string): string {
    const resolved = resolve(appPath, relativePath);
    
    // Ensure the file is within the app directory
    if (!resolved.startsWith(appPath)) {
      throw new Error('File path must be within the app directory');
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
  private async handleCreate(filePath: string, options: FileEditOptions, appPath: string): Promise<FileEditResult> {
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
      await this.autoCommitChanges(appPath, filePath, options, result);
    }

    // Auto-build if enabled
    if (options.autoBuild !== false && !options.dryRun) {
      await this.runBuildCommand(appPath);
    }

    return result;
  }

  /**
   * Handle rewriting an entire file
   */
  private async handleRewrite(filePath: string, options: FileEditOptions, appPath: string): Promise<FileEditResult> {
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
    let backupPath: string | undefined;

    // Read original content if file exists
    if (existsSync(filePath)) {
      try {
        originalContent = await readFile(filePath, 'utf-8');
        
        // Create backup if requested
        if (options.backup !== false && !options.dryRun) {
          backupPath = await this.createBackup(filePath, originalContent);
        }
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
      ...(backupPath ? { backupPath } : {}),
      changes,
    };

    // Auto-commit if enabled
    if (options.autoCommit && !options.dryRun) {
      await this.autoCommitChanges(appPath, filePath, options, result);
    }

    // Auto-build if enabled
    if (options.autoBuild !== false && !options.dryRun) {
      await this.runBuildCommand(appPath);
    }

    return result;
  }

  /**
   * Handle partial file edits
   */
  private async handleEdit(filePath: string, options: FileEditOptions, appPath: string): Promise<FileEditResult> {
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
    let backupPath: string | undefined;

    // Create backup if requested
    if (options.backup !== false && !options.dryRun) {
      backupPath = await this.createBackup(filePath, originalContent);
    }

    // Apply edits
    const editResults: string[] = [];
    for (const edit of options.edits) {
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
    }

    const changes = this.calculateChanges(originalContent, content);

    const result: FileEditResult = {
      success: true,
      path: options.path,
      mode: 'edit',
      diff,
      changes,
    };
    
    if (backupPath) {
      result.backupPath = backupPath;
    }
    
    if (editResults.length > 0) {
      result.warning = editResults.join('\n');
    }
    
    // Auto-commit if enabled
    if (options.autoCommit && !options.dryRun) {
      await this.autoCommitChanges(appPath, filePath, options, result);
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
   * Create a backup of the original file
   */
  private async createBackup(filePath: string, content: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.backup-${timestamp}`;
    
    await writeFile(backupPath, content, 'utf-8');
    return backupPath;
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
  private async autoCommitChanges(appPath: string, filePath: string, options: FileEditOptions, result: FileEditResult): Promise<void> {
    try {
      // Only proceed if auto-commit is enabled and the operation was successful
      if (!options.autoCommit || !result.success || options.dryRun) {
        return;
      }

      // First, add the changed file to git
      const relativePath = relative(appPath, filePath);
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
      console.error('Failed to auto-commit changes:', error);
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
    
    if (result.backupPath) {
      lines.push(`💾 **Backup created**: \`${result.backupPath}\``);
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
