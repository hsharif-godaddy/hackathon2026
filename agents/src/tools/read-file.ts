import { readFile } from 'fs/promises';
import { join, resolve, basename, relative } from 'path';
import { existsSync, lstatSync, realpathSync } from 'fs';
import { translateDockerPath } from '../utils/path-helper.js';

export interface ReadFileOptions {
  /** Path to the file to read (relative to app root) */
  path: string;
  /** Starting line number (1-indexed, optional) */
  startLine?: number;
  /** Number of lines to read from start line (optional, reads to end if not specified) */
  numLines?: number;
}

export interface ReadFileResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path that was read */
  path: string;
  /** File content (with line numbers if partial read) */
  content: string;
  /** Total number of lines in the file */
  totalLines: number;
  /** Lines that were actually read (start and end line numbers) */
  linesRead?: {
    start: number;
    end: number;
  };
  /** Error message if operation failed */
  error?: string;
  /** File size in bytes */
  fileSize?: number;
}

/**
 * Check if a file should be blocked from reading based on AI development guardrails
 */
export function isFileBlocked(filePath: string): { blocked: boolean; reason?: string } {
  const fileName = basename(filePath);
  // const dirPath = dirname(filePath);
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Lock files (auto-generated dependency trees)
  const lockFilePatterns = [
    'package-lock.json',
    'pnpm-lock.yaml', 
    'yarn.lock',
    'composer.lock',
    'Gemfile.lock',
    'Pipfile.lock',
    'poetry.lock'
  ];

  if (lockFilePatterns.some(pattern => fileName === pattern) || 
      fileName.includes('lock') && (fileName.endsWith('.json') || fileName.endsWith('.yaml') || fileName.endsWith('.yml'))) {
    return {
      blocked: true,
      reason: 'Lock files contain thousands of lines of auto-generated dependency data that waste tokens and provide no value for development tasks'
    };
  }

  // Node modules and dependency directories
  if (normalizedPath.includes('node_modules/') || 
      normalizedPath.includes('vendor/') ||
      normalizedPath.includes('.pnpm/') ||
      normalizedPath.includes('.yarn/')) {
    return {
      blocked: true,
      reason: 'Dependency directories contain external code that is not relevant for development tasks'
    };
  }

  // Build output directories - DISABLED to allow reading build files
  // const buildDirectories = ['dist/', 'build/', '.next/', '.nuxt/', 'out/', 'public/build/', 'target/', 'bin/', 'obj/'];
  // if (buildDirectories.some(dir => normalizedPath.includes(dir))) {
  //   return {
  //     blocked: true,
  //     reason: 'Build output files are generated and not useful for development tasks'
  //   };
  // }

  // Cache directories
  const cacheDirectories = ['.cache/', '.vite/', '.turbo/', '.parcel-cache/', '.rollup.cache/', 'tmp/', 'temp/'];
  if (cacheDirectories.some(dir => normalizedPath.includes(dir))) {
    return {
      blocked: true,
      reason: 'Cache directories contain temporary files that are not relevant for development'
    };
  }

  // Log files
  if (fileName.endsWith('.log') || 
      fileName.includes('.log.') ||
      normalizedPath.includes('logs/') ||
      fileName.startsWith('npm-debug') ||
      fileName.startsWith('yarn-error') ||
      fileName.startsWith('pnpm-debug')) {
    return {
      blocked: true,
      reason: 'Log files contain runtime output that is not useful for code development'
    };
  }

  // Large binary or data files that are typically not useful for AI
  const binaryExtensions = ['.zip', '.tar', '.gz', '.rar', '.7z', '.db', '.sqlite', '.sqlite3', '.bin', '.exe', '.dll', '.so'];
  if (binaryExtensions.some(ext => fileName.endsWith(ext))) {
    return {
      blocked: true,
      reason: 'Binary files are not readable text and not useful for development tasks'
    };
  }

  return { blocked: false };
}

/**
 * Tool for reading file contents with optional line range support
 */
export class ReadFileTool {
  /**
   * Validate that a file path is within the app directory and check for escaping symlinks
   */
  private isPathSafe(filePath: string, appPath: string): boolean {
    try {
      const resolved = resolve(filePath);
      
      // Check using relative() to prevent prefix confusion
      const rel = relative(appPath, resolved);
      if (rel.startsWith('..')) {
        return false;
      }
      
      // Check for symlinks that escape
      this.validateNoEscapingSymlinks(resolved, appPath);
      
      return true;
    } catch (error) {
      // If validation throws, path is not safe
      return false;
    }
  }

  /**
   * Validate that no symlinks in the path chain point outside the app directory
   */
  private validateNoEscapingSymlinks(targetPath: string, appPath: string): void {
    const pathParts = relative(appPath, targetPath).split('/').filter(Boolean);
    let currentPath = appPath;
    
    for (const part of pathParts) {
      currentPath = resolve(currentPath, part);
      
      if (existsSync(currentPath)) {
        try {
          const stats = lstatSync(currentPath);
          
          if (stats.isSymbolicLink()) {
            const realPath = realpathSync(currentPath);
            
            // Ensure the real path is within the app directory
            const rel = relative(appPath, realPath);
            if (rel.startsWith('..')) {
              throw new Error(
                `Security violation: symlink points outside the app directory. ` +
                `Link: ${currentPath}, Target: ${realPath}, App path: ${appPath}`
              );
            }
            
            // NOTE: We do NOT update currentPath here to continue checking the original path structure
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes('Security violation')) {
            throw error;
          }
          // For other errors, continue
        }
      }
    }
  }

  /**
   * Create a summary of the file read operation for conversation history
   */
  summarizeOperation(options: ReadFileOptions, result: ReadFileResult): string {
    if (!result.success) {
      return `Failed to read ${result.path}: ${result.error}`;
    }

    const fileName = result.path.split('/').pop() || result.path;
    const sizeInfo = result.fileSize ? this.formatFileSize(result.fileSize) : '';

    if (result.linesRead) {
      // Partial read with line range
      const lineRange = result.linesRead.start === result.linesRead.end
        ? `line ${result.linesRead.start}`
        : `lines ${result.linesRead.start}-${result.linesRead.end}`;
      return `Read ${fileName} ${lineRange} (${result.totalLines} total lines${sizeInfo ? ', ' + sizeInfo : ''}) with line numbers`;
    } else {
      // Full file read (always includes line numbers)
      return `Read ${fileName} (${result.totalLines} lines${sizeInfo ? ', ' + sizeInfo : ''}) with line numbers`;
    }
  }

  /**
   * Format file size in human readable format
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * Read a file with optional line range
   */
  async readFile(options: ReadFileOptions, appPath: string): Promise<ReadFileResult> {
    try {
      const normalizedPath = translateDockerPath(options.path);
      const fullPath = resolve(join(appPath, normalizedPath));
      
      // Security check: ensure the path is within the app directory and no escaping symlinks
      if (!this.isPathSafe(fullPath, resolve(appPath))) {
        return {
          success: false,
          path: options.path,
          content: '',
          totalLines: 0,
          error: 'Access denied: path is outside the app directory or contains unsafe symlinks',
        };
      }

      // AI Development Guardrails: Check if file should be blocked
      const blockCheck = isFileBlocked(normalizedPath);
      if (blockCheck.blocked) {
        return {
          success: false,
          path: options.path,
          content: '',
          totalLines: 0,
          error: `File blocked: ${blockCheck.reason}`,
        };
      }

      // Check if file exists
      if (!existsSync(fullPath)) {
        return {
          success: false,
          path: options.path,
          content: '',
          totalLines: 0,
          error: 'File does not exist',
        };
      }

      // Read the file
      const fileContent = await readFile(fullPath, 'utf-8');
      const lines = fileContent.split('\n');
      const totalLines = lines.length;

      // Get file stats for size
      const stats = await import('fs/promises').then(fs => fs.stat(fullPath));
      const fileSize = stats.size;

      // Validate line range parameters (if provided)
      const startLine = Math.max(1, options.startLine || 1);
      if (options.startLine && startLine > totalLines) {
        return {
          success: false,
          path: options.path,
          content: '',
          totalLines,
          error: `Start line ${startLine} is beyond the end of the file (${totalLines} lines)`,
        };
      }

      // Calculate end line
      let endLine: number;
      if (options.numLines) {
        endLine = Math.min(totalLines, startLine + options.numLines - 1);
      } else {
        endLine = totalLines;
      }

      // Extract the requested lines (convert to 0-indexed)
      const startIndex = startLine - 1;
      const endIndex = endLine;
      const selectedLines = lines.slice(startIndex, endIndex);

      // ALWAYS format content with line numbers for better code editing workflow
      const formattedContent = selectedLines
        .map((line, index) => `${String(startLine + index).padStart(6)}|${line}`)
        .join('\n');

      return {
        success: true,
        path: options.path,
        content: formattedContent,
        totalLines,
        // Only include linesRead if a range was explicitly requested
        ...(options.startLine || options.numLines ? {
          linesRead: {
            start: startLine,
            end: endLine,
          }
        } : {}),
        fileSize,
      };
    } catch (error) {
      return {
        success: false,
        path: options.path,
        content: '',
        totalLines: 0,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
