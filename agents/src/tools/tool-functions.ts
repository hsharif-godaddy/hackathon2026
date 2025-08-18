import { DirectoryListingTool, DirectoryListingOptions } from './directory-listing.js';
import { TerminalTool, TerminalCommandOptions } from './terminal.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import type { AgentExecutionContext } from '../base/index.js';

const directoryTool = new DirectoryListingTool();
const terminalTool = new TerminalTool();
const appRepo = new AppRepository();

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
} as const;

/**
 * Execute a tool function
 */
export async function executeToolFunction(
  functionName: string,
  args: Record<string, unknown>,
  context: AgentExecutionContext
): Promise<unknown> {
  switch (functionName) {
    case 'directory_listing':
      return await executeDirectoryListing(args as DirectoryListingOptions, context);
    
    case 'terminal_command':
      return await executeTerminalCommand(args as unknown as TerminalCommandOptions, context);
    
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
