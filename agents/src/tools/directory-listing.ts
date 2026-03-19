import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import { existsSync } from 'fs';
import { logger } from '../logging/index.js';
import { toolDirectoryListingEvents } from '../logging/events/index.js';

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
  /** Additional patterns to ignore (added to default ignores) */
  ignorePatterns?: string[];
  /** Disable default ignore patterns */
  disableDefaultIgnores?: boolean;
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

interface TreeNode {
  /** Name of the file or directory */
  name: string;
  /** Full path relative to the app root */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Size in bytes (for files) */
  size: number | undefined;
  /** Child nodes */
  children: TreeNode[];
}

/**
 * Directory Listing Tool
 * Provides a comprehensive directory tree listing with filtering capabilities
 */
export class DirectoryListingTool {
  private readonly MAX_ENTRIES = 1000; // Prevent overwhelming responses

  /**
   * Default patterns to ignore during directory traversal
   */
  private readonly DEFAULT_IGNORE_PATTERNS = [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    'out',
    'target',
    '.next',
    '.nuxt',
    '.vscode',
    '.idea',
    '*.log',
    'npm-debug.log*',
    'yarn-debug.log*',
    'yarn-error.log*',
    '.DS_Store',
    'Thumbs.db',
    '*.tmp',
    '*.temp',
    '.cache',
    '.parcel-cache',
    'coverage',
    '.coverage',
    '.nyc_output',
    '__pycache__',
    '*.pyc',
    '*.pyo',
    '*.pyd',
    '.pytest_cache',
    '.mypy_cache',
    '.tox',
    'venv',
    'env',
    '.env.local',
    '.env.*.local',
    
    // Lock files (sync with isFileBlocked in read-file.ts)
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'composer.lock',
    'Gemfile.lock',
    'Pipfile.lock',
    'poetry.lock',

    // things in the template we want to hide for now
    'dev-supervisor',
    'dev-tools',
    'airo-secrets',
    'source-mapper',
    'fullstory-plugin.ts',
  ];

  /**
   * List directory contents as a tree structure
   */
  async listDirectory(
    appPath: string,
    options: DirectoryListingOptions = {},
    context?: { appId?: string }
  ): Promise<DirectoryTreeResult> {
    const {
      path: relativePath = '',
      directoriesOnly = false,
      pattern,
      search,
      maxDepth = Infinity,
      showHidden = false,
      ignorePatterns = [],
      disableDefaultIgnores = false,
    } = options;

    // Construct the target path, ensuring it's within the app directory
    let targetPath: string;
    try {
      targetPath = this.resolveSafePath(appPath, relativePath);
    } catch (error) {
      toolDirectoryListingEvents.failure(logger, error as Error, {
        toolName: 'DirectoryListingTool',
        targetPath: relativePath || '.',
        ...(context?.appId && { appId: context.appId }),
      });
      throw error;
    }

    // Log the beginning of the directory listing operation
    toolDirectoryListingEvents.begin(logger, {
      toolName: 'DirectoryListingTool',
      targetPath: relative(appPath, targetPath) || '.',
      ...(context?.appId && { appId: context.appId }),
      options: {
        directoriesOnly,
        ...(pattern && { pattern }),
        ...(search && { search }),
        ...(maxDepth !== Infinity && { maxDepth }),
        showHidden,
        ...(ignorePatterns.length > 0 && { ignorePatterns }),
      },
    });

    // Combine default ignores with user-provided ignores
    const allIgnorePatterns = disableDefaultIgnores
      ? ignorePatterns
      : [...this.DEFAULT_IGNORE_PATTERNS, ...ignorePatterns];

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
        showHidden,
        allIgnorePatterns,
        context
      );

      // Log successful completion
      toolDirectoryListingEvents.success(logger, {
        toolName: 'DirectoryListingTool',
        targetPath: relative(appPath, targetPath) || '.',
        ...(context?.appId && { appId: context.appId }),
        options: {
          directoriesOnly,
          ...(pattern && { pattern }),
          ...(search && { search }),
          ...(maxDepth !== Infinity && { maxDepth }),
          showHidden,
          ...(ignorePatterns.length > 0 && { ignorePatterns }),
        },
        resultStats: {
          totalEntries: result.totalEntries,
          directoryCount: result.directoryCount,
          fileCount: result.fileCount,
          truncated: result.truncated,
          errorCount: result.errors.length,
        },
      });
    } catch (error) {
      result.errors.push(`Failed to read directory: ${error instanceof Error ? error.message : String(error)}`);

      toolDirectoryListingEvents.failure(logger, error as Error, {
        toolName: 'DirectoryListingTool',
        targetPath: relative(appPath, targetPath) || '.',
        ...(context?.appId && { appId: context.appId }),
      });
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
    showHidden: boolean = false,
    ignorePatterns: string[] = [],
    context?: { appId?: string }
  ): Promise<void> {
    if (depth > maxDepth || result.entries.length >= this.MAX_ENTRIES) {
      if (result.entries.length >= this.MAX_ENTRIES) {
        result.truncated = true;
        // Only log truncation at debug level to reduce noise
        logger.debug('Directory listing truncated due to max entries limit', {
          toolName: 'DirectoryListingTool',
          currentPath: relative(appPath, currentPath),
          maxEntries: this.MAX_ENTRIES,
          ...(context?.appId && { appId: context.appId }),
        });
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

        // Skip entries matching ignore patterns
        if (this.shouldIgnore(entry, ignorePatterns)) {
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
              showHidden,
              ignorePatterns,
              context
            );
          } else {
            result.fileCount++;
          }
        } catch (error) {
          const errorMessage = `Failed to stat ${relativePath}: ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMessage);

          // Only log stat errors at debug level to reduce noise
          logger.debug('File stat error', {
            toolName: 'DirectoryListingTool',
            currentPath: relativePath,
            depth,
            error: error instanceof Error ? error.message : String(error),
            ...(context?.appId && { appId: context.appId }),
          });
        }
      }
    } catch (error) {
      const errorMessage = `Failed to read directory ${relative(appPath, currentPath)}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMessage);

      // Only log directory read errors at debug level to reduce noise
      logger.debug('Directory read error', {
        toolName: 'DirectoryListingTool',
        currentPath: relative(appPath, currentPath),
        depth,
        error: error instanceof Error ? error.message : String(error),
        ...(context?.appId && { appId: context.appId }),
      });
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
   * Check if an entry should be ignored based on ignore patterns
   */
  private shouldIgnore(entryName: string, ignorePatterns: string[]): boolean {
    return ignorePatterns.some(pattern => this.matchesPattern(entryName, pattern));
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
      const error = new Error('Path is outside the allowed app directory');
      logger.warn('Directory listing path validation failed', {
        appPath,
        relativePath,
        resolvedPath: normalized,
        reason: 'path_outside_app_directory',
      });
      throw error;
    }

    // Check if path exists
    if (!existsSync(normalized)) {
      const error = new Error(`Path does not exist: ${relativePath || '.'}`);
      logger.warn('Directory listing path not found', {
        appPath,
        relativePath,
        resolvedPath: normalized,
        reason: 'path_not_found',
      });
      throw error;
    }

    return normalized;
  }

  /**
   * Format the result as a tree view string
   */
  formatAsTree(result: DirectoryTreeResult): string {
    const lines: string[] = [];

    lines.push(`${result.rootPath} (${result.directoryCount} dirs, ${result.fileCount} files)`);

    if (result.errors.length > 0) {
      lines.push(`${result.errors.length} errors`);
    }

    if (result.truncated) {
      lines.push(`truncated (${this.MAX_ENTRIES}+ items)`);
    }

    if (lines.length > 1) lines.push('');

    // Build a hierarchical structure for proper tree rendering
    const treeStructure = this.buildTreeStructure(result.entries);

    // Render the tree with proper markers
    const treeLines = this.renderTreeNode(treeStructure, '', true);
    lines.push(...treeLines);

    if (result.errors.length > 0) {
      lines.push('');
      lines.push('Errors:');
      for (const error of result.errors) {
        lines.push(`${error}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Build a hierarchical tree structure from flat entries
   */
  private buildTreeStructure(entries: DirectoryEntry[]): TreeNode {
    const root: TreeNode = { name: '', path: '', isDirectory: true, size: undefined, children: [] };
    const nodeMap = new Map<string, TreeNode>();
    nodeMap.set('', root);

    // Sort entries by path to ensure parents are processed before children
    const sortedEntries = entries.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.path.localeCompare(b.path);
    });

    for (const entry of sortedEntries) {
      const node: TreeNode = {
        name: entry.name,
        path: entry.path,
        isDirectory: entry.isDirectory,
        size: entry.size,
        children: []
      };

      nodeMap.set(entry.path, node);

      // Find parent path
      const pathParts = entry.path.split('/').filter(part => part.length > 0);
      const parentPath = pathParts.slice(0, -1).join('/');

      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        root.children.push(node);
      }
    }

    // Sort children: directories first, then alphabetically
    this.sortTreeNodes(root);

    return root;
  }

  /**
   * Recursively sort tree nodes
   */
  private sortTreeNodes(node: TreeNode): void {
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of node.children) {
      this.sortTreeNodes(child);
    }
  }

  /**
   * Render a tree node with proper ASCII tree markers
   */
  private renderTreeNode(node: TreeNode, prefix: string, isLast: boolean): string[] {
    const lines: string[] = [];

    // Skip rendering the root node itself
    if (node.name) {
      const marker = isLast ? '└── ' : '├── ';
      const dirMarker = node.isDirectory ? '/' : '';
      const size = node.size !== undefined ? ` ${this.formatSize(node.size)}` : '';
      lines.push(`${prefix}${marker}${node.name}${dirMarker}${size}`);
    }

    // Render children
    const childPrefix = node.name ?
      (prefix + (isLast ? '    ' : '│   ')) :
      '';

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child) {
        const isLastChild = i === node.children.length - 1;
        const childLines = this.renderTreeNode(child, childPrefix, isLastChild);
        lines.push(...childLines);
      }
    }

    return lines;
  }

  /**
   * Format file size in human-readable format
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'K', 'M', 'G'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return unitIndex === 0 ? `${size}B` : `${Math.round(size)}${units[unitIndex]}`;
  }
}
