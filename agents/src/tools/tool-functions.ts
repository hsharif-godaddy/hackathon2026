import { DirectoryListingTool, DirectoryListingOptions } from './directory-listing.js';
import { TerminalTool, TerminalCommandOptions } from './terminal.js';
import { FileEditTool, FileEditOptions } from './file-edit.js';
import { GitTool, GitToolOptions } from './git-tool.js';
import { ReadFileTool, ReadFileOptions } from './read-file.js';
import { GrepTool, GrepOptions, GrepOptionsSchema } from './grep-tool.js';
import { findImage } from './image-search-tool.js';
import { generateImage } from './image-generation-tool.js';
import { findGettyImage } from './getty-image-tool.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { TokenUsageRepository } from '../database/repositories/TokenUsageRepository.js';
import { AgentRegistry } from '../registry/index.js';
import type { AgentExecutionContext, AgentToolConfig } from '../base/index.js';

const directoryTool = new DirectoryListingTool();
const terminalTool = new TerminalTool();
const fileEditTool = new FileEditTool();
const gitTool = new GitTool();
const readFileTool = new ReadFileTool();
const grepTool = new GrepTool();
const appRepo = new AppRepository();
const tokenUsageRepo = new TokenUsageRepository();
const agentRegistry = AgentRegistry.getInstance();

/**
 * OpenAI Function definitions for our tools
 */
export const TOOL_FUNCTIONS = {
  image_search: {
    name: 'image_search',
    description: 'Search for an image on the web based on a text prompt and return a single image URL. Use this when you need to find a relevant image to illustrate a concept.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The text prompt describing the image to search for',
        },
      },
      required: ['prompt'],
    },
  },
  getty_image: {
    name: 'getty_image',
    description: 'Search for professional stock images using Getty Images API and return high-quality image URLs. Use this when you need professional-grade images.',
    parameters: {
      type: 'object',
      properties: {
        phrase: {
          type: 'string',
          description: 'Search phrase for finding images (e.g., "gym", "office meeting", "mountain landscape")',
        },
        page: {
          type: 'number',
          description: 'Page number for results pagination',
          default: 1,
        },
        pageSize: {
          type: 'number',
          description: 'Number of results per page',
          default: 50,
        },
        graphicalStyles: {
          type: 'string',
          description: 'Type of imagery to search for (e.g., photography, illustration)',
          default: 'photography',
        },
        sortOrder: {
          type: 'string',
          description: 'Sort order for results: "best_match", "most_popular", or "newest"',
          default: 'best_match',
        },
      },
      required: ['phrase'],
    },
  },
  image_generate: {
    name: 'image_generate',
    description: 'Generate an image using AI based on a detailed text prompt and save it to the app\'s public directory.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate',
        },
        size: {
          type: 'string',
          enum: ['1024x1024', '512x512', '256x256'],
          description: 'Size of the generated image',
          default: '1024x1024',
        },
        style: {
          type: 'string',
          enum: ['vivid', 'natural'],
          description: 'Visual style for the image generation',
          default: 'vivid',
        },
        filename: {
          type: 'string',
          description: 'Optional custom filename without extension (default: derived from prompt)',
        },
      },
      required: ['prompt'],
    },
  },
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
    case 'image_search':
      return await executeImageSearch(args as {prompt: string}, context);
    
   case 'image_generate':
      return await executeImageGenerate(args as {prompt: string, size?: string, style?: string, saveToFile?: boolean}, context);
        
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

  // Get agent-specific configuration for directory_listing tool
  const agentId = context.metadata?.agentId as string;
  let agentSpecificOptions = { ...options };
  
  if (agentId) {
    const agentConfig = agentRegistry.getAgentConfig(agentId);
    if (agentConfig) {
      const directoryListingTool = agentConfig.tools.find((tool: AgentToolConfig) => tool.name === 'directory_listing');
      if (directoryListingTool?.config) {
        const toolConfig = directoryListingTool.config as {
          additionalIgnorePatterns?: string[];
          [key: string]: unknown;
        };
        
        // Merge additional ignore patterns from agent configuration
        if (toolConfig.additionalIgnorePatterns) {
          agentSpecificOptions.ignorePatterns = [
            ...(options.ignorePatterns || []),
            ...toolConfig.additionalIgnorePatterns
          ];
        }
      }
    }
  }

  // Use the app's path as the root for directory listing with agent-specific options
  const result = await directoryTool.listDirectory(app.path, agentSpecificOptions);
  
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

  // Add npm-to-pnpm command overrides for the develop agent
  const enhancedOptions = {
    ...options,
    commandOverrides: [
      ...(options.commandOverrides || []),
      ...TerminalTool.createNpmToPnpmOverrides()
    ]
  };

  // Execute the command within the app's directory
  const result = await terminalTool.executeCommand(app.path, enhancedOptions);
  
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
 * Execute the Getty image search tool
 */
async function executeGettyImage(
  options: { phrase: string; page?: number; pageSize?: number; graphicalStyles?: string; sortOrder?: string },
  context: AgentExecutionContext
): Promise<string> {
  const { phrase, page, pageSize, graphicalStyles, sortOrder } = options;
  
  if (!phrase || typeof phrase !== 'string' || phrase.trim().length === 0) {
    throw new Error('A valid search phrase is required');
  }
  
  // Get appId from context metadata
  const appId = context.metadata?.appId as string;
  if (!appId) {
    throw new Error('App ID is required for Getty image search and is not available in context');
  }
  
  // Track tool execution separately
  await trackToolExecution('getty_image', context, phrase.length);
  
  const result = await findGettyImage({
    phrase,
    page,
    pageSize,
    graphicalStyles,
    sortOrder,
    appId
  });
  
  if (!result.success || !result.images || result.images.length === 0) {
    throw new Error(result.error || 'No images found matching your search criteria');
  }
  
  // Get the first image from the results
  const image = result.images[0];
  
  // Get the best quality URL available
  const imageUrl = image.urls.highRes || image.urls.standard || image.urls.preview || image.urls.thumbnail;
  
  if (!imageUrl) {
    throw new Error('No suitable image URL found in Getty response');
  }
  
  // Format the dimensions if available
  let dimensionsText = '';
  if (image.dimensions && image.dimensions.width && image.dimensions.height) {
    dimensionsText = ` (${image.dimensions.width}x${image.dimensions.height})`;
  }
  
  // Create a markdown response with image info
  let response = `![${phrase}](${imageUrl})\n\n`;
  response += `Getty Image ID: ${image.id}${dimensionsText}\n`;
  
  // Include thumbnail URL if available
  if (image.urls.thumbnail) {
    response += `Thumbnail URL: ${image.urls.thumbnail}\n`;
  }
  
  // Include total results count if available
  if (result.totalResults) {
    response += `Found ${result.totalResults} total images matching your search.`;
  }
  
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

/**
 * Execute the image search tool
 */
async function executeImageSearch(
  options: { prompt: string },
  context: AgentExecutionContext
): Promise<string> {
  const { prompt } = options;
  
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('A valid image search prompt is required');
  }
  
  // Track tool execution separately
  await trackToolExecution('image_search', context, prompt.length);
  
  const result = await findImage({ prompt });
  
  if (!result.success || !result.url) {
    throw new Error(result.error || 'Failed to find image');
  }
  
  return `![${prompt}](${result.url})`;
}

async function executeImageGenerate(
  options: { prompt: string; size?: string; style?: string; filename?: string },
  context: AgentExecutionContext
): Promise<string> {
  const { prompt, size, style, filename } = options;
  
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('A valid image generation prompt is required');
  }
  
  // Track tool execution separately
  await trackToolExecution('image_generate', context, prompt.length);
  
  // Get appId from context metadata
  const appId = context.metadata?.appId as string;
  if (!appId) {
    throw new Error('App ID is required for image generation and is not available in context');
  }
  
  // Convert size string to the expected type
  const validSize = (size === '256x256' || size === '512x512' || size === '1024x1024') 
    ? size as '256x256' | '512x512' | '1024x1024'
    : '1024x1024';
  
  // Convert style string to the expected type
  const validStyle = (style === 'vivid' || style === 'natural')
    ? style as 'vivid' | 'natural'
    : 'vivid';
  
  const result = await generateImage({
    prompt,
    size: validSize,
    style: validStyle,
    appId,
    filename
  });
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to generate image');
  }
  
  // Return the public path for use in the app
  let response = `![${prompt}](${result.publicPath})`;
  response += `\n\nImage saved to: ${result.publicPath}`;
  
  return response;
}
