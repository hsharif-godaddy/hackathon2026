import {
  createAgentFactory,
  type AgentConfig,
  type BeforeToolExecutionHook,
  type AfterToolExecutionHook,
  type AgentContext,
  type ResolverContext,
  createPromptBuilder,
  createHandoffTool,
  createSessionStateManager,
  type SessionStateManager
} from '@airo/ai-lib'

import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { logger, log } from '../logging/index.js'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { SkillLoaderTool, buildSkillsPromptSection } from '../tools/skill-loader-tool.js'
import { skillToolManager } from '../tools/skill-tool-manager.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { getPersistentAssetPaths } from '../utils/persistent-assets.js'
import { skills } from '../services/features.js'
import { profileFlag, activeProfileName } from '../profiles/profile-accessor.js'
import { isAutomationsEnabled } from './automations-context.js'
import {
  EVAL_PROMPT_VARIANTS,
  resolveEvalPromptVariants,
  injectedFileNames,
  replacedFragmentNames,
} from './develop-prompt-variants.js'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

/**
 * Develop Agent - AI developer for building web applications
 */

/**
 * Tool execution logging hook
 * Git operations are now handled automatically by git hooks
 */
const beforeToolExecution: BeforeToolExecutionHook = async (toolName: string, args: unknown, context?: AgentContext): Promise<unknown> => {
  const appId = context?.metadata?.appId as string
  const profile = activeProfileName() ?? undefined
  const contextLogger = appId ? log.withContext({ appId, agentId: 'develop', ...(profile && { profile }) }) : logger

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
  const profile = activeProfileName() ?? undefined
  const contextLogger = appId ? log.withContext({ appId, agentId: 'develop', ...(profile && { profile }) }) : logger

  contextLogger.info('develop_agent.tool.execution.complete', {
    toolName
  });

  const resultObj = result as any
  const argsObj = args as any

  // Track specific development operations
  if ((toolName === 'str_replace_based_edit_tool' || toolName === 'textEditor') && (resultObj?.success || typeof result === 'string')) {
    contextLogger.info('develop_agent.tool.file_edit.success', {
      filePath: argsObj?.path || resultObj.filePath || resultObj.path || 'unknown',
      operation: argsObj?.command || resultObj.operation || 'edit'
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

  // Track skill tool usage for step-based inactivity management
  if (toolName.includes('__')) {
    const skillName = toolName.split('__')[0];
    const conversationId = context?.metadata?.conversationId;
    const stepNumber = context?.metadata?.stepNumber;

    if (skillName && typeof conversationId === 'string' && typeof stepNumber === 'number') {
      try {
        skillToolManager.updateSkillUsage(conversationId, skillName, stepNumber);
        contextLogger.debug('develop_agent.skill_tool.usage_tracked', {
          skillName,
          toolName,
          stepNumber
        });
      } catch (error) {
        contextLogger.warn('develop_agent.skill_tool.usage_tracking_failed', {
          skillName,
          toolName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return result
}

/**
 * Build the comprehensive system prompt for the Develop Agent
 */
type BehaviorPrompt = {
  fileName: string
  includeWhenModelMissing?: boolean
  modelFilters: string[]
}

const behaviorPrompts: BehaviorPrompt[] = [
  {
    fileName: 'claude-behavior.md',
    includeWhenModelMissing: true,
    modelFilters: ['anthropic', 'claude', 'opus', 'sonnet'],
  },
  {
    fileName: 'kimi-behavior.md',
    modelFilters: ['kimi'],
  },
]

function shouldLoadBehavior(modelName: string | undefined, behavior: BehaviorPrompt): boolean {
  if (!modelName) {
    return behavior.includeWhenModelMissing === true
  }

  const normalizedModelName = modelName.toLowerCase()
  return behavior.modelFilters.some(filter => normalizedModelName.includes(filter))
}

async function buildDevelopSystemPrompt(
  _appPath?: string,
  modelName?: string,
  options?: { market?: string },
): Promise<string> {
  const promptBuilder = createPromptBuilder();

  // Get modular prompt paths using helper utility
  const paths = getModularPromptPaths(import.meta.url);

  // Eval prompt variants. The injection plumbing for offline A/Bs: a gosym eval
  // run swaps or adds a develop-prompt fragment for one build, gated by a profile
  // flag. Inert by default (no flag set → empty resolution → byte-identical to
  // prod) and fail-closed (a set-but-missing variant or an invalid replace target
  // throws, rather than silently running control and corrupting the trial). The
  // variants table and resolution rules live in develop-prompt-variants.ts; see
  // src/prompts/develop/experiments/README.md for the workflow.
  const variants = resolveEvalPromptVariants({
    variants: EVAL_PROMPT_VARIANTS,
    isFlagSet: (flag) => profileFlag(flag, false),
    resolveVariantPath: (fileName) => paths.getAgentFile('develop/experiments', fileName),
    exists: existsSync,
  });

  // Resolve a canonical fragment to its `replace` variant when one is active,
  // else the canonical path. Routed through every replaceable .file() below so a
  // replace variant works for any fragment in REPLACEABLE_FRAGMENTS, not just two.
  const resolveFragment = (canonicalName: string, canonicalPath: string): string =>
    variants.replacements.get(canonicalName) ?? canonicalPath;

  // PREPEND variants inject before core.md, so apply them here (before the main
  // promptBuilder composition below). APPEND variants run after the technical
  // fragments; REPLACE variants are consulted inline by resolveFragment.
  for (const prependPath of variants.prependPaths) {
    promptBuilder.file(prependPath);
  }

  // Get available skills list with whenToUse guidance
  const skillLoader = new SkillLoaderTool();
  const skillsResult = await skillLoader.listSkills({ market: options?.market, agentId: 'develop' });
  const skillsSection = skillsResult.success && skillsResult.skills?.length
    ? buildSkillsPromptSection(skillsResult.skills)
    : '';

  // Load filesystem.md as a template (contains {{persistentPublicPath}} and {{persistentPrivatePath}} placeholders)
  const filesystemTemplate = await readFile(paths.getSharedFile('filesystem.md'), 'utf-8');
  const activeBehaviorPrompts = behaviorPrompts.filter(behavior => shouldLoadBehavior(modelName, behavior))

  logger.debug('develop_agent.prompt.behavior.loaded', {
    modelName: modelName ?? 'unknown',
    behaviorPrompts: activeBehaviorPrompts.map(behavior => behavior.fileName),
  })

  if (modelName && activeBehaviorPrompts.length === 0) {
    logger.warn('develop_agent.prompt.behavior.no_match', { modelName })
  }

  // Load consolidated prompt sections
  // Order: Identity → Voice → Technical details
  // core.md and communication.md may be swapped by a 'replace' experiment arm;
  // security.md is never replaceable (tenant/security constraints must survive
  // verbatim).
  promptBuilder
    .file(resolveFragment('core.md', paths.getAgentFile('develop', 'core.md')))
    .file(resolveFragment('communication.md', paths.getSharedFile('communication.md')))
    .file(paths.getSharedFile('security.md'))
    .file(paths.getSharedFile('consent-requirements.md'))

  for (const behavior of activeBehaviorPrompts) {
    promptBuilder.file(paths.getAgentFile('develop', behavior.fileName))
  }

  promptBuilder
    .template(filesystemTemplate) // Use template instead of file for dynamic path interpolation
    .file(resolveFragment('font-theme.md', paths.getAgentFile('develop', 'font-theme.md'))) // Font theme tool documentation
    //.file(paths.getAgentFile('develop', 'design.md'))

  // Content layer guidance (Five Rules + content_scaffold usage). Gated by the
  // same flag as the content_scaffold tool in the activeTools resolver, so the
  // agent only sees the instructions when it can act on them.
  if (profileFlag('develop.contentSystem', false)) {
    promptBuilder.file(paths.getAgentFile('develop', 'content-layer.md'))
  }

  if (profileFlag('develop.promptOptimization', true)) {
    promptBuilder.file(paths.getAgentFile('develop', 'prompt-optimization.md'))
  }

  if (profileFlag('develop.suggestedResponse', false)) {
    promptBuilder.file(paths.getAgentFile('develop', 'suggested-response.md'))
  }

  promptBuilder
    .file(resolveFragment('handoff.md', paths.getAgentFile('develop', 'handoff.md')))
    .file(resolveFragment('backend.md', paths.getAgentFile('develop', 'backend.md')))
    .file(resolveFragment('frontend.md', paths.getAgentFile('develop', 'frontend.md')))
    .file(resolveFragment('seo.md', paths.getAgentFile('develop', 'seo.md')))
    .file(resolveFragment('secrets.md', paths.getAgentFile('develop', 'secrets.md'))) // Secrets management for API keys and credentials

  if (isAutomationsEnabled()) {
    promptBuilder.file(paths.getAgentFile('develop', 'automations.md'))
  }

  // APPEND variants run after the technical fragments. Log hard evidence of what
  // this build actually did: which variant flags applied, and the concrete files
  // injected / fragments replaced — so an eval run is attributable and
  // reproducible (default-off → all false / empty arrays).
  for (const appendPath of variants.appendPaths) {
    promptBuilder.file(appendPath);
  }
  logger.info('develop_agent.prompt.eval_variant', {
    active: variants.active,
    injectedFiles: injectedFileNames(variants),
    replacedFragments: replacedFragmentNames(variants),
  });

  // Skills section at end of prompt for emphasis — agent decides from this list directly
  if (skillsSection) {
    promptBuilder.text(`\n${skillsSection}\n`);
  }

  // Template descriptions are now dynamically injected during conversation execution
  // via AILibContextManager.buildContextMessages() based on app context

  // Build with context containing dynamic persistent asset paths
  const persistentAssetPaths = getPersistentAssetPaths();
  return await promptBuilder.build(persistentAssetPaths);
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
 * Create the Develop Agent configuration. A single agent serves every profile;
 * profile-driven differences are resolved per turn via callable `system` and
 * `activeTools`. profileFlag() works inside resolvers because both transports
 * wrap LLM execution in runWithProfile().
 */
export async function createDevelopAgent(options?: { appPath?: string }): Promise<AgentConfig> {
  const appPath = options?.appPath || process.cwd()
  const { model, modelName } = await getAgentModelWithName('full') // Use full model for complex development tasks

  const baseTools = {
    // Core development tools
    directoryListing: allAILibTools.directoryListing,
    terminalCommand: allAILibTools.terminalCommand,
    str_replace_based_edit_tool: allAILibTools.str_replace_based_edit_tool,
    readFile: allAILibTools.readFile,
    grepSearch: allAILibTools.grepSearch,

    // Planning tools
    todoList: allAILibTools.todoList,

    // Project setup
    setProjectName: allAILibTools.setProjectName,

    // Skills system
    skill: allAILibTools.skill,

    // Server management
    serverRestart: allAILibTools.serverRestart,
    viewLogs: allAILibTools.viewLogs,

    // Specialized development tools
    httpCheck: allAILibTools.httpCheck,
    media: allAILibTools.media,
    qrCode: allAILibTools.qrCode,
    websiteScraper: allAILibTools.websiteScraper,

    // Color scheme + font theme tools
    colorScheme: allAILibTools.colorScheme,
    fontTheme: allAILibTools.fontTheme,

    // UI kit reference loader
    loadUiKit: allAILibTools.loadUiKit,

    // Rebuild tools
    rebuildPageSelector: allAILibTools.rebuildPageSelector,

    // Profile-gated — visibility controlled by the activeTools resolver below.
    askQuestion: allAILibTools.askQuestion,
    suggestedResponse: allAILibTools.suggestedResponse,

    // Content layer (gated by develop.contentSystem in the activeTools resolver).
    content_scaffold: allAILibTools.content_scaffold,

    // Secrets management (for API keys, credentials)
    requestSecrets: allAILibTools.requestSecrets,
  }

  return {
    id: 'develop',
    name: 'AI Developer',
    system: async (ctx: ResolverContext): Promise<string> =>
      buildDevelopSystemPrompt(appPath, modelName, { market: ctx.market }),
    model,
    modelName,
    tools: baseTools,
    activeTools: async (): Promise<string[]> => {
      const allow = new Set(Object.keys(baseTools))
      if (!profileFlag('develop.promptOptimization', true)) {
        allow.delete('askQuestion')
      }
      if (!profileFlag('develop.suggestedResponse', false)) {
        allow.delete('suggestedResponse')
      }
      if (!profileFlag('develop.contentSystem', false)) {
        allow.delete('content_scaffold')
      }
      return Array.from(allow)
    },

    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,
    logger: createAgentTelemetryLogger('develop'),

    // Handoff configuration
    handoffs: [
      {
        agentName: 'marketing',
        description: skills.isEnabled('social')
          ? 'SEO optimization, marketing strategy, marketing campaigns, promotions, and social media (Facebook, Instagram publishing, connecting social accounts, creating social posts)'
          : 'SEO optimization, marketing strategy, and marketing campaigns for websites',
      },
    ],

    maxSteps: 100,
    temperature: 0.3,
    maxOutputTokens: 32000,
    timeout: { stepMs: 600_000 },

    // Union across profiles — entries are inert when their tool isn't active.
    stopAfterTools: ['askQuestion'],
    stopWhen: [shouldStopAfterSuggestMode],

    // Enable prompt caching for cost savings and performance
    // The develop agent has a large system prompt (~10K+ tokens) making it ideal for caching
    enablePromptCaching: true,

    metadata: {
      systemForModel: (nextModelName: string, ctx?: ResolverContext) =>
        buildDevelopSystemPrompt(appPath, nextModelName, { market: ctx?.market }),
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
    defaultAgentId: 'develop'
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
