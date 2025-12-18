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
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { logger, log } from '../logging/index.js'
import { agents as featureAgents } from '../services/features.js'
import { SkillLoaderTool } from '../tools/skill-loader-tool.js'

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
  const fileModifyingTools = ['fileEdit', 'terminalCommand']

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
    // Handle batch operations (new schema)
    if (resultObj.operations && Array.isArray(resultObj.operations)) {
      const paths = resultObj.operations.map((op: any) => op.path).filter(Boolean);
      const modes = [...new Set(resultObj.operations.map((op: any) => op.mode).filter(Boolean))];
      contextLogger.info('develop_agent.tool.file_edit.success', {
        filePaths: paths,
        operations: modes,
        fileCount: resultObj.totalOperations || paths.length
      });
    } else {
      // Handle single operation (legacy schema)
      contextLogger.info('develop_agent.tool.file_edit.success', {
        filePath: resultObj.filePath || resultObj.path || 'unknown',
        operation: resultObj.operation || resultObj.mode || 'edit'
      });
    }
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

  // Get available skills list
  const skillLoader = new SkillLoaderTool();
  const skillsResult = await skillLoader.listSkills();
  const skillsList = skillsResult.success && skillsResult.skills
    ? skillsResult.skills.map(s => `- **${s.name}**: ${s.description}`).join('\n')
    : '(No skills available)';

  // Load all modular prompt sections in order
  promptBuilder
    .file(paths.getAgentFile('develop', 'core.md'))
    .text(`\n## Available Skills\n\n${skillsList}\n\n`)
    .file(paths.getAgentFile('develop', 'skills.md')) // CRITICAL: Load skills system immediately after core
    .file(paths.getSharedFile('communication.md')) // CRITICAL: Load communication style EARLY
    .file(paths.getSharedFile('filesystem.md'))
    .file(paths.getAgentFile('develop', 'handoff.md')) // Agent handoff rules (always available agents)
    .file(paths.getAgentFile('develop', 'backend.md'))

  // Conditionally load commerce handoff rules if commerce agent is enabled
  if (featureAgents.isEnabled('commerce')) {
    promptBuilder.file(paths.getAgentFile('develop', 'handoff-commerce.md'))
  }

  promptBuilder
    // .file(paths.getAgentFile('develop', 'email.md'))
    // .file(paths.getAgentFile('develop', 'deployment.md'))
    .file(paths.getAgentFile('develop', 'decision-matrix.md'))

  // Conditionally load commerce decision matrix and checkout guide if commerce agent is enabled
  if (featureAgents.isEnabled('commerce')) {
    promptBuilder
      .file(paths.getAgentFile('develop', 'decision-matrix-commerce.md'))
      .file(paths.getAgentFile('develop', 'commerce-checkout-guide.md'))
  }

  promptBuilder
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
      readFile: allAILibTools.readFile,
      grepSearch: allAILibTools.grepSearch,

      // Planning tools
      todoList: allAILibTools.todoList,

      // Skills system
      skill: allAILibTools.skill,

      // Server management
      serverRestart: allAILibTools.serverRestart,
      //serverStatus: allAILibTools.serverStatus,
      viewLogs: allAILibTools.viewLogs,

      // Specialized development tools
      mediaSearch: allAILibTools.mediaSearch,
      imageGenerate: allAILibTools.imageGenerate,
      websiteScraper: allAILibTools.websiteScraper,

      // Widget rendering
      //widgetRender: allAILibTools.widgetRender,

      // User interaction
      nextAction: allAILibTools.nextAction,
      suggestedResponse: allAILibTools.suggestedResponse,

      // Handoff and conversation control tools will be added by the factory when needed
    },

    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,
    logger: createAgentTelemetryLogger('develop'),

    // Handoff configuration (conditionally include commerce agent based on feature flags)
    handoffs: [
      {
        agentName: 'color-scheme',
        description: 'Color palette design and visual branding for applications',
      },
      {
        agentName: 'marketing',
        description: 'SEO optimization and marketing strategy for websites',
      },
      ...(featureAgents.isEnabled('commerce') ? [{
        agentName: 'commerce',
        description: 'GoDaddy Commerce product catalog operations - fetch products for e-commerce listings',
      }] : []),
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
