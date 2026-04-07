import { readFile } from 'node:fs/promises';
import { join, resolve, basename, extname, relative } from 'node:path';
import { existsSync } from 'node:fs';

import { BINARY_FILE_REGEX, DOCUMENT_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS, OTHER_BINARY_EXTENSIONS, TEXT_FILE_REGEX, isBinaryFile } from '../utils/file-types.js';
import { translateDockerPath, deriveAssetsDir, validateNoEscapingSymlinks } from '../utils/path-helper.js';

export interface ReadFileOptions {
  /** Path to the file to read (relative to app root) */
  path: string;
  /** Starting line number (1-indexed, optional) */
  startLine?: number;
  /** Number of lines to read from start line (optional, reads to end if not specified) */
  numLines?: number;
  /** Return raw content without line number prefixes (default: false) */
  raw?: boolean;
}

export interface ReadFileResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path that was read */
  path: string;
  /** File content (line-numbered by default, raw when raw option is used) */
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
      reason: 'Lock files are auto-generated — not useful for development'
    };
  }

  // Node modules and dependency directories
  if (normalizedPath.includes('node_modules/') || 
      normalizedPath.includes('vendor/') ||
      normalizedPath.includes('.pnpm/') ||
      normalizedPath.includes('.yarn/')) {
    return {
      blocked: true,
      reason: 'Dependency directory — external code, not relevant'
    };
  }

  // Cache directories
  const cacheDirectories = ['.cache/', '.vite/', '.turbo/', '.parcel-cache/', '.rollup.cache/', 'tmp/', 'temp/'];
  if (cacheDirectories.some(dir => normalizedPath.includes(dir))) {
    return {
      blocked: true,
      reason: 'Cache directory — temporary files, not relevant'
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
      reason: 'Log file — runtime output, not useful for development'
    };
  }

  // Binary files (images, fonts, audio, video, PDF, archives, databases, executables)
  // SVG is excluded — it's XML text despite being in BINARY_FILE_REGEX.
  const ext = extname(fileName).slice(1).toLowerCase();
  if ((BINARY_FILE_REGEX.test(fileName) && ext !== 'svg') || (OTHER_BINARY_EXTENSIONS as readonly string[]).includes(ext)) {

    if ((IMAGE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return {
        blocked: true,
        reason: `Cannot read image as text. Reference by path in code (e.g. src="${filePath}"). Ask the user to describe visual content if needed.`
      };
    }
    if ((DOCUMENT_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return {
        blocked: true,
        reason: `Cannot read ${ext.toUpperCase()} as text. Ask the user to paste relevant content into chat.`
      };
    }
    return {
      blocked: true,
      reason: 'Binary file — not readable as text. Reference by path in code.'
    };
  }

  return { blocked: false };
}

/**
 * Tool for reading file contents with optional line range support
 */
export class ReadFileTool {
  /**
   * Validate that a file path is within the app directory and check for escaping symlinks.
   * Allows symlinks to the known assets directory for bind mount compatibility.
   */
  private isPathSafe(filePath: string, appPath: string): boolean {
    try {
      const resolved = resolve(filePath);

      const rel = relative(appPath, resolved);
      if (rel.startsWith('..')) {
        return false;
      }

      const assetsDir = deriveAssetsDir(appPath);
      validateNoEscapingSymlinks(resolved, appPath, assetsDir ? [assetsDir] : []);

      return true;
    } catch (error) {
      return false;
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
      return `Read ${fileName} ${lineRange} of ${result.totalLines}${sizeInfo ? ' (' + sizeInfo + ')' : ''}`;
    } else {
      // Full file read (always includes line numbers)
      return `Read ${fileName} (${result.totalLines} lines${sizeInfo ? ', ' + sizeInfo : ''})`;
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
          error: 'Access denied: path outside app directory or unsafe symlinks',
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

      // Fallback: sniff first 8KB for null bytes — only for files with unknown extensions.
      // Skips known binary (already blocked above) and known text extensions to avoid redundant I/O.
      if (!BINARY_FILE_REGEX.test(normalizedPath) && !TEXT_FILE_REGEX.test(normalizedPath) && !(OTHER_BINARY_EXTENSIONS as readonly string[]).includes(extname(normalizedPath).slice(1).toLowerCase()) && await isBinaryFile(fullPath)) {
        return {
          success: false,
          path: options.path,
          content: '',
          totalLines: 0,
          error: 'File blocked: binary file detected. Reference by path in code.',
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
          error: `Start line ${startLine} exceeds file length (${totalLines} lines)`,
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

      // Format content with line numbers for AI code editing workflow (default)
      // Use raw option for programmatic consumers (UI file editor, JSON parsing)
      const content = options.raw
        ? selectedLines.join('\n')
        : selectedLines
            .map((line, index) => `${String(startLine + index).padStart(6)}|${line}`)
            .join('\n');

      return {
        success: true,
        path: options.path,
        content,
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
