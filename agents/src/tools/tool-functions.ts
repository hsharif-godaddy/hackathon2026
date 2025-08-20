import { DirectoryListingTool, DirectoryListingOptions } from './directory-listing.js';
import { TerminalTool, TerminalCommandOptions } from './terminal.js';
import { FileEditTool, FileEditOptions } from './file-edit.js';
import { GitTool, GitToolOptions } from './git-tool.js';
import { ReadFileTool, ReadFileOptions } from './read-file.js';
import { GrepTool, GrepOptions, GrepOptionsSchema } from './grep-tool.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { TokenUsageRepository } from '../database/repositories/TokenUsageRepository.js';
import type { AgentExecutionContext } from '../base/index.js';

const directoryTool = new DirectoryListingTool();
const terminalTool = new TerminalTool();
const fileEditTool = new FileEditTool();
const gitTool = new GitTool();
const readFileTool = new ReadFileTool();
const grepTool = new GrepTool();
const appRepo = new AppRepository();
const tokenUsageRepo = new TokenUsageRepository();

/**
 * OpenAI Function definitions for our tools
 */
export const TOOL_FUNCTIONS = {
  directory_listing: {
    name: 'directory_listing',
    description: 'List directory contents as a tree structure with filtering options. Always limited to the current app\'s directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path within the app to list (default: root)',
          default: '',
        },
        directoriesOnly: {
          type: 'boolean',
          description: 'Show only directories, not files',
          default: false,
        },
        pattern: {
          type: 'string',
          description: 'Pattern to filter entries (supports * wildcard)',
        },
        search: {
          type: 'string',
          description: 'Search for entries containing this text',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to traverse (default: unlimited)',
          minimum: 0,
        },
        showHidden: {
          type: 'boolean',
          description: 'Show hidden files/directories (starting with .)',
          default: false,
        },
      },
      required: [],
    },
  },
  terminal_command: {
    name: 'terminal_command',
    description: 'Execute shell commands within the app directory. Use for development tasks like npm install, git operations, building, testing, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (e.g., "npm install", "git status", "ls -la")',
        },
        workingDir: {
          type: 'string',
          description: 'Working directory relative to app root (default: app root)',
          default: '',
        },
        timeout: {
          type: 'number',
          description: 'Maximum execution time in milliseconds (default: 30000, max: 300000)',
          minimum: 1000,
          maximum: 300000,
          default: 30000,
        },
        env: {
          type: 'object',
          description: 'Environment variables to set for the command',
          additionalProperties: {
            type: 'string',
          },
        },
      },
      required: ['command'],
    },
  },
  file_edit: {
    name: 'file_edit',
    description: 'Edit, create, or rewrite files with intelligent mode detection. Supports partial edits, full rewrites, and new file creation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to edit (relative to app root)',
        },
        mode: {
          type: 'string',
          enum: ['edit', 'rewrite', 'create'],
          description: 'Edit mode: edit for partial changes, rewrite for full replacement, create for new files (auto-detected if not specified)',
        },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old: {
                type: 'string',
                description: 'The exact text to search for and replace',
              },
              new: {
                type: 'string',
                description: 'The new text to replace with',
              },
            },
            required: ['old', 'new'],
          },
          description: 'Array of search-and-replace operations for partial edits',
        },
        content: {
          type: 'string',
          description: 'Full content for rewrite or create operations',
        },
        createDirs: {
          type: 'boolean',
          description: 'Create parent directories if they don\'t exist',
          default: true,
        },
        backup: {
          type: 'boolean',
          description: 'Create a backup before editing',
          default: true,
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview changes without applying them',
          default: false,
        },
        fuzzyMatch: {
          type: 'boolean',
          description: 'Use fuzzy matching for search text if exact match fails',
          default: true,
        },
        autoCommit: {
          type: 'boolean',
          description: 'Automatically commit changes using git after file operation',
          default: false,
        },
        commitMessage: {
          type: 'string',
          description: 'Custom commit message for auto-commit (if not provided, a default message will be generated)',
        },
        autoBuild: {
          type: 'boolean',
          description: 'Automatically run build after file changes',
          default: true,
        },
      },
      required: ['path'],
    },
  },
  git_operation: {
    name: 'git_operation',
    description: 'Perform git operations like status, add, commit, diff, log, branch management, etc. Provides comprehensive git functionality.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['status', 'add', 'commit', 'diff', 'log', 'branch', 'checkout', 'merge', 'pull', 'push', 'stash', 'reset', 'revert'],
          description: 'The git operation to perform',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to operate on (for add, diff, etc.)',
        },
        message: {
          type: 'string',
          description: 'Commit message (for commit operation)',
        },
        branch: {
          type: 'string',
          description: 'Branch name (for checkout, merge, etc.)',
        },
        options: {
          type: 'object',
          properties: {
            all: {
              type: 'boolean',
              description: 'Include all files (for add, commit)',
            },
            amend: {
              type: 'boolean',
              description: 'Amend last commit (for commit)',
            },
            force: {
              type: 'boolean',
              description: 'Force operation (for push, checkout)',
            },
            hard: {
              type: 'boolean',
              description: 'Hard reset (for reset)',
            },
            count: {
              type: 'number',
              description: 'Number of commits (for log, reset)',
            },
            createBranch: {
              type: 'boolean',
              description: 'Create new branch (for checkout)',
            },
            includeUntracked: {
              type: 'boolean',
              description: 'Include untracked files (for stash)',
            },
            verbose: {
              type: 'boolean',
              description: 'Verbose output',
            },
          },
        },
        autoMessage: {
          type: 'boolean',
          description: 'Auto-generate commit message from recent file changes',
          default: false,
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview operation without executing',
          default: false,
        },
      },
      required: ['operation'],
    },
  },
  read_file: {
    name: 'read_file',
    description: 'Read file contents with optional line range support. Can read entire files or specific line ranges.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read (relative to app root)',
        },
        startLine: {
          type: 'number',
          description: 'Starting line number (1-indexed, optional)',
          minimum: 1,
        },
        numLines: {
          type: 'number',
          description: 'Number of lines to read from start line (optional, reads to end if not specified)',
          minimum: 1,
        },
      },
      required: ['path'],
    },
  },
  grep_search: {
    name: 'grep_search',
    description: 'Search for text or patterns across files in the project. Essential for finding code to edit without reading entire files, locating function/class definitions, finding all usages of a symbol, searching for TODOs or specific patterns, and understanding code structure before making changes.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files or directories to search in. If not provided, searches entire project',
        },
        regex: {
          type: 'boolean',
          description: 'Treat query as a regular expression',
          default: false,
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive search',
          default: false,
        },
        wholeWord: {
          type: 'boolean',
          description: 'Match whole words only',
          default: false,
        },
        contextLines: {
          type: 'number',
          description: 'Number of lines to show before and after each match',
          default: 3,
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 50,
        },
        maxFilesSearched: {
          type: 'number',
          description: 'Maximum number of files to search through',
          default: 1000,
        },
        includePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns for files to include',
          default: ['**/*.{ts,tsx,js,jsx,py,java,cpp,c,go,rs,rb,php,swift,kt,scala,r,m,html,css,scss,json,yaml,yml,toml,xml,md,txt}'],
        },
        excludePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns for files to exclude',
          default: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**', '**/*.min.js', '**/vendor/**', '**/tmp/**', '**/.next/**', '**/.cache/**'],
        },
        includeLineNumbers: {
          type: 'boolean',
          description: 'Include line numbers in results',
          default: true,
        },
        includePath: {
          type: 'boolean',
          description: 'Include file paths in results',
          default: true,
        },
        groupByFile: {
          type: 'boolean',
          description: 'Group results by file',
          default: true,
        },
        findDefinition: {
          type: 'boolean',
          description: 'Try to find function/class/variable definitions',
          default: false,
        },
        findReferences: {
          type: 'boolean',
          description: 'Try to find all references/usages',
          default: false,
        },
      },
      required: ['query'],
    },
  },
} as const;

/**
 * Track tool execution for token usage
 */
async function trackToolExecution(
  toolName: string,
  context: AgentExecutionContext,
  argsSize: number = 0
): Promise<void> {
  const appId = context.metadata?.appId as string;
  if (!appId) return;

  try {
    await tokenUsageRepo.recordUsage(
      appId,
      'tool_execution',
      0, // No prompt tokens for tool execution
      0, // No completion tokens for tool execution  
      {
        ...(context.metadata?.conversationId ? { conversationId: context.metadata.conversationId as string } : {}),
        description: `Tool execution: ${toolName} (${argsSize} bytes args)`
      }
    );
  } catch (error) {
    console.warn('Failed to track tool execution token usage:', error);
  }
}

/**
 * Execute a tool function
 */
export async function executeToolFunction(
  functionName: string,
  args: Record<string, unknown>,
  context: AgentExecutionContext
): Promise<unknown> {
  // Track tool execution
  const argsSize = JSON.stringify(args).length;
  await trackToolExecution(functionName, context, argsSize);

  switch (functionName) {
    case 'directory_listing':
      return await executeDirectoryListing(args as DirectoryListingOptions, context);
    
    case 'terminal_command':
      return await executeTerminalCommand(args as unknown as TerminalCommandOptions, context);
    
    case 'file_edit':
      return await executeFileEdit(args as unknown as FileEditOptions, context);
    
    case 'git_operation':
      return await executeGitOperation(args as unknown as GitToolOptions, context);
    
    case 'read_file':
      return await executeReadFile(args as unknown as ReadFileOptions, context);
    
    case 'grep_search':
      return await executeGrepSearch(args as unknown as GrepOptions, context);
    
    default:
      throw new Error(`Unknown tool function: ${functionName}`);
  }
}

/**
 * Execute the directory listing tool
 */
async function executeDirectoryListing(
  options: DirectoryListingOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app information from context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for directory listing');
  }

  // Get app metadata to determine the allowed path
  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  // Use the app's path as the root for directory listing
  const result = await directoryTool.listDirectory(app.path, options);
  
  // Return formatted tree view
  return directoryTool.formatAsTree(result);
}

/**
 * Execute the terminal command tool
 */
async function executeTerminalCommand(
  options: TerminalCommandOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app information from context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for terminal commands');
  }

  // Get app metadata to determine the allowed path
  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  // Execute the command within the app's directory
  const result = await terminalTool.executeCommand(app.path, options);
  
  // Return formatted result
  return terminalTool.formatResult(result);
}

/**
 * Execute the file edit tool
 */
async function executeFileEdit(
  options: FileEditOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app information from context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for file editing');
  }

  // Get app metadata to determine the allowed path
  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  // Execute the file edit within the app's directory with context for token tracking
  const result = await fileEditTool.editFile(app.path, options, {
    appId,
    conversationId: context.metadata?.conversationId as string
  });
  
  // Return formatted result
  return fileEditTool.formatResult(result);
}

/**
 * Execute the git operation tool
 */
async function executeGitOperation(
  options: GitToolOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app information from context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for git operations');
  }

  // Get app metadata to determine the allowed path
  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  // Execute the git operation within the app's directory
  const result = await gitTool.executeGitOperation(app.path, options);
  
  // Return formatted result
  return gitTool.formatResult(result);
}

/**
 * Execute the read file tool
 */
async function executeReadFile(
  options: ReadFileOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app information from context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for file operations');
  }

  // Get app metadata to determine the allowed path
  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  // Execute the read file operation within the app's directory
  const result = await readFileTool.readFile(options, app.path);
  
  // Return formatted result
  if (!result.success) {
    throw new Error(result.error || 'Failed to read file');
  }

  // Format the response
  let response = `File: ${result.path}\n`;
  if (result.linesRead) {
    response += `Lines ${result.linesRead.start}-${result.linesRead.end} of ${result.totalLines}\n`;
  } else {
    response += `Total lines: ${result.totalLines}\n`;
  }
  if (result.fileSize) {
    response += `File size: ${result.fileSize} bytes\n`;
  }
  response += `\n${result.content}`;
  
  return response;
}

/**
 * Execute the grep search tool
 */
async function executeGrepSearch(
  options: GrepOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app information from context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for grep search');
  }

  // Get app metadata to determine the allowed path
  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  // Validate the options using the schema
  const validatedOptions = GrepOptionsSchema.parse(options);

  // Create a grep tool instance with the app's directory as working directory
  const appGrepTool = new GrepTool(app.path);

  // Execute the search
  const result = await appGrepTool.execute(validatedOptions);
  
  // Return formatted result
  return appGrepTool.formatForLLM(result);
}

/**
 * Get tool definitions for OpenAI function calling
 */
export function getToolDefinitions(): Array<{
  type: 'function';
  function: typeof TOOL_FUNCTIONS[keyof typeof TOOL_FUNCTIONS];
}> {
  return Object.values(TOOL_FUNCTIONS).map(func => ({
    type: 'function' as const,
    function: func,
  }));
}
