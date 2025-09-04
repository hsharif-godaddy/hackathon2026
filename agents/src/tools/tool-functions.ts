import { DirectoryListingTool, DirectoryListingOptions } from './directory-listing.js';
import { TerminalTool, TerminalCommandOptions } from './terminal.js';
import { FileEditTool, FileEditOptions } from './file-edit.js';
import { GitTool, GitToolOptions } from './git-tool.js';
import { ReadFileTool, ReadFileOptions } from './read-file.js';
import { GrepTool, GrepOptions, GrepOptionsSchema } from './grep-tool.js';
import { MySQLTool, MySQLToolOptions } from './mysql-tool.js';
import { ServerManagementTool, ServerStatusOptions, RestartServerOptions, StopServerOptions } from './server-management-tool.js';
import { createEnvManager } from './env-manager.js';
import { createMySQLResponseFormatter } from './mysql-response-formatter.js';
import { AutoAPIGenerator, AutoAPIGeneratorOptions } from './auto-api-generator.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { TokenUsageRepository } from '../database/repositories/TokenUsageRepository.js';
import type { AgentExecutionContext, AgentToolConfig } from '../base/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { findImage } from './image-search-tool.js';
import { generateImage } from './image-generation-tool.js';
import { findGettyImage, GettyImageOptions } from './getty-image-tool.js';
import { appPlanTool, AppPlanToolOptions } from './app-plan-tool.js';
import { validateLucideIcons, IconsValidatorOptions } from './icons-validator.js';
import { AgentRegistry } from '../registry/index.js';

const directoryTool = new DirectoryListingTool();
const terminalTool = new TerminalTool();
const fileEditTool = new FileEditTool();
const gitTool = new GitTool();
const readFileTool = new ReadFileTool();
const mysqlTool = new MySQLTool();
const serverTool = new ServerManagementTool();
const autoAPIGenerator = new AutoAPIGenerator();
const appRepo = new AppRepository();
const tokenUsageRepo = new TokenUsageRepository();
const agentRegistry = AgentRegistry.getInstance();

/**
 * Write database credentials to the app's .env file using EnvManager
 */
async function writeCredentialsToEnvFile(
  appId: string, 
  credentials: {
    DB_HOST: string;
    DB_PORT: string;
    DB_USER: string;
    DB_PASS: string;
    DB_NAME: string;
    DATABASE_URL: string;
  }
): Promise<void> {
  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  try {
    // Create EnvManager for the app
    const envManager = createEnvManager(app.path);

    // Check if .env file doesn't exist and copy from .env.example if available
    if (!(await envManager.exists())) {
      const envExamplePath = join(app.path, '.env.example');
      try {
        const exampleContent = await fs.readFile(envExamplePath, 'utf-8');
        await fs.writeFile(join(app.path, '.env'), exampleContent, 'utf-8');
        console.log(`📋 Created .env file from .env.example template`);
      } catch {
        // If .env.example doesn't exist, EnvManager will create a new .env file
      }
    }

    // Remove existing database variables first
    await envManager.removeDatabaseVariables();

    // Set new database credentials
    const result = await envManager.setDatabaseVariables({
      host: credentials.DB_HOST,
      port: credentials.DB_PORT,
      user: credentials.DB_USER,
      password: credentials.DB_PASS,
      database: credentials.DB_NAME,
      url: credentials.DATABASE_URL
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to update environment variables');
    }

    console.log(`✅ Database credentials successfully updated in .env file`);
    
  } catch (error) {
    throw new Error(`Failed to write credentials to .env file: ${error}`);
  }
}

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
  mysql_operation: {
    name: 'mysql_operation',
    description: 'Manage MySQL databases: create dedicated databases with user credentials, test connections, and list databases. For enable_database operation: automatically generates secure credentials, creates MySQL user first, then creates dedicated database with user-scoped name (always appends random 4-digit suffix for uniqueness), prepares empty database ready for custom table creation, writes all credentials to the application\'s .env file, and automatically restarts the backend server to load new environment variables.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['enable_database', 'test_connection', 'list_databases'],
          description: 'The MySQL operation to perform. enable_database: creates user credentials first, then creates dedicated database, prepares empty database ready for custom table creation, automatically updates .env file with credentials, and restarts backend server to load new environment variables',
        },
        databaseName: {
          type: 'string',
          description: 'Name for the database (e.g., "blog_app" creates database like "user123_blog_app_1234"). Required for enable_database operation. A dedicated database will be created with this name (user-scoped with random suffix).',
          pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
          maxLength: 64,
        },
        username: {
          type: 'string',
          description: 'Custom username for the database user (optional, auto-generated if not provided)',
          pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
          maxLength: 32,
        },
        userId: {
          type: 'string',
          description: 'User identifier for database scoping (e.g., "user123"). Combined with databaseName to create unique database names like "user123_blog_app_1234". Required for enable_database operation.',
          pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
          maxLength: 16,
        },
        host: {
          type: 'string',
          description: 'MySQL host (optional, defaults to environment variable or localhost)',
        },
        port: {
          type: 'number',
          description: 'MySQL port (optional, defaults to environment variable or 3306)',
          minimum: 1,
          maximum: 65535,
        },
        rootUser: {
          type: 'string',
          description: 'MySQL root username (optional, defaults to environment variable)',
        },
        rootPassword: {
          type: 'string',
          description: 'MySQL root password (optional, defaults to environment variable)',
        },
      },
      required: ['operation'],
    },
  },
  server_restart: {
    name: 'server_restart',
    description: 'Restart the development server for the current app. Use this after database configuration changes, dependency installations, or when the server becomes unresponsive.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional reason for the restart (for logging purposes)',
        },
      },
      required: [],
    },
  },
  server_status: {
    name: 'server_status',
    description: 'Check the current status of the development server for the current app. Returns whether the server is running, stopped, or in an error state.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  server_stop: {
    name: 'server_stop',
    description: 'Stop the development server for the current app. Use this when you need to temporarily stop a server.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional reason for stopping (for logging purposes)',
        },
      },
      required: [],
    },
  },
  auto_api_generator: {
    name: 'auto_api_generator',
    description: 'Automatically generate Hono.js API endpoints from database schemas. PREREQUISITE: Database and migrations must be run first before using analyze_schema or generate_endpoints operations. Can analyze database tables, generate TypeScript types, and create Hono.js REST API routes with selective operations (create, read, update, delete). Perfect for generating only specific operations like "create or read only" APIs.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['analyze_schema', 'generate_types', 'generate_endpoints'],
          description: 'Operation to perform: analyze_schema (inspect database tables - requires DB & migrations to be run first), generate_types (create TypeScript interfaces), generate_endpoints (create API endpoints with selected operations - requires DB & migrations to be run first)',
        },
        database: {
          type: 'object',
          properties: {
            host: { type: 'string', description: 'Database host (default: localhost)' },
            port: { type: 'number', description: 'Database port (default: 3306)' },
            user: { type: 'string', description: 'Database username' },
            password: { type: 'string', description: 'Database password' },
            database: { type: 'string', description: 'Database name' },
          },
          required: ['user', 'password', 'database'],
          description: 'Database connection configuration',
        },
        tables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific tables to process (if empty, processes all tables)',
        },
        operations: {
          type: 'array',
          items: { 
            type: 'string',
            enum: ['create', 'read', 'read_all', 'update', 'delete']
          },
          description: 'Which HTTP operations to generate. Options: create (POST), read (GET by ID), read_all (GET all), update (PUT), delete (DELETE). If empty, generates all operations.',
        },
        outputDir: {
          type: 'string',
          description: 'Output directory for generated files (default: src/backend/api for V3 template) - API routes are added to existing routes.ts',
        },
        apiPrefix: {
          type: 'string',
          description: 'API prefix path (default: /api)',
        },
        generateTypes: {
          type: 'boolean',
          description: 'Whether to generate TypeScript types (default: true)',
        },
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite existing files (default: false)',
        },
      },
      required: ['operation', 'database'],
    },
  },
  icons_validator: {
    name: 'icons_validator',
    description: 'Validate icons used in generated content. Use this tool when the site is nearly complete to ensure all icons exist. This prevents runtime errors from invalid icon names.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to validate (relative paths). If empty, validates all .tsx/.ts/.jsx/.js files',
        },
        fixSuggestions: {
          type: 'boolean',
          description: 'Include detailed fix suggestions in the output',
          default: true,
        },
      },
      required: [],
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
    
    case 'mysql_operation':
      return await executeMySQLOperation(args as unknown as MySQLToolOptions, context);
    
    case 'server_restart':
      return await executeServerRestart(args as unknown as RestartServerOptions, context);
    
    case 'server_status':
      return await executeServerStatus(args as unknown as ServerStatusOptions, context);
    
    case 'server_stop':
      return await executeServerStop(args as unknown as StopServerOptions, context);
    
    case 'auto_api_generator':
      return await executeAutoAPIGenerator(args as unknown as AutoAPIGeneratorOptions, context);
    
    case 'app_plan':
      return await executeAppPlan(args as unknown as AppPlanToolOptions, context);

    case 'icon_validator':
      return await executeIconsValidator(args as unknown as IconsValidatorOptions, context);
    
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
  const agentSpecificOptions = { ...options };
  
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  const gettyOptions: GettyImageOptions = {
    phrase
  };

  if (page !== undefined) gettyOptions.page = page;
  if (pageSize !== undefined) gettyOptions.pageSize = pageSize;
  if (graphicalStyles !== undefined) gettyOptions.graphicalStyles = graphicalStyles;
  if (sortOrder !== undefined) gettyOptions.sortOrder = sortOrder;

  const result = await findGettyImage(gettyOptions);

  if (!result.success || !result.images || result.images.length === 0) {
    throw new Error(result.error || 'No images found matching your search criteria');
  }

  // Get the first image from the results
  const image = result.images[0];

  if (!image) {
    throw new Error('No image data found in Getty response');
  }

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
 * Execute the MySQL operation tool
 */
async function executeMySQLOperation(
  options: MySQLToolOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Track tool execution
  await trackToolExecution('mysql_operation', context, JSON.stringify(options).length);

  // Execute the MySQL operation
  const result = await mysqlTool.execute(options);
  
  console.log('🔍 MySQL operation result:', JSON.stringify(result, null, 2));
  
  if (!result.success) {
    console.error('❌ MySQL operation failed:', result.error, result.message);
    throw new Error(result.error || result.message || 'MySQL operation failed');
  }

  // Create formatter for clean output generation
  const formatter = createMySQLResponseFormatter(result);
  
  // Set app context if available
  const appId = context.metadata?.appId as string;
  if (appId) {
    formatter.setAppContext(appId);
    
    // Handle environment file writing for enable_database operations
    const credentials = formatter.getEnvironmentCredentials(result.data || {});
    if (credentials) {
      try {
        await writeCredentialsToEnvFile(appId, credentials);
        formatter.setEnvironmentWriteResult(true);
        
        // Automatically restart server after database creation and .env update
        if (options.operation === 'enable_database') {
          console.log('🔄 Auto-restarting server after database creation...');
          try {
            const serverRestartResult = await serverTool.restartServer({ 
              reason: 'Database configuration updated' 
            }, appId);
            
            if (serverRestartResult.success) {
              console.log('✅ Server restarted successfully');
              formatter.setServerRestartResult(true);
            } else {
              console.error('❌ Server restart failed:', serverRestartResult.error);
              formatter.setServerRestartResult(false, serverRestartResult.error);
            }
          } catch (restartError) {
            console.error('❌ Server restart error:', restartError);
            formatter.setServerRestartResult(false, restartError instanceof Error ? restartError.message : String(restartError));
          }
        }
        
      } catch (envError) {
        formatter.setEnvironmentWriteResult(false, envError instanceof Error ? envError.message : String(envError));
      }
    }
  }
  
  return formatter.renderMarkdown();
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
    ...(filename && { filename })
  });
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to generate image');
  }
  
  // Return the public path for use in the app
  let response = `![${prompt}](${result.publicPath})`;
  response += `\n\nImage saved to: ${result.publicPath}`;
  
  return response;
}

/**
 * Execute server restart tool
 */
async function executeServerRestart(
  options: RestartServerOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app ID from execution context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for server restart - ensure agent is running in app context');
  }

  const { reason } = options;

  // Track tool execution
  await trackToolExecution('server_restart', context, JSON.stringify(options).length);

  console.log(`🔄 Restarting server for app ${appId}${reason ? ` (Reason: ${reason})` : ''}`);

  const result = await serverTool.restartServer({ 
    ...(reason && { reason }) 
  }, appId);
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to restart server');
  }

  return `✅ ${result.message}`;
}

/**
 * Execute server status check tool
 */
async function executeServerStatus(
  options: ServerStatusOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app ID from execution context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for server status check - ensure agent is running in app context');
  }

  // Track tool execution
  await trackToolExecution('server_status', context, JSON.stringify(options).length);

  const result = await serverTool.checkServerStatus({}, appId);
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to check server status');
  }

  let response = `📊 Server Status for App ${appId}: ${result.status.toUpperCase()}`;
  
  if (result.message) {
    response += `\n${result.message}`;
  }

  if (result.details) {
    response += `\nDetails:`;
    if (result.details.port) {
      response += `\n• Port: ${result.details.port}`;
    }
    if (result.details.url) {
      response += `\n• URL: ${result.details.url}`;
    }
    if (result.details.isV3) {
      response += `\n• Template: V3`;
      if (result.details.backendPort) {
        response += `\n• Backend Port: ${result.details.backendPort}`;
      }
    }
  }

  return response;
}

/**
 * Execute server stop tool
 */
async function executeServerStop(
  options: StopServerOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app ID from execution context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for server stop - ensure agent is running in app context');
  }

  const { reason } = options;

  // Track tool execution
  await trackToolExecution('server_stop', context, JSON.stringify(options).length);

  console.log(`🛑 Stopping server for app ${appId}${reason ? ` (Reason: ${reason})` : ''}`);

  const result = await serverTool.stopServer({ 
    ...(reason && { reason }) 
  }, appId);
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to stop server');
  }

  return `✅ ${result.message}`;
}

/**
 * Execute Auto API Generator
 */
async function executeAutoAPIGenerator(
  options: AutoAPIGeneratorOptions,
  context: AgentExecutionContext
): Promise<any> {
  // Get app ID and path from execution context
  const appId = context.metadata?.appId as string;
  
  if (!appId) {
    throw new Error('App ID is required for API generation - ensure agent is running in app context');
  }

  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  // Track tool execution
  await trackToolExecution('auto_api_generator', context, JSON.stringify(options).length);

  console.log(`🔧 Generating API endpoints for app ${appId} - Operation: ${options.operation}`);

  try {
    const result = await autoAPIGenerator.execute(app.path, options);
    
    if (!result.success) {
      throw new Error(result.error || result.message || 'API generation failed');
    }

    console.log(`✅ API generation completed: ${result.message}`);
    
    // Format the response based on the operation
    let responseMessage = `✅ ${result.message}`;
    
    if (result.data) {
      if (result.data.tables) {
        responseMessage += `\n\n📊 **Analyzed Tables:**\n${result.data.tables.map(t => `- ${t.name} (${t.columns.length} columns)`).join('\n')}`;
      }
      
      if (result.data.generatedFiles) {
        responseMessage += `\n\n📁 **Generated Files:**\n${result.data.generatedFiles.map(f => `- ${f}`).join('\n')}`;
      }
      
      if (result.data.endpoints) {
        const endpointsByTable = result.data.endpoints.reduce((acc, ep) => {
          if (!acc[ep.table]) acc[ep.table] = [];
          acc[ep.table]?.push(ep);
          return acc;
        }, {} as Record<string, any[]>);
        
        responseMessage += `\n\n🚀 **Generated Endpoints:**`;
        for (const [table, endpoints] of Object.entries(endpointsByTable)) {
          responseMessage += `\n**${table}:**`;
          for (const ep of endpoints) {
            responseMessage += `\n  - ${ep.method} ${ep.path} - ${ep.description}`;
          }
        }
      }
    }
    
    return responseMessage;
    
  } catch (error) {
    console.error('❌ API generation failed:', error);
    throw error;
  }
}

/**
 * Execute content validation tool
 */
async function executeIconsValidator(
  options: IconsValidatorOptions,
  context: AgentExecutionContext
): Promise<string> {
  // Get app information from context
  const appId = context.metadata?.appId as string;

  if (!appId) {
    throw new Error('App ID is required for content validation');
  }

  // Get app metadata to determine the allowed path
  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  try {
    // Track tool execution
    await trackToolExecution('icons_validator', context, JSON.stringify(options).length);

    const files = options.files || [];
    const fixSuggestions = options.fixSuggestions !== false;

    console.log(`🔍 Running icons validation for app ${appId}...`);

    // Use the existing content validation system
    const result = await validateLucideIcons(app.path, files);

    if (!result) {
      throw new Error('Icons validation failed to execute');
    }

    // Format the response based on the operation and results
    let responseMessage = '';

    if (result.valid) {
      responseMessage = `✅ **Icons Validation PASSED**\n\n`;
      responseMessage += `📊 **Summary:**\n`;
      responseMessage += `- 
       scanned: ${result.scannedFiles.length}\n`;
      responseMessage += `- Errors found: 0\n`;
      responseMessage += `- Warnings: ${result.warnings.length}\n\n`;

      if (result.warnings.length > 0) {
        responseMessage += `⚠️ **Warnings:**\n`;
        result.warnings.forEach(warning => {
          responseMessage += `- **${warning.file}**: ${warning.message}\n`;
        });
        responseMessage += '\n';
      }

      responseMessage += `🎉 **All icons are valid!** Your site is ready for production.`;
    } else {
      responseMessage = `❌ **Icons Validation FAILED**\n\n`;
      responseMessage += `📊 **Summary:**\n`;
      responseMessage += `- Files scanned: ${result.scannedFiles.length}\n`;
      responseMessage += `- Errors found: ${result.errors.length}\n`;
      responseMessage += `- Warnings: ${result.warnings.length}\n\n`;

      responseMessage += `🚨 **Critical Errors:**\n`;
      result.errors.forEach(error => {
        responseMessage += `- **${error.file}**: ${error.message}\n`;
      });

      if (result.warnings.length > 0) {
        responseMessage += `\n⚠️ **Warnings:**\n`;
        result.warnings.forEach(warning => {
          responseMessage += `- **${warning.file}**: ${warning.message}\n`;
        });
      }

      if (fixSuggestions && result.fixSuggestions.length > 0) {
        responseMessage += `\n💡 **Fix Suggestions:**\n`;
        result.fixSuggestions.forEach(suggestion => {
          responseMessage += `- ${suggestion}\n`;
        });
      }

      responseMessage += `\n🔧 **Next Steps**: Fix the errors above to ensure your site works correctly in production.`;
    }

    return responseMessage;

  } catch (error) {
    console.error('❌ Icons validation failed:', error);
    throw error;
  }
}

/**
 * Execute the app plan tool
 */
async function executeAppPlan(
  options: AppPlanToolOptions,
  _context: AgentExecutionContext
): Promise<string> {
  try {
    const result = await appPlanTool.execute(options);
    
    if (!result.success) {
      throw new Error(result.error || 'App plan operation failed');
    }

    let responseMessage = `✅ **App Plan ${options.operation.toUpperCase()}**\n`;
    responseMessage += result.message || '';

    if (result.data) {
      responseMessage += `\n\n📋 **Plan Details:**`;
      responseMessage += `\n- **App ID:** ${result.data.appId}`;
      
      if (result.data.appName) {
        responseMessage += `\n- **App Name:** ${result.data.appName}`;
      }
      
      if (result.data.colorPalette) {
        responseMessage += `\n- **Color Scheme:** ${result.data.colorPalette.scheme}`;
        if (result.data.colorPalette.name) {
          responseMessage += ` (${result.data.colorPalette.name})`;
        }
        responseMessage += `\n- **Primary Color:** ${result.data.colorPalette.primary}`;
        responseMessage += `\n- **Secondary Color:** ${result.data.colorPalette.secondary}`;
        responseMessage += `\n- **Accent Color:** ${result.data.colorPalette.accent}`;
      }
      
      if (result.data.planData && Object.keys(result.data.planData).length > 0) {
        responseMessage += `\n- **Additional Data:** ${Object.keys(result.data.planData).length} items stored`;
      }
      
      responseMessage += `\n- **Last Updated:** ${result.data.updatedAt.toLocaleString()}`;
    }

    return responseMessage;
    
  } catch (error) {
    console.error('❌ App plan operation failed:', error);
    throw error;
  }
}

