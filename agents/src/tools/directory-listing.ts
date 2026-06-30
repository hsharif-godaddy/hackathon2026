import { logger } from '../logging/index.js';
import { toolDirectoryListingEvents } from '../logging/events/index.js';
import { isDevSupervisorNotFound } from '../services/DevSupervisorClient.js';
import { PLATFORM_INFRASTRUCTURE_PATHS } from '../utils/platform-paths.js';
import type { TreeOptions, WorkspaceFiles } from '../workspace/files.js';

/**
 * Thrown by `DirectoryListingTool.listDirectory` when the requested path does
 * not exist in the preview workspace. Distinct from a transport failure: HTTP
 * routes should map this to 404, not 500.
 */
export class DirectoryListingNotFoundError extends Error {
  public readonly path: string;
  constructor(targetPath: string) {
    super(`Path does not exist: ${targetPath}`);
    this.name = 'DirectoryListingNotFoundError';
    this.path = targetPath;
  }
}

export interface DirectoryListingOptions {
  /** The path within the workspace to list (defaults to workspace root) */
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
  /** Full path relative to the workspace root */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Size in bytes (for files) */
  size?: number;
  /** Last modified date */
  modified: string;
  /** Depth relative to the requested path (0 = direct child of `path`). */
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
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | undefined;
  children: TreeNode[];
}

/**
 * Directory Listing Tool
 *
 * Walks the preview workspace via dev-supervisor's `workspace.files.tree` API.
 * The agent process never reads the host filesystem directly — every traversal
 * goes through the WorkspaceFiles client bound to a specific app workspace.
 */
export class DirectoryListingTool {
  /** Default basename patterns excluded from traversal (skips matching subtrees server-side). */
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

    ...PLATFORM_INFRASTRUCTURE_PATHS,
  ];

  constructor(private readonly files: WorkspaceFiles) {}

  /**
   * List directory contents as a tree structure
   */
  async listDirectory(
    options: DirectoryListingOptions = {},
    context?: { appId?: string },
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

    const targetPath = relativePath.replace(/^\/+|\/+$/g, '');
    const rootLabel = targetPath || '.';

    toolDirectoryListingEvents.begin(logger, {
      toolName: 'DirectoryListingTool',
      targetPath: rootLabel,
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

    const allIgnorePatterns = disableDefaultIgnores
      ? ignorePatterns
      : [...this.DEFAULT_IGNORE_PATTERNS, ...ignorePatterns];

    const result: DirectoryTreeResult = {
      rootPath: rootLabel,
      totalEntries: 0,
      directoryCount: 0,
      fileCount: 0,
      entries: [],
      truncated: false,
    };

    // Map maxDepth to the dev-supervisor API:
    //   Infinity → recursive, no maxDepth (server uses its own ceiling)
    //   0        → flat (immediate children only)
    //   N > 0    → recursive walk to depth N
    const treeOpts: TreeOptions = {
      ...(targetPath && { path: targetPath }),
      recursive: maxDepth !== 0,
      ...(Number.isFinite(maxDepth) && maxDepth > 0 && { maxDepth }),
      // Drop files server-side so they never count against the entry cap;
      // directories are still descended into to surface nested ones.
      ...(directoriesOnly && { kindFilter: 'directory' as const }),
      ...(allIgnorePatterns.length > 0 && { excludeGlobs: allIgnorePatterns }),
    };

    let tree;
    try {
      tree = await this.files.tree(treeOpts);
    } catch (error) {
      const wrapped = isDevSupervisorNotFound(error)
        ? new DirectoryListingNotFoundError(rootLabel)
        : (error instanceof Error ? error : new Error(String(error)));

      toolDirectoryListingEvents.failure(logger, wrapped, {
        toolName: 'DirectoryListingTool',
        targetPath: rootLabel,
        ...(context?.appId && { appId: context.appId }),
      });
      throw wrapped;
    }

    if (tree.truncated) result.truncated = true;

    // tree() returns workspace-rooted paths (e.g. `src/components/Foo.tsx`
    // for a `path: 'src'` request). Compute depth, entry name, and hidden
    // checks against the path *relative to* the requested root so they don't
    // double-count `targetPath` segments.
    const targetPrefix = targetPath ? `${targetPath}/` : '';
    for (const e of tree.entries) {
      let relativePath = e.path;
      if (targetPrefix) {
        if (e.path.startsWith(targetPrefix)) {
          relativePath = e.path.slice(targetPrefix.length);
        } else {
          // tree() must return workspace-rooted paths (this PR's contract).
          // A bare entry here means the server contract regressed; surface it
          // instead of silently computing wrong depth/name/hidden values.
          logger.warn('tool.directory_listing.contract_violation', {
            targetPath,
            entryPath: e.path,
            ...(context?.appId && { appId: context.appId }),
          });
        }
      }
      const segments = relativePath.split('/');
      const entryName = segments[segments.length - 1] ?? relativePath;

      // Hidden filter: any segment starting with '.' counts as hidden.
      if (!showHidden && segments.some((s) => s.startsWith('.'))) continue;

      const isDirectory = e.kind === 'directory';

      // `directoriesOnly` is enforced server-side via kindFilter (see treeOpts).
      if (pattern && !this.matchesPattern(entryName, pattern)) continue;
      if (search && !entryName.toLowerCase().includes(search.toLowerCase())) continue;

      const fullPath = e.path;
      const depth = segments.length - 1;

      result.entries.push({
        name: entryName,
        path: fullPath,
        isDirectory,
        ...(isDirectory ? {} : { size: e.size }),
        modified: e.modifiedAt,
        depth,
      });
      result.totalEntries++;
      if (isDirectory) result.directoryCount++;
      else result.fileCount++;
    }

    toolDirectoryListingEvents.success(logger, {
      toolName: 'DirectoryListingTool',
      targetPath: rootLabel,
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
      },
    });

    return result;
  }

  /** Simple pattern matching (supports `*` and `?` wildcards) */
  private matchesPattern(filename: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      'i',
    );
    return regex.test(filename);
  }

  /** Format the result as a tree view string */
  formatAsTree(result: DirectoryTreeResult): string {
    const lines: string[] = [];

    lines.push(`${result.rootPath} (${result.directoryCount} dirs, ${result.fileCount} files)`);

    if (result.truncated) {
      lines.push(`truncated (1000+ items)`);
    }

    if (lines.length > 1) lines.push('');

    const treeStructure = this.buildTreeStructure(result.entries);
    const treeLines = this.renderTreeNode(treeStructure, '', true);
    lines.push(...treeLines);

    return lines.join('\n');
  }

  /** Build a hierarchical tree structure from flat entries */
  private buildTreeStructure(entries: DirectoryEntry[]): TreeNode {
    const root: TreeNode = { name: '', path: '', isDirectory: true, size: undefined, children: [] };
    const nodeMap = new Map<string, TreeNode>();
    nodeMap.set('', root);

    const sortedEntries = entries.slice().sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.path.localeCompare(b.path);
    });

    for (const entry of sortedEntries) {
      const node: TreeNode = {
        name: entry.name,
        path: entry.path,
        isDirectory: entry.isDirectory,
        size: entry.size,
        children: [],
      };

      nodeMap.set(entry.path, node);

      const pathParts = entry.path.split('/').filter((part) => part.length > 0);
      const parentPath = pathParts.slice(0, -1).join('/');

      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        root.children.push(node);
      }
    }

    this.sortTreeNodes(root);
    return root;
  }

  private sortTreeNodes(node: TreeNode): void {
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of node.children) {
      this.sortTreeNodes(child);
    }
  }

  private renderTreeNode(node: TreeNode, prefix: string, isLast: boolean): string[] {
    const lines: string[] = [];

    if (node.name) {
      const marker = isLast ? '└── ' : '├── ';
      const dirMarker = node.isDirectory ? '/' : '';
      const size = node.size !== undefined ? ` ${this.formatSize(node.size)}` : '';
      lines.push(`${prefix}${marker}${node.name}${dirMarker}${size}`);
    }

    const childPrefix = node.name ? prefix + (isLast ? '    ' : '│   ') : '';

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
