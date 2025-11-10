import {
  createAgentFactory,
  type AgentConfig,
  type BeforeToolExecutionHook,
  type AfterToolExecutionHook,
  type AgentContext,
  createPromptBuilder,
  createHandoffTool,
  createSessionStateManager,
  type SessionStateManager
} from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { GitTool } from '../tools/git-tool.js'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js'
import { logger, log } from '../logging/index.js'

/**
 * Develop Agent - AI developer for building web applications
 */


// Initialize app repository for branch safety checks
const appRepo = new AppRepository();

// Helper function to create git tool with dev-supervisor for specific app
function createGitToolForApp(appId: string): GitTool {
  const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
  return new GitTool(devSupervisor || undefined);
}

/**
 * Git branch safety hook (from original develop-agent)
 */
const beforeToolExecution: BeforeToolExecutionHook = async (toolName: string, args: unknown, context?: AgentContext): Promise<unknown> => {
  const appId = context?.metadata?.appId as string
  const contextLogger = appId ? log.withContext({ appId, agentId: 'develop' }) : logger

  contextLogger.info('develop_agent.tool.execution.start', {
    toolName
  });

  // File-modifying tools that need git branch check
  const fileModifyingTools = ['fileEdit', 'terminalCommand', 'gitOperation']

  if (fileModifyingTools.includes(toolName)) {
    contextLogger.info('develop_agent.git.branch_check.start', {
      toolName,
      reason: 'file_modifying_tool_detected'
    });

    try {
      if (!appId) {
        contextLogger.warn('develop_agent.git.branch_check.skipped', {
          toolName,
          reason: 'no_app_id'
        });
        return args
      }

      // Look up app path using AppRepository
      const app = appRepo.findById(appId)
      if (!app) {
        contextLogger.error('develop_agent.git.branch_check.app_not_found', {
          toolName
        });
        return args
      }

      const appPath = app.path;
      contextLogger.info('develop_agent.git.branch_check.app_path', {
        toolName,
        appPath
      });

      // Check current git branch using the actual git tool with dev-supervisor
      const gitTool = createGitToolForApp(appId);
      const branchResult = await gitTool.executeGitOperation(appPath, {
        operation: 'branch'
      });

      if (branchResult.success && branchResult.currentBranch) {
        const currentBranch = branchResult.currentBranch;

        if (currentBranch !== 'main') {
          contextLogger.warn('develop_agent.git.branch_check.not_on_main', {
            toolName,
            currentBranch,
            targetBranch: 'main'
          });

          // Execute git checkout main
          const checkoutResult = await gitTool.executeGitOperation(appPath, {
            operation: 'checkout',
            branch: 'main'
          });

          if (checkoutResult.success) {
            contextLogger.info('develop_agent.git.branch_check.switch_success', {
              toolName,
              fromBranch: currentBranch,
              toBranch: 'main'
            });
          } else {
            contextLogger.warn('develop_agent.git.branch_check.switch_failed', {
              toolName,
              currentBranch,
              targetBranch: 'main',
              error: checkoutResult.error
            });
          }
        } else {
          contextLogger.info('develop_agent.git.branch_check.on_main', {
            toolName,
            currentBranch: 'main'
          });
        }
      } else {
        contextLogger.warn('develop_agent.git.branch_check.branch_unknown', {
          toolName,
          error: branchResult.error || 'Unknown error'
        });
      }
    } catch (error) {
      contextLogger.error('develop_agent.git.branch_check.error', {
        toolName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return args;
}

/**
 * Development progress tracking hook
 */
const afterToolExecution: AfterToolExecutionHook = async (
  toolName: string,
  args: unknown,
  result: unknown,
  toolCallError: unknown,
  context?: AgentContext
): Promise<unknown> => {
  const appId = context?.metadata?.appId as string
  const contextLogger = appId ? log.withContext({ appId, agentId: 'develop' }) : logger

  contextLogger.info('develop_agent.tool.execution.complete', {
    toolName
  });

  const resultObj = result as any

  // Track specific development operations
  if (toolName === 'fileEdit' && resultObj?.success) {
    contextLogger.info('develop_agent.tool.file_edit.success', {
      filePath: resultObj.filePath || 'unknown',
      operation: resultObj.operation || 'edit'
    });
  }

  if (toolName === 'terminalCommand' && resultObj?.success) {
    contextLogger.info('develop_agent.tool.terminal.success', {
      command: resultObj.command || 'unknown'
    });
  }

  if (toolName === 'serverRestart' && resultObj?.success) {
    contextLogger.info('develop_agent.tool.server_restart.success', {});
  }

  return result
}

/**
 * Build the comprehensive system prompt for the Develop Agent
 */
async function buildDevelopSystemPrompt(_appPath?: string): Promise<string> {
  const promptBuilder = createPromptBuilder();

  // Get modular prompt paths using helper utility
  const paths = getModularPromptPaths(import.meta.url);

  // Load all modular prompt sections in order
  promptBuilder
    .file(paths.getAgentFile('develop', 'core.md'))
    .file(paths.getSharedFile('communication.md')) // CRITICAL: Load communication style EARLY
    .file(paths.getSharedFile('filesystem.md'))
    .file(paths.getAgentFile('develop', 'handoff.md')) // Agent handoff rules
    //.file(paths.getAgentFile('develop', 'database.md'))
    .file(paths.getAgentFile('develop', 'api.md'))
    .file(paths.getAgentFile('develop', 'email.md'))
    .file(paths.getAgentFile('develop', 'deployment.md'))
    .file(paths.getAgentFile('develop', 'decision-matrix.md'))
    .file(paths.getAgentFile('develop', 'approach.md'))
    .file(paths.getAgentFile('develop', 'visual-context.md'))
    .file(paths.getAgentFile('develop', 'validation.md'))
    .file(paths.getAgentFile('develop', 'design.md'))
    //.file(paths.getAgentFile('develop', 'widgets.md')) // purposely disabled for now
    .file(paths.getAgentFile('develop', 'planning.md'))
    .file(paths.getSharedFile('security.md'));

  // Template descriptions are now dynamically injected during conversation execution
  // via AILibContextManager.buildContextMessages() based on app context

  return await promptBuilder.build();
}

/**
 * Create the Develop Agent configuration
 */
export async function createDevelopAgent(options?: { appPath?: string }): Promise<AgentConfig> {
  const appPath = options?.appPath || process.cwd()
  const systemPrompt = await buildDevelopSystemPrompt(appPath)
  const { model, modelName } = await getAgentModelWithName('full') // Use full model for complex development tasks

  return {
    name: 'AI Developer',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      // Core development tools
      directoryListing: allAILibTools.directoryListing,
      terminalCommand: allAILibTools.terminalCommand,
      fileEdit: allAILibTools.fileEdit,
      gitOperation: allAILibTools.gitOperation,
      readFile: allAILibTools.readFile,
      grepSearch: allAILibTools.grepSearch,

      // Planning tools
      todoList: allAILibTools.todoList,

      // Server management
      serverRestart: allAILibTools.serverRestart,
      //serverStatus: allAILibTools.serverStatus,
      viewLogs: allAILibTools.viewLogs,

    // Specialized development tools
    imageSearch: allAILibTools.imageSearch,
    imageGenerate: allAILibTools.imageGenerate,

      // Widget rendering
      //widgetRender: allAILibTools.widgetRender,

      // Handoff tools will be added by the factory when needed
    },

    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,

    // Handoff configuration
    handoffs: [
      /*
      {
        agentName: 'database',
        description: 'MySQL database operations, schema design, and database integration',
      },
      */
      {
        agentName: 'color-scheme',
        description: 'Color palette design and visual branding for applications',
      },
    ],

    maxSteps: 100,
    temperature: 0.3,
    maxOutputTokens: 16000,
    
    metadata: {
      contextPreferences: {
        includeAppContext: true,
        includeVisualContext: true,
        includeAiEditContext: true,
        includeSelectedImages: true,
        includeConversationHistory: true,
        includeTemplateDescription: true
      }
    }
  }
}

/**
 * Create Develop Agent factory with handoff support
 */
export async function createDevelopAgentFactory(options?: { 
  appPath?: string
  stateManager?: SessionStateManager
  sessionId?: string
}) {
  const factory = createAgentFactory()

  // Create state manager if not provided
  const stateManager = options?.stateManager || createSessionStateManager({
    defaultAgentId: 'develop',
    enableLogging: true
  })

  const developConfig = await createDevelopAgent(options)
  
  // Add handoff tool if sessionId is provided
  if (options?.sessionId) {
    const validTargets = (developConfig.handoffs || []).map(h => h.agentName)
    developConfig.tools = {
      ...developConfig.tools,
      handoff: createHandoffTool({
        sourceAgentId: 'develop',
        validTargets,
        stateManager,
        sessionId: options.sessionId
      })
    }
  }

  const agents = factory.defineAgents({
    develop: developConfig
  })

  return {
    factory,
    agents,
    getAgent: () => agents.get('develop'),
    stateManager,
    appPath: options?.appPath
  }
}

/**
 * Develop Agent class wrapper for backward compatibility
 */
export class DevelopAgent {
  private factory: Awaited<ReturnType<typeof createDevelopAgentFactory>>
  private appPath: string
  private sessionId?: string
  private stateManager?: SessionStateManager

  constructor(options?: { 
    appPath?: string
    sessionId?: string
    stateManager?: SessionStateManager
  }) {
    this.appPath = options?.appPath || process.cwd()
    if (options?.sessionId) this.sessionId = options.sessionId
    if (options?.stateManager) this.stateManager = options.stateManager
    this.factory = null as any
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    logger.info('develop_agent.initialization.start', {
      appPath: this.appPath,
      hasSessionId: !!this.sessionId,
      hasStateManager: !!this.stateManager
    });
    
    const factoryOptions: {
      appPath: string
      sessionId?: string
      stateManager?: SessionStateManager
    } = { appPath: this.appPath }
    
    if (this.sessionId) factoryOptions.sessionId = this.sessionId
    if (this.stateManager) factoryOptions.stateManager = this.stateManager
    
    this.factory = await createDevelopAgentFactory(factoryOptions)
    logger.info('develop_agent.initialization.complete', {
      appPath: this.appPath
    });
  }

  /**
   * Get the agent instance
   */
  getAgent() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.getAgent()
  }

  /**
   * Get agent factory for advanced usage
   */
  getFactory() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.factory
  }

  /**
   * Get the handoff state manager
   */
  getStateManager(): SessionStateManager {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.stateManager
  }

  /**
   * Hand off to Database Agent for MySQL setup (original method)
   */
  async handoffToDatabase(params: { userId: string; databaseName: string }): Promise<any> {
    const factory = this.getFactory()

    logger.info('develop_agent.handoff.database.start', {
      targetAgent: 'database',
      userId: params.userId,
      databaseName: params.databaseName
    });

    const handoffResult = await factory.executeHandoff(
      'develop',
      'database',
      {
        task: `Complete MySQL database setup and integration with the following requirements:

**Database Configuration:**
- Database Name: ${params.databaseName}
- User ID: ${params.userId}
- Create dedicated MySQL database with proper user permissions
- Generate secure database credentials
- Test database connectivity

**Integration Tasks:**
1. Create MySQL database: ${params.databaseName}
2. Set up database user for application access
3. Update .env file with database credentials
4. Restart development server to apply changes
5. Verify database integration is working

**Required Output:**
- Database credentials (host, port, username, password, database)
- Connection string for application use
- Backend server information (port, API URL)
- Integration summary and next steps

Please complete all database setup tasks and provide the integration details for frontend development.`,
        context: {
          userId: params.userId,
          databaseName: params.databaseName,
          appPath: this.appPath,
          projectType: 'web-application',
          requiresIntegration: true
        },
        parameters: params,
        metadata: {
          sourceAgent: 'develop',
          timestamp: new Date().toISOString(),
          reason: 'Database setup required for application development'
        }
      }
    )

    if (handoffResult.success) {
      // Type guard: assert result shape for database handoff
      const result = handoffResult.result as {
        success?: boolean
        summary?: string
        credentials?: { host: string; port: number; database: string }
        backendPort?: number
      } | undefined

      logger.info('develop_agent.handoff.database.success', {
        targetAgent: 'database',
        userId: params.userId,
        databaseName: params.databaseName,
        backendPort: result?.backendPort || 3000
      });

      return {
        success: result?.success || true,
        message: result?.summary || 'Database setup completed. Ready for frontend integration.',
        credentials: result?.credentials || {
          host: 'localhost',
          port: 3306,
          database: params.databaseName
        },
        backendPort: result?.backendPort || 3000,
        handoffDetails: handoffResult.handoffDetails
      }
    } else {
      logger.error('develop_agent.handoff.database.failure', {
        targetAgent: 'database',
        userId: params.userId,
        databaseName: params.databaseName,
        error: handoffResult.error
      });
      throw new Error(`Database handoff failed: ${handoffResult.error}`)
    }
  }

  /**
   * Stream generate response
   */
  async streamGenerate(prompt: string, options?: any) {
    const agent = this.getAgent()
    return agent.streamGenerate(prompt, options)
  }

  /**
   * Generate response (non-streaming)
   */
  async generate(prompt: string, options?: any) {
    const agent = this.getAgent()
    return agent.generate(prompt, options)
  }

  /**
   * Get agent name
   */
  getName(): string {
    return this.getAgent().getName()
  }

  /**
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.agents.getConfig('develop')
  }

  /**
   * Generate Vite configuration with proxy setup (original method)
   */
  private generateViteConfigCode(backendPort: number): string {
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // Frontend port
    proxy: {
      '/api': {
        target: 'http://localhost:${backendPort}',
        changeOrigin: true,
      },
    },
  },
});`
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('develop_agent.cleanup.complete', {
      appPath: this.appPath
    });
  }
}
