import {
  createAgentFactory,
  type AgentConfig,
  type BeforeToolExecutionHook,
  type AfterToolExecutionHook,
  type AgentContext,
  type ResolverContext,
  createPromptBuilder,
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
import { createAgentHandoffTool } from '../tools/create-agent-handoff-tool.js'
import { turnscriptAITool, turnscriptReportedFailure } from '../tools/ai-lib-tools/turnscript/turnscript-tool.js'
import { getPersistentAssetPaths } from '../utils/persistent-assets.js'
import { skills } from '../services/features.js'
import { getSwitchboardFlag } from '../services/switchboard.js'
import { profileFlag, activeProfileName } from '../profiles/profile-accessor.js'
import { isTurnscriptEnabled } from './turnscript-context.js'
import {
  EVAL_PROMPT_VARIANTS,
  resolveEvalPromptVariants,
  injectedFileNames,
  replacedFragmentNames,
} from './develop-prompt-variants.js'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

function developSubAgentsEnabled(): boolean {
  return getSwitchboardFlag('airo-builder-develop-subagents', false)
}

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
 * Tracks, per conversation, whether the most recent `turnscript` step ended in a
 * failure that advised a direct-tool fallback. When a direct discovery/edit tool
 * then runs in the same conversation we emit one `develop_agent.turnscript.fallback`
 * event and clear the flag (one fallback counted per failed turnscript step). Mirrors
 * the in-memory, conversationId-keyed pattern used by skillToolManager.
 */
const lastTurnscriptFailedByConversation = new Map<string, boolean>()
const DIRECT_FALLBACK_TOOLS = new Set([
  'readFile',
  'grepSearch',
  'directoryListing',
  'str_replace_based_edit_tool',
])

/**
 * Direct-tool admit state. Tracks, per conversation, whether a `turnscript` call
 * has reported a failure and thereby ADMITTED the 4 direct discovery/edit tools
 * for the rest of that conversation. Reset scope is sticky-for-conversation: once
 * a turnscript failure occurs the direct tools stay admitted until the conversation
 * ends (its entry is never cleared). The activeTools resolver reads this map (keyed
 * by ResolverContext.conversationId) only when turnscript is enabled.
 *
 * Admit trigger: ANY turnscript failure output (`turnscriptReportedFailure()` true) —
 * recoverable kinds (blocked/compile/not_a_function/dispatch_cap/timeout),
 * `runtime_throw` (a genuine tool error, e.g. old_str not found — exactly where a
 * single-shot direct edit helps recover), and generic harness errors. All are cases
 * where letting the model finish directly aids recovery, so admit on all of them.
 */
const directToolsAdmittedByConversation = new Map<string, boolean>()

/**
 * Bound the per-conversation maps so this long-lived per-app agent process can't grow them
 * without limit. FIFO eviction (Map preserves insertion order) once over the cap — the
 * evicted (oldest) conversation just loses its sticky fallback/admit state, which is benign.
 */
const MAX_CONVERSATION_ENTRIES = 1000
function boundedSet<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key) && map.size >= MAX_CONVERSATION_ENTRIES) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

/** Whether the 4 direct discovery/edit tools have been admitted for this conversation. */
export function directToolsAdmitted(conversationId: string | undefined): boolean {
  return typeof conversationId === 'string' && directToolsAdmittedByConversation.get(conversationId) === true
}

/** Test-only: clear the per-conversation turnscript fallback + admit maps. */
export function __resetTurnscriptConversationState(): void {
  lastTurnscriptFailedByConversation.clear()
  directToolsAdmittedByConversation.clear()
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

  // Turnscript fallback tracking (spike telemetry): record when a direct tool runs
  // after a failed turnscript step so the eval can compute fallback-rate.
  const conversationId = context?.metadata?.conversationId
  if (typeof conversationId === 'string') {
    if (toolName === 'turnscript') {
      const failed = typeof result === 'string' && turnscriptReportedFailure(result)
      boundedSet(lastTurnscriptFailedByConversation, conversationId, failed)

      // A turnscript call just ran, so turnscript is enabled. On failure, admit the 4
      // direct tools for the rest of this conversation (sticky), emitting one admit
      // event on the false→true edge.
      if (failed && !directToolsAdmittedByConversation.get(conversationId)) {
        boundedSet(directToolsAdmittedByConversation, conversationId, true)
        contextLogger.info('develop_agent.turnscript.admit', {
          conversationId,
          trigger: (typeof result === 'string' ? result.match(/^\[turnscript[^\]]*\]/m)?.[0] : undefined) ?? 'turnscript_failure',
        })
      }
    } else if (DIRECT_FALLBACK_TOOLS.has(toolName) && lastTurnscriptFailedByConversation.get(conversationId)) {
      contextLogger.info('develop_agent.turnscript.fallback', { toolName })
      boundedSet(lastTurnscriptFailedByConversation, conversationId, false)
    }
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
  options?: { contextMetadata?: Record<string, unknown> },
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
  const market: string | undefined = typeof options?.contextMetadata?.market === 'string' ? options.contextMetadata.market : undefined;
  const skillsResult = await skillLoader.listSkills({ market, agentId: 'develop', contextMetadata: options?.contextMetadata });
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

  // Content layer guidance (Five Rules + content_scaffold usage). Always on:
  // the develop agent authors content-backed, inline-editable markup for every app.
  promptBuilder.file(paths.getAgentFile('develop', 'content-layer.md'))

  // Sub-agent orchestration guidance — only when the develop sub-agents
  // feature is enabled (otherwise the post-stream validator still asks the
  // agent to fix inline, so this delegation guidance would contradict it).
  if (developSubAgentsEnabled()) {
    promptBuilder.file(paths.getAgentFile('develop', 'sub-agent-orchestration.md'))
  }

  if (profileFlag('develop.promptOptimization', true)) {
    promptBuilder.file(paths.getAgentFile('develop', 'prompt-optimization.md'))
  }

  if (profileFlag('develop.suggestedResponse', false)) {
    promptBuilder.file(paths.getAgentFile('develop', 'suggested-response.md'))
  }

  // Turnscript nudge — added when turnscript is enabled for this turn (resolved
  // upstream from the Switchboard flag + shopperId, read here via the ALS context).
  if (isTurnscriptEnabled()) {
    promptBuilder.text([
      '',
      '## Turnscript (PREFERRED for discovering, reading and editing files)',
      'A `turnscript` tool is available. Instead of separate discovery/read/edit tool calls',
      '(each a round-trip), write ONE async orchestration script that calls the typed',
      '`turnscript.directoryListing / turnscript.grepSearch / turnscript.readFile /',
      'turnscript.str_replace_based_edit_tool` API (the SAME tools you know) and returns a',
      'short summary. Batch independent up-front reads with Promise.all, then loop the',
      'editor over every change. The direct directoryListing, grepSearch, readFile and',
      'str_replace_based_edit_tool start UNAVAILABLE — do file discovery, reads and edits',
      'through `turnscript`.',
      '',
      'If a `turnscript` call reports a recoverable failure, the direct directoryListing,',
      'grepSearch, readFile and str_replace_based_edit_tool tools become available for the',
      'remainder of this conversation — use them to finish that turn\'s remaining edits',
      'directly (do NOT rewrite the failed script). Other tools (terminal, media, skills,',
      'requestSecrets, handoff, etc.) are called normally.',
      '',
    ].join('\n'))
  }

  promptBuilder
    .file(resolveFragment('handoff.md', paths.getAgentFile('develop', 'handoff.md')))
    .file(resolveFragment('backend.md', paths.getAgentFile('develop', 'backend.md')))
    .file(resolveFragment('frontend.md', paths.getAgentFile('develop', 'frontend.md')))
    .file(resolveFragment('seo.md', paths.getAgentFile('develop', 'seo.md')))
    .file(resolveFragment('secrets.md', paths.getAgentFile('develop', 'secrets.md'))) // Secrets management for API keys and credentials

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
 * Compute the develop agent's active tool allow-list from the raw tool names
 * and the resolved feature flags. Pure so it is unit-testable without the
 * profile/Switchboard runtime. runAgent/awaitAgents are hidden unless the
 * develop sub-agents flag is on, keeping the off-state byte-identical to the
 * pre-feature tool set.
 */
export function developActiveToolNames(
  allToolNames: string[],
  flags: { promptOptimization: boolean; suggestedResponse: boolean; developSubAgents: boolean },
): string[] {
  const allow = new Set(allToolNames)
  if (!flags.promptOptimization) {
    allow.delete('askQuestion')
  }
  if (!flags.suggestedResponse) {
    allow.delete('suggestedResponse')
  }
  if (!flags.developSubAgents) {
    allow.delete('runAgent')
    allow.delete('awaitAgents')
  }
  return Array.from(allow)
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

    // Content layer (always active — see content-layer.md prompt).
    content_scaffold: allAILibTools.content_scaffold,

    // Secrets management (for API keys, credentials)
    requestSecrets: allAILibTools.requestSecrets,

    // Sub-agent delegation — visibility controlled by the activeTools resolver
    // below (gated on the develop sub-agents Switchboard flag).
    runAgent: allAILibTools.runAgent,
    awaitAgents: allAILibTools.awaitAgents,

    // Turnscript — gated by the appbuilder-turnscript Switchboard flag (+ optional
    // appbuilder-turnscript-tla-only) via the activeTools resolver below. Exposes main's
    // existing directoryListing/grepSearch/readFile/str_replace_based_edit_tool as a
    // callable turnscript.* API so the model orchestrates discovery + edits in ONE turn
    // instead of per-call round-trips.
    turnscript: turnscriptAITool,
  }

  return {
    id: 'develop',
    name: 'AI Developer',
    system: async (ctx: ResolverContext): Promise<string> =>
      buildDevelopSystemPrompt(appPath, modelName, { contextMetadata: ctx.contextMetadata }),
    model,
    modelName,
    tools: baseTools,
    activeTools: async (ctx: ResolverContext): Promise<string[]> => {
      const allow = new Set(
        developActiveToolNames(Object.keys(baseTools), {
          promptOptimization: profileFlag('develop.promptOptimization', true),
          suggestedResponse: profileFlag('develop.suggestedResponse', false),
          developSubAgents: developSubAgentsEnabled(),
        }),
      )
      // Turnscript on/off (resolved upstream from the Switchboard flag + shopperId and
      // read here via the ALS context):
      //   disabled — hide `turnscript`, keep the direct tools (== plain main).
      //   enabled  — start with turnscript only; admit the 4 direct tools for the rest of the
      //              conversation once a turnscript call has failed (see
      //              directToolsAdmittedByConversation, flipped in afterToolExecution and
      //              keyed by ctx.conversationId).
      if (!isTurnscriptEnabled()) {
        allow.delete('turnscript')
      } else if (!directToolsAdmitted(ctx?.conversationId)) {
        allow.delete('directoryListing')
        allow.delete('grepSearch')
        allow.delete('readFile')
        allow.delete('str_replace_based_edit_tool')
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
        buildDevelopSystemPrompt(appPath, nextModelName, { contextMetadata: ctx?.contextMetadata }),
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
      handoff: createAgentHandoffTool({
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
