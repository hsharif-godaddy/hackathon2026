import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

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
 * Tool for reading file contents with optional line range support
 */
export class ReadFileTool {
  /**
   * Read a file with optional line range
   */
  async readFile(options: ReadFileOptions, appPath: string): Promise<ReadFileResult> {
    try {
      const fullPath = resolve(join(appPath, options.path));
      
      // Security check: ensure the path is within the app directory
      if (!fullPath.startsWith(resolve(appPath))) {
        return {
          success: false,
          path: options.path,
          content: '',
          totalLines: 0,
          error: 'Access denied: path is outside the app directory',
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

      // If no line range specified, return the entire file
      if (!options.startLine && !options.numLines) {
        return {
          success: true,
          path: options.path,
          content: fileContent,
          totalLines,
          fileSize,
        };
      }

      // Validate line range parameters
      const startLine = Math.max(1, options.startLine || 1);
      if (startLine > totalLines) {
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

      // Format content with line numbers
      const formattedContent = selectedLines
        .map((line, index) => `${String(startLine + index).padStart(6)}|${line}`)
        .join('\n');

      return {
        success: true,
        path: options.path,
        content: formattedContent,
        totalLines,
        linesRead: {
          start: startLine,
          end: endLine,
        },
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
