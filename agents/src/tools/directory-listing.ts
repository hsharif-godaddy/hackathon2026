import { readdir, stat } from 'fs/promises';
import { join, relative, basename } from 'path';
import { existsSync } from 'fs';

export interface DirectoryListingOptions {
  /** The path to list (defaults to app root) */
  path?: string;
  /** Only show directories, not files */
  directoriesOnly?: boolean;
  /** Pattern to filter entries (simple glob-like matching) */
  pattern?: string;
  /** Search for entries containing this text */
  search?: string;
  /** Maximum depth to traverse (defaults to unlimited) */
  maxDepth?: number;
  /** Show hidden files/directories (starting with .) */
  showHidden?: boolean;
}

export interface DirectoryEntry {
  /** Name of the file or directory */
  name: string;
  /** Full path relative to the app root */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Size in bytes (for files) */
  size?: number;
  /** Last modified date */
  modified: string;
  /** Depth level from the root */
  depth: number;
}

export interface DirectoryTreeResult {
  /** The root path that was listed */
  rootPath: string;
  /** Total number of entries found */
  totalEntries: number;
  /** Number of directories found */
  directoryCount: number;
  /** Number of files found */
  fileCount: number;
  /** The directory tree entries */
  entries: DirectoryEntry[];
  /** Whether the listing was truncated due to size limits */
  truncated: boolean;
  /** Any errors encountered during listing */
  errors: string[];
}

/**
 * Directory Listing Tool
 * Provides a comprehensive directory tree listing with filtering capabilities
 */
export class DirectoryListingTool {
  private readonly MAX_ENTRIES = 1000; // Prevent overwhelming responses
  
  /**
   * List directory contents as a tree structure
   */
  async listDirectory(
    appPath: string,
    options: DirectoryListingOptions = {}
  ): Promise<DirectoryTreeResult> {
    const {
      path: relativePath = '',
      directoriesOnly = false,
      pattern,
      search,
      maxDepth = Infinity,
      showHidden = false,
    } = options;

    // Construct the target path, ensuring it's within the app directory
    const targetPath = this.resolveSafePath(appPath, relativePath);
    
    const result: DirectoryTreeResult = {
      rootPath: relative(appPath, targetPath) || '.',
      totalEntries: 0,
      directoryCount: 0,
      fileCount: 0,
      entries: [],
      truncated: false,
      errors: [],
    };

    try {
      await this.walkDirectory(
        targetPath,
        appPath,
        result,
        0,
        maxDepth,
        directoriesOnly,
        pattern,
        search,
        showHidden
      );
    } catch (error) {
      result.errors.push(`Failed to read directory: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Recursively walk directory structure
   */
  private async walkDirectory(
    currentPath: string,
    appPath: string,
    result: DirectoryTreeResult,
    depth: number,
    maxDepth: number,
    directoriesOnly: boolean,
    pattern?: string,
    search?: string,
    showHidden: boolean = false
  ): Promise<void> {
    if (depth > maxDepth || result.entries.length >= this.MAX_ENTRIES) {
      if (result.entries.length >= this.MAX_ENTRIES) {
        result.truncated = true;
      }
      return;
    }

    try {
      const entries = await readdir(currentPath);
      
      for (const entry of entries) {
        if (result.entries.length >= this.MAX_ENTRIES) {
          result.truncated = true;
          break;
        }

        const fullPath = join(currentPath, entry);
        const relativePath = relative(appPath, fullPath);

        // Skip hidden files/directories unless explicitly requested
        if (!showHidden && entry.startsWith('.')) {
          continue;
        }

        try {
          const stats = await stat(fullPath);
          const isDirectory = stats.isDirectory();

          // Apply directory-only filter
          if (directoriesOnly && !isDirectory) {
            continue;
          }

          // Apply pattern filter
          if (pattern && !this.matchesPattern(entry, pattern)) {
            continue;
          }

          // Apply search filter
          if (search && !entry.toLowerCase().includes(search.toLowerCase())) {
            continue;
          }

          const directoryEntry: DirectoryEntry = {
            name: entry,
            path: relativePath,
            isDirectory,
            ...(isDirectory ? {} : { size: stats.size }),
            modified: stats.mtime.toISOString(),
            depth,
          };

          result.entries.push(directoryEntry);
          result.totalEntries++;

          if (isDirectory) {
            result.directoryCount++;
            // Recursively process subdirectories
            await this.walkDirectory(
              fullPath,
              appPath,
              result,
              depth + 1,
              maxDepth,
              directoriesOnly,
              pattern,
              search,
              showHidden
            );
          } else {
            result.fileCount++;
          }
        } catch (error) {
          result.errors.push(`Failed to stat ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      result.errors.push(`Failed to read directory ${relative(appPath, currentPath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Simple pattern matching (supports * wildcard)
   */
  private matchesPattern(filename: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      'i'
    );
    return regex.test(filename);
  }

  /**
   * Resolve a path safely within the app directory
   * Prevents directory traversal attacks
   */
  private resolveSafePath(appPath: string, relativePath: string): string {
    const resolved = join(appPath, relativePath);
    const normalized = join(resolved); // Normalize the path
    
    // Ensure the resolved path is within the app directory
    if (!normalized.startsWith(appPath)) {
      throw new Error('Path is outside the allowed app directory');
    }

    // Check if path exists
    if (!existsSync(normalized)) {
      throw new Error(`Path does not exist: ${relativePath || '.'}`);
    }

    return normalized;
  }

  /**
   * Format the result as a tree view string
   */
  formatAsTree(result: DirectoryTreeResult): string {
    const lines: string[] = [];
    
    lines.push(`📁 ${result.rootPath}`);
    lines.push(`   ${result.totalEntries} items (${result.directoryCount} directories, ${result.fileCount} files)`);
    
    if (result.errors.length > 0) {
      lines.push(`   ⚠️  ${result.errors.length} errors occurred`);
    }
    
    if (result.truncated) {
      lines.push(`   ⚠️  Results truncated (showing first ${this.MAX_ENTRIES} items)`);
    }
    
    lines.push('');

    // Group entries by depth for better tree visualization
    const entriesByDepth = new Map<number, DirectoryEntry[]>();
    for (const entry of result.entries) {
      if (!entriesByDepth.has(entry.depth)) {
        entriesByDepth.set(entry.depth, []);
      }
      entriesByDepth.get(entry.depth)!.push(entry);
    }

    // Sort and display entries
    const sortedEntries = result.entries.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sortedEntries) {
      const indent = '  '.repeat(entry.depth + 1);
      const icon = entry.isDirectory ? '📁' : '📄';
      const size = entry.size !== undefined ? ` (${this.formatSize(entry.size)})` : '';
      lines.push(`${indent}${icon} ${entry.name}${size}`);
    }

    if (result.errors.length > 0) {
      lines.push('');
      lines.push('Errors:');
      for (const error of result.errors) {
        lines.push(`  ❌ ${error}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format file size in human-readable format
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(unitIndex > 0 ? 1 : 0)}${units[unitIndex]}`;
  }
}
