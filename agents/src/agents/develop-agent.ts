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

import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { logger, log } from '../logging/index.js'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { agents as featureAgents } from '../services/features.js'
import { GitHookService } from '../services/git-hook-service.js'
import { SkillLoaderTool } from '../tools/skill-loader-tool.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'

/**
 * Develop Agent - AI developer for building web applications
 */

const gitHookService = new GitHookService()

/**
 * Tool execution logging hook
 * Git operations are now handled automatically by git hooks
 */
const beforeToolExecution: BeforeToolExecutionHook = async (toolName: string, args: unknown, context?: AgentContext): Promise<unknown> => {
  const appId = context?.metadata?.appId as string
  const contextLogger = appId ? log.withContext({ appId, agentId: 'develop' }) : logger

  contextLogger.info('develop_agent.tool.execution.start', {
    toolName
  });

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

  // Git hook: Commit changes after tool execution
  if (appId) {
    try {
      await gitHookService.handleToolCallComplete(appId, toolName);
    } catch (error) {
      contextLogger.warn('develop_agent.git_hook.tool_call.error', {
        toolName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // NEW: Detect auto-continuation flag for skill tool loading
  if (resultObj?.__autoContinue === true) {
    const continuationPrompt = resultObj.__continuationPrompt || 'Continue processing';

    // Store flags in context metadata for auto-continuation detection
    if (context?.metadata) {
      (context.metadata as any).__autoContinue = true;
      (context.metadata as any).__continuationPrompt = continuationPrompt;
    }

    contextLogger.info('develop_agent.tool.auto_continue.detected', {
      toolName,
      continuationPrompt
    });
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

  // Load consolidated prompt sections
  promptBuilder
    .file(paths.getAgentFile('develop', 'core.md'))
    .text(`\n## Available Skills\n\n${skillsList}\n\n`)
    .file(paths.getAgentFile('develop', 'claude-behavior.md'))
    .file(paths.getSharedFile('communication.md'))
    .file(paths.getSharedFile('filesystem.md'))
    .file(paths.getAgentFile('develop', 'font-theme.md')) // Font theme tool documentation
    //.file(paths.getAgentFile('develop', 'design.md'))
    .file(paths.getAgentFile('develop', 'handoff.md'))
    .file(paths.getAgentFile('develop', 'backend.md'))
    .file(paths.getAgentFile('develop', 'secrets.md')) // Secrets management for API keys and credentials

  // Conditionally load commerce rules if commerce agent is enabled
  if (featureAgents.isEnabled('commerce')) {
    promptBuilder.file(paths.getAgentFile('develop', 'commerce.md'))
  }

  promptBuilder.file(paths.getSharedFile('security.md'));

  // Template descriptions are now dynamically injected during conversation execution
  // via AILibContextManager.buildContextMessages() based on app context

  return await promptBuilder.build();
}

/**
 * Custom stop condition: Stop after colorScheme or fontTheme tools with mode='suggest'
 * This prevents the agent from outputting text after showing visual widget options
 */
function shouldStopAfterSuggestMode(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  
  const stepResult = result as any
  
  // The result has a 'steps' array, we need to check the last step
  if (!stepResult.steps || !Array.isArray(stepResult.steps) || stepResult.steps.length === 0) {
    return false
  }
  
  const lastStep = stepResult.steps[stepResult.steps.length - 1]
  if (!lastStep.content || !Array.isArray(lastStep.content)) return false
  
  // Check if any tool call in this step is colorScheme or fontTheme with mode='suggest'
  for (const item of lastStep.content) {
    if (item.type === 'tool-call' && 
        (item.toolName === 'colorScheme' || item.toolName === 'fontTheme')) {
      // Check if the args have mode: 'suggest'
      const args = item.input as any
      if (args && args.mode === 'suggest') {
        logger.info('develop_agent.stop.suggest_mode', {
          toolName: item.toolName,
          toolCallId: item.toolCallId,
          message: `Stopping after ${item.toolName} suggest mode to prevent text output`
        })
        return true
      }
    }
  }
  
  return false
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
      publishClient: allAILibTools.publishClient,

      // Specialized development tools
      mediaSearch: allAILibTools.mediaSearch,
      qrCode: allAILibTools.qrCode,
      websiteScraper: allAILibTools.websiteScraper,

      // Color scheme tool
      colorScheme: allAILibTools.colorScheme,

      // Font theme tool
      fontTheme: allAILibTools.fontTheme,

      // Widget rendering
      //widgetRender: allAILibTools.widgetRender,

      // User interaction
      nextAction: allAILibTools.nextAction,
      suggestedResponse: allAILibTools.suggestedResponse,

      // Secrets management (for API keys, credentials)
      requestSecrets: allAILibTools.requestSecrets,

      // Handoff and conversation control tools will be added by the factory when needed
    },

    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,
    logger: createAgentTelemetryLogger('develop'),

    // Handoff configuration (conditionally include commerce agent based on feature flags)
    handoffs: [
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

    // Custom stop conditions
    stopWhen: [shouldStopAfterSuggestMode],

    // Enable prompt caching for cost savings and performance
    // The develop agent has a large system prompt (~10K+ tokens) making it ideal for caching
    enablePromptCaching: true,

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
