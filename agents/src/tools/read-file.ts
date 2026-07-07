import { basename, extname } from 'node:path';

import type { WorkspaceFiles } from '../workspace/files.js';

import { BINARY_FILE_REGEX, DOCUMENT_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS, OTHER_BINARY_EXTENSIONS } from '../utils/file-types.js';
import { DevSupervisorError } from '../services/DevSupervisorClient.js';
import { getErrorMessage } from '../utils/error.js';
import { translateDockerPath } from '../utils/path-helper.js';

export interface ReadFileOptions {
  /** Path to the file to read (relative to app root) */
  path: string;
  /** Line offset to start reading from (0-based, optional) */
  offset?: number;
  /** Number of lines to read (optional, reads to end if not specified) */
  limit?: number;
}

export interface ReadFileResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path that was read */
  path: string;
  /** Pre-formatted content with line numbers from the server. */
  content: string;
  /** Total number of lines in the file */
  totalLines: number;
  /** Lines that were actually read (start and end line numbers) */
  linesRead?: {
    start: number;
    end: number;
  };
  /** True when the response was capped by the server's line limit */
  truncated?: boolean;
  /** Error message if operation failed */
  error?: string;
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

  // Protected platform directory — internal agent/turnscript artifacts and config.
  // Case-insensitive so `.AIRO` can't bypass it on case-insensitive filesystems.
  if (/(^|\/)\.airo(\/|$)/i.test(normalizedPath)) {
    return {
      blocked: true,
      reason: 'Protected platform directory (.airo) — not readable'
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

  const ext = extname(fileName).slice(1).toLowerCase();
  if (BINARY_FILE_REGEX.test(fileName) || (OTHER_BINARY_EXTENSIONS as readonly string[]).includes(ext)) {

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

export class ReadFileTool {
  constructor(private readonly files: WorkspaceFiles) {}

  summarizeOperation(options: ReadFileOptions, result: ReadFileResult): string {
    if (!result.success) {
      return `Failed to read ${result.path}: ${result.error}`;
    }

    const fileName = result.path.split('/').pop() || result.path;

    if (result.linesRead) {
      const lineRange = result.linesRead.start === result.linesRead.end
        ? `line ${result.linesRead.start}`
        : `lines ${result.linesRead.start}-${result.linesRead.end}`;
      const suffix = result.truncated ? ' (truncated)' : '';
      return `Read ${fileName} ${lineRange} of ${result.totalLines}${suffix}`;
    }
    return `Read ${fileName} (${result.totalLines} lines)`;
  }

  async readFile(options: ReadFileOptions): Promise<ReadFileResult> {
    try {
      const normalizedPath = translateDockerPath(options.path);

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

      const offset: number = Math.max(0, options.offset || 0);
      const limit: number | undefined = options.limit;

      const result = await this.files.view({ path: normalizedPath, offset, limit });

      const totalLines: number = result.lines;

      if (options.offset != null && offset >= totalLines) {
        return {
          success: false,
          path: options.path,
          content: '',
          totalLines,
          error: `Offset ${offset} exceeds file length (${totalLines} lines)`,
        };
      }

      const lineCount: number = result.content === '' ? 0 : result.content.split('\n').length;
      const endLine: number = Math.min(offset + lineCount, totalLines);
      const includeRange: boolean = options.offset != null || !!options.limit || result.truncated;

      return {
        success: true,
        path: options.path,
        content: result.content,
        totalLines,
        ...(includeRange ? {
          linesRead: {
            start: offset + 1,
            end: endLine,
          }
        } : {}),
        ...(result.truncated ? { truncated: true } : {}),
      };
    } catch (error) {
      if (error instanceof DevSupervisorError && error.code === 'binary_file') {
        const ext: string = extname(options.path).slice(1).toLowerCase();
        const reason: string = (IMAGE_FILE_EXTENSIONS as readonly string[]).includes(ext)
          ? `Cannot read image as text. Reference by path in code (e.g. src="${options.path}"). Ask the user to describe visual content if needed.`
          : 'Binary file — not readable as text. Reference by path in code.';
        return {
          success: false,
          path: options.path,
          content: '',
          totalLines: 0,
          error: reason,
        };
      }
      return {
        success: false,
        path: options.path,
        content: '',
        totalLines: 0,
        error: getErrorMessage(error),
      };
    }
  }
}
