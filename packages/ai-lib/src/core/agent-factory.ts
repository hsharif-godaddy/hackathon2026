/**
 * AgentFactory - Modern agent factory using AI SDK 6's ToolLoopAgent
 *
 * Provides agentic loop control, streaming, tool management, and agent handoffs.
 */

import { propagateAttributes } from '@langfuse/tracing'
import { ToolLoopAgent, stepCountIs, tool } from 'ai'
import { APICallError } from '@ai-sdk/provider'
import type {
  PrepareStepFunction,
  ToolLoopAgentOnFinishCallback,
  ToolLoopAgentOnStepFinishCallback,
  Tool,
  ToolExecutionOptions,
  ModelMessage,
  SystemModelMessage
} from 'ai'
import type { GlobalAgentConfig, AgentContext, ProcessedFile, AgentConfig } from './types.js'
import type { PipelineContextMessage, ContextPipeline } from './context-pipeline.js'
import { createDefaultPipeline } from './context-normalization.js'
import { createDuplicateResponseStopCondition } from './duplicate-detection.js'
import { mergeProviderOptions } from '../utils/model-normalization.js'
import { createLogger, serializeError, isBudgetExceededAPIError, BudgetExceededError, retryWithBackoff, type RetryContext } from '@airo/ai-common'
import { addCacheControlToSystemPrompt, logCachingStats } from '../utils/prompt-caching.js'
import { getModel, llmMetadataContext, type LitellmMetadata } from '../providers/unified-provider.js'
import { getActiveModelOverride } from './model-override-context.js'
import {
  buildLitellmMetadataFromContext,
  LlmCallSource,
  grantSessionManager,
  isGrantsExhausted,
  GrantErrorCode,
} from '@airo/ai-grants'
import type { ExecutionContext } from '@airo/ai-grants'

const logger = createLogger('agent-factory')

/**
 * Filter an object to only include JSON-serializable values (primitives, plain objects, arrays).
 * Strips class instances, functions, Timeouts, Maps, etc. that would cause issues during logging.
 */
function filterSerializableValues(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = value
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    } else if (Array.isArray(value)) {
      result[key] = value
    } else if (typeof value === 'object' && value.constructor === Object) {
      result[key] = value
    }
    // Skip: class instances, functions, Maps, Sets, Timeouts, etc.
  }
  return result
}

/**
 * Like the AI SDK's `hasToolCall`, but only triggers when the tool call
 * is considered successful because it produced a matching `tool-result`.
 * This allows the LLM to retry when a stopAfterTools call results in a
 * `tool-error` (for example, when a tool call fails validation).
 */
export function hasSuccessfulToolCall(toolName: string) {
  return ({ steps }: { steps: Array<{ content: Array<{ type: string; toolName?: string; toolCallId?: string }> }> }): boolean => {
    for (const step of steps) {
      const matchingCall = step.content.find(
        item => item.type === 'tool-call' && item.toolName === toolName
      )
      if (!matchingCall) continue

      // Only stop if the tool call produced a successful result
      const hasResult = step.content.some(
        item => item.type === 'tool-result' && item.toolCallId === matchingCall.toolCallId
      )
      if (hasResult) return true
    }
    return false
  }
}

/**
 * Maximum grant retry attempts to prevent infinite loops
 */
const MAX_GRANT_RETRIES = 3;

/** User-facing message when all credit grants are exhausted */
const GRANTS_EXHAUSTED_MESSAGE = 'All credit grants have been exhausted. Please purchase more credits.';

/**
 * Extract LiteLLM metadata from execution context for per-request cost tracking
 * Uses the new grant-aware buildLitellmMetadataFromContext helper.
 *
 * @param executionContext - The execution context passed from the caller
 * @param agentId - The keyword identifier of the current agent (e.g., 'develop', 'initial')
 * @returns LiteLLM metadata object with grant user or fallback to customerId
 */
function extractLitellmMetadata(
  executionContext?: Record<string, unknown>,
  agentId?: string
): LitellmMetadata | null {
  return buildLitellmMetadataFromContext(executionContext, {
    agentId,
    source: LlmCallSource.UserChat,
  })
}

/**
 * Extended stream result type for tool validation errors
 * Allows marking mock streams with validation error flags
 */
export interface StreamResultWithValidation {
  textStream: AsyncIterable<string>
  baseStream?: unknown

  response?: PromiseLike<{ id: string; timestamp: Date; modelId: string; headers?: Record<string, string>; body?: any }>
  getFinalResult: () => Promise<any>
  isToolValidationError?: boolean
  validationErrorMessage?: string
}

/**
 * Tool execution hook function types
 */
export type BeforeToolExecutionHook = (toolName: string, args: unknown, context?: AgentContext) => Promise<unknown> | unknown
export type AfterToolExecutionHook = (toolName: string, args: unknown, result: unknown, toolCallError: unknown, context?: AgentContext) => Promise<unknown> | unknown

/**
 * Agent handoff configuration
 */
export interface AgentHandoffConfig {
  /** Name/identifier of the target agent */
  agentName: string
  /** Description of when this handoff should be used */
  description?: string
  /** Whether to include conversation context in handoff */
  includeContext?: boolean
}

/**
 * Handoff execution context
 */
export interface HandoffContext {
  /** Task description for the target agent */
  task: string
  /** Additional context data */
  context?: Record<string, unknown> | undefined
  /** Parameters to pass to the target agent */
  parameters?: Record<string, unknown> | undefined
  /** Metadata about the handoff */
  metadata?: {
    sourceAgent: string
    timestamp: string
    reason?: string | undefined
  } | undefined
}

/**
 * Handoff execution result
 */
export interface HandoffResult {
  /** Whether the handoff was successful */
  success: boolean
  /** Result from the target agent */
  result?: unknown
  /** Error message if handoff failed */
  error?: string
  /** Handoff execution details */
  handoffDetails: {
    sourceAgent: string
    targetAgent: string
    timestamp: string
    context: HandoffContext
  }
}

/**
 * Handoff history entry
 */
export interface HandoffHistoryEntry {
  /** Unique identifier for this handoff */
  id: string
  /** Source agent name */
  sourceAgent: string
  /** Target agent name */
  targetAgent: string
  /** Timestamp of handoff */
  timestamp: string
  /** Task description */
  task: string
  /** Handoff context */
  context: HandoffContext
  /** Result of the handoff */
  result?: HandoffResult
  /** Status of the handoff */
  status: 'pending' | 'completed' | 'failed'
}

/**
 * Configuration for creating an agent
 */

/**
 * Wrapper around ToolLoopAgent to provide consistent API
 */
/**
 * Call options type for ToolLoopAgent
 * Empty object for now - can be extended for dynamic model selection
 */
type AgentCallOptions = {
  executionContext?: Record<string, unknown> | undefined
  contextMessages?: PipelineContextMessage[]
  conversationMessages?: ModelMessage[]
  files?: ProcessedFile[]
  basePrompt?: string
}

/**
 * Cache point metadata structure (stored format)
 */
interface CachePointMetadata {
  type: 'ephemeral'
}

/**
 * Provider-specific options with proper type structure
 */
interface ProviderOptions {
  anthropic?: {
    cacheControl?: { type: string }

    [key: string]: any
  }

  [key: string]: any
}

/**
 * Message with cache point metadata (stored format from conversation history)
 * Using type alias instead of interface extends to support union types
 *
 * @internal - For future type safety improvements
 */
export type MessageWithCachePoint = ModelMessage & {
  cachePoint?: CachePointMetadata
  providerOptions?: ProviderOptions
}

export class AgentWrapper {
  // Using explicit empty call options type instead of 'any' to avoid 'as never' casts
  // The second and third generics remain 'any' as they're provider-internal types

  private agent: ToolLoopAgent<AgentCallOptions, any, any>
  private config: AgentConfig
  private skillToolProvider?: GlobalAgentConfig['skillToolProvider']
  private currentConversationId: string | undefined
  private currentStepNumber: number = 0
  // Base tool names (excludes all skill tools) — computed once in prepareCall.
  // Used by prepareStep to build the activeTools list without recomputing each step.
  private currentBaseToolNames: string[] | undefined
  private turnCount: number = 0
  private pipeline: ContextPipeline
  private overrideAgents = new Map<string, AgentWrapper>()
  private onSkillsLoadedConversations = new Set<string>()
  private onSkillsLoadAttempts = new Map<string, number>()

  constructor(config: AgentConfig, skillToolProvider?: GlobalAgentConfig['skillToolProvider']) {
    this.config = config
    this.skillToolProvider = skillToolProvider
    this.pipeline = config.contextPipeline ?? createDefaultPipeline()

    // Build stopWhen conditions
    const stopWhen = []

    // Add duplicate response detection to prevent infinite loops.
    // This must be the first stopWhen condition so that the core safety check
    // is always evaluated before any custom OR-ed stop conditions that might
    // also trigger or short-circuit evaluation.
    stopWhen.push(createDuplicateResponseStopCondition())

    // Add max steps condition
    if (config.maxSteps) {
      stopWhen.push(stepCountIs(config.maxSteps))
    }

    // Add stop after specific tools — only when the tool succeeded (no tool-error).
    // This allows the LLM to retry when a stopAfterTools call fails validation.
    if (config.stopAfterTools) {
      stopWhen.push(...config.stopAfterTools.map(toolName => hasSuccessfulToolCall(toolName)))
    }

    // Add custom stop conditions
    if (config.stopWhen) {
      stopWhen.push(...config.stopWhen)
    }

    // Wrap tools with execution hooks if provided
    const wrappedTools = this.wrapToolsWithHooks(config.tools || {})

    // Disable SDK-native retries — retryWithBackoff handles retries with proper
    // error classification (429/5xx), jitter, and structured logging.
    // The SDK only retries when isRetryable===true, which most providers don't set.
    const maxRetries = 0

    const telemetryHooks = this.createTelemetryHooks(config.logger)

    // Apply prompt caching to system prompt if enabled
    let systemPrompt: string | SystemModelMessage | SystemModelMessage[] | undefined = config.system
    if (config.enablePromptCaching && config.system) {
      const cachingStrategy = typeof config.enablePromptCaching === 'object'
        ? config.enablePromptCaching
        : {}
      systemPrompt = addCacheControlToSystemPrompt(config.system, config.model, cachingStrategy)
    }

    // Create the ToolLoopAgent
    this.agent = new ToolLoopAgent({
      model: config.model,
      ...(systemPrompt && { instructions: systemPrompt }),
      tools: wrappedTools,
      ...(config.temperature !== undefined && { temperature: config.temperature }),
      ...(config.maxOutputTokens !== undefined && { maxOutputTokens: config.maxOutputTokens }),
      stopWhen: stopWhen.length > 0 ? stopWhen : [stepCountIs(10)], // Default max 10 steps
      // Pass provider-specific options (e.g., effort, disableParallelToolUse for Anthropic)
      ...(config.providerOptions && { providerOptions: config.providerOptions as any }),
      maxRetries,
      // Enable OpenTelemetry telemetry for Elastic APM and Langfuse integration
      experimental_telemetry: { isEnabled: true, functionId: `agent-${config.name}` },
      prepareStep: telemetryHooks.prepareStep,
      onStepFinish: telemetryHooks.onStepFinish,
      onFinish: telemetryHooks.onFinish,
      prepareCall: async ({ options, ...callParameters }) => {
        const callOptions = (options as AgentCallOptions | undefined) || {}

        const { prompt: incomingPrompt, ...rest } = callParameters

        const promptText = typeof incomingPrompt === 'string' ? incomingPrompt : undefined
        const basePrompt = callOptions.basePrompt ?? promptText ?? ''

        const conversationMessages = callOptions.conversationMessages || []

        const preparedCall = { ...rest } as typeof callParameters

        this.turnCount++

        const executionContext = callOptions.executionContext as Record<string, any> | undefined
        this.currentConversationId = executionContext?.metadata?.conversationId as string | undefined

        // Call onSkillsLoad callback to inject skill context messages before the pipeline.
        // Retries up to 3 times on failure/empty return, then gives up for that conversation.
        const contextMessages = [...(callOptions.contextMessages ?? [])]
        const maxSkillsLoadAttempts = 3
        if (
          this.currentConversationId
          && this.config.onSkillsLoad
          && !this.onSkillsLoadedConversations.has(this.currentConversationId)
          && (this.onSkillsLoadAttempts.get(this.currentConversationId) ?? 0) < maxSkillsLoadAttempts
        ) {
          const attempts = (this.onSkillsLoadAttempts.get(this.currentConversationId) ?? 0) + 1
          this.onSkillsLoadAttempts.set(this.currentConversationId, attempts)
          try {
            const skillMessages = await this.config.onSkillsLoad(this.currentConversationId)
            if (skillMessages.length > 0) {
              contextMessages.push(...skillMessages)
              this.onSkillsLoadedConversations.add(this.currentConversationId)
              this.onSkillsLoadAttempts.delete(this.currentConversationId)
            } else {
              logger.warn('agent.on_skills_load.empty_result', {
                agentName: this.config.name,
                conversationId: this.currentConversationId,
                attempt: attempts,
                maxAttempts: maxSkillsLoadAttempts
              })
            }
          } catch (error) {
            logger.warn('agent.on_skills_load.failed', {
              agentName: this.config.name,
              conversationId: this.currentConversationId,
              attempt: attempts,
              maxAttempts: maxSkillsLoadAttempts,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }

        const transformed = await this.pipeline.transformContext({
          userMessage: basePrompt,
          ...(callOptions.files ? { files: callOptions.files } : {}),
          contextMessages,
          conversationMessages: conversationMessages,
          executionContext: callOptions.executionContext ?? {},
          turnIndex: this.turnCount - 1,
        })
        preparedCall.messages = this.pipeline.convertToLlm({
          ...transformed,
          model: this.config.model,
          enablePromptCaching: this.config.enablePromptCaching ?? false,
          hasSystemPrompt: !!this.config.system,
        })

        if (callOptions.executionContext) {
          ;(preparedCall as typeof preparedCall & { experimental_context?: unknown }).experimental_context = callOptions.executionContext
        }

        // Compute base tool names once per run (everything except skill tools).
        // Skill cleanup also runs here — not per-step — so tools are never removed
        // mid-run. This keeps the tool definitions array stable between steps when
        // no new skills activate, preventing unnecessary Anthropic cache invalidation
        // (any change to tools busts all cache levels). New skills activated mid-run
        // ARE picked up in prepareStep via getActiveToolNames.
        this.currentBaseToolNames = undefined
        if (this.skillToolProvider) {
          try {
            const skillToolNames = new Set(this.skillToolProvider.getSkillToolNames())
            const allToolNames = Object.keys(this.config.tools || {})
            this.currentBaseToolNames = allToolNames.filter(name => !skillToolNames.has(name))

            // Run cleanup once at the start of the run (not per-step) to avoid
            // removing tools mid-run which would invalidate the Anthropic cache
            if (this.currentConversationId) {
              const deactivated = this.skillToolProvider.cleanupInactiveSkills(
                this.currentConversationId,
                this.currentStepNumber
              )
              if (deactivated.length > 0) {
                logger.info('agent.skills.auto_unloaded', {
                  agentName: this.config.name,
                  conversationId: this.currentConversationId,
                  skills: deactivated
                })
              }
            }
          } catch (error) {
            logger.error('agent.prepare_call.active_tools_snapshot_failure', {
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }

        return preparedCall
      }
    })
  }

  /**
   * Get agent name
   */
  getName(): string {
    return this.config.name
  }

  /**
   * Wrap tools with execution hooks and context passing
   */

  private wrapToolsWithHooks(tools: Record<string, any>): Record<string, Tool> {
    const wrappedTools: Record<string, Tool> = {}

    for (const [toolName, toolDefinition] of Object.entries(tools)) {
      if (!toolDefinition) {
        logger.warn('tool.invalid', { toolName })
        continue
      }

      wrappedTools[toolName] = this.wrapToolWithExecutionHooks(toolName, toolDefinition as Tool)
    }

    return wrappedTools
  }

  private wrapToolWithExecutionHooks(toolName: string, toolDefinition: Tool): Tool {
    const normalizedTool = tool(toolDefinition)
    const originalExecute = normalizedTool.execute

    if (typeof originalExecute !== 'function' || (!this.config.beforeToolExecution && !this.config.afterToolExecution)) {
      return normalizedTool
    }

    return tool({
      ...normalizedTool,
      execute: async (args: unknown, executionOptions: ToolExecutionOptions) => {
        let processedArgs = args
        const context = executionOptions?.experimental_context as AgentContext | undefined

        if (this.config.beforeToolExecution) {
          try {
            const hookResult = await this.config.beforeToolExecution(toolName, args, context)
            if (hookResult !== undefined) {
              processedArgs = hookResult
            }
          } catch (error) {
            logger.error('tool.hook.before.failure', { toolName, error })
          }
        }

        let toolCallResult: unknown
        let toolCallError: unknown

        try {
          toolCallResult = await originalExecute(processedArgs, executionOptions)
        } catch (error) {
          toolCallError = error
          const serializedError = serializeError(error)
          logger.error('tool.execution.failure', {
            toolName,
            args: processedArgs,
            error: serializedError,
            context: context ? {
              sessionId: context.sessionId,
              userId: context.userId,
              metadata: context.metadata ? filterSerializableValues(context.metadata) : undefined,
              messageCount: context.messages?.length,
              hasInitialContext: !!context.initialContextMessages?.length,
              timestamp: context.timestamp
            } : undefined
          })
          // Re-throw a clean error to avoid circular reference issues in AI SDK serialization
          const errorMessage = typeof serializedError.message === 'string' 
            ? serializedError.message 
            : String(error)
          const cleanError = new Error(errorMessage)
          cleanError.name = typeof serializedError.name === 'string' 
            ? serializedError.name 
            : 'ToolExecutionError'
          throw cleanError
        } finally {
          if (this.config.afterToolExecution) {
            try {
              const hookResult = await this.config.afterToolExecution(
                toolName,
                processedArgs,
                toolCallResult,
                toolCallError,
                context
              )
              if (hookResult !== undefined) {
                toolCallResult = hookResult
              }
            } catch (error) {
              logger.error('tool.hook.after.failure', { toolName, error })
            }
          }
        }

        return toolCallResult
      }
    })
  }

  /**
   * Move the cache breakpoint to the last message so each step's new content
   * is included in the cached prefix. Removes the previous advancing
   * breakpoint from assistant/tool messages while preserving pre-existing
   * breakpoints on user messages (e.g. conversation summary).
   *
   * INVARIANT: Pre-existing breakpoints must only appear on user-role messages.
   * Any breakpoint on an assistant or tool message is assumed to be from a prior
   * advancing step and will be removed.
   */
  private advanceCacheBreakpoint(messages: ModelMessage[]): ModelMessage[] | null {
    const lastIndex = messages.length - 1
    if (lastIndex < 0) return null

    // Check if the last message already has a cache breakpoint
    const lastMsg = messages[lastIndex] as any
    if (lastMsg.providerOptions?.anthropic?.cacheControl) {
      return null // Already has breakpoint, nothing to do
    }

    // Build updated messages: remove old advancing breakpoint, add new one on last message.
    // We only remove breakpoints that were placed by addCacheControlToMessages (on non-summary
    // messages). Pre-existing breakpoints (e.g. conversation summary with cachePoint) are
    // kept — they provide a stable intermediate cache layer.
    const updated = messages.map((msg, index) => {
      const msgAny = msg as any
      const hasBreakpoint = msgAny.providerOptions?.anthropic?.cacheControl

      if (index === lastIndex && !hasBreakpoint) {
        // Add breakpoint to the new last message
        return {
          ...msg,
          providerOptions: {
            ...(msgAny.providerOptions || {}),
            anthropic: {
              ...(msgAny.providerOptions?.anthropic || {}),
              cacheControl: { type: 'ephemeral' }
            }
          }
        } as ModelMessage
      }

      // Remove the previous advancing breakpoint from assistant/tool messages.
      // User-role breakpoints are preserved — these come from the conversation
      // summary or (on first-turn) from addCacheControlToMessages tagging the
      // user question. On first-turn the arithmetic is still safe:
      //   system(1) + summary(1) + first-user(1) + advancing(1) = 4 slots.
      // On subsequent turns addCacheControlToMessages tags the last history
      // message (not a user question), so the user-role set stays at {summary}.
      if (hasBreakpoint && msgAny.role !== 'user') {
        const { cacheControl, ...restAnthropicOptions } = msgAny.providerOptions.anthropic
        // Build new providerOptions from scratch — only include providers with remaining keys
        const { anthropic: _a, ...otherProviderOptions } = msgAny.providerOptions || {}
        const newProviderOptions: Record<string, any> = { ...otherProviderOptions }
        if (Object.keys(restAnthropicOptions).length > 0) {
          newProviderOptions.anthropic = restAnthropicOptions
        }
        const { providerOptions: _dropped, ...msgWithoutProvider } = msgAny
        return {
          ...msgWithoutProvider,
          ...(Object.keys(newProviderOptions).length > 0 ? { providerOptions: newProviderOptions } : {})
        } as ModelMessage
      }

      return msg
    })

    return updated
  }

  private createTelemetryHooks(agentLogger: AgentConfig['logger']): {
    prepareStep: PrepareStepFunction
    onStepFinish: ToolLoopAgentOnStepFinishCallback<Record<string, any>>
    onFinish: ToolLoopAgentOnFinishCallback
  } {
    const agentName = this.config.name

    const safeLog = (level: 'info' | 'warn' | 'error', event: string, data: unknown, failureEvent: string) => {
      try {
        agentLogger[level](event, data)
      } catch (error) {
        logger.error(failureEvent, { agentName, error })
      }
    }

    const prepareStep: PrepareStepFunction = async ({ stepNumber, messages }) => {
      // Track current step number for use in onStepFinish
      this.currentStepNumber = stepNumber

      safeLog('info', 'agent.step.begin', {
        agentName,
        stepNumber,
        messageCount: messages.length
      }, 'agent.step.begin.log_failed')

      // Build the result object, accumulating optional fields
      const result: Record<string, unknown> = {}

      // Build activeTools from cached base names + current active skills.
      // Base names are stable (computed in prepareCall). Active skills may grow
      // mid-run as the agent loads new skills, which is intentional — the cache
      // miss on that step is the cost of making new tools available. Cleanup
      // only runs in prepareCall, so tools are never removed mid-run, avoiding
      // unnecessary cache invalidation.
      if (this.currentBaseToolNames && this.skillToolProvider && this.currentConversationId) {
        const activeSkillTools = this.skillToolProvider.getActiveToolNames(this.currentConversationId)
        // Type cast needed: AI SDK expects keyof TOOLS but we have runtime string arrays
        // from baseToolNames and activeSkillTools that match tool keys at runtime
        result.activeTools = [...this.currentBaseToolNames, ...activeSkillTools] as any
      } else if (this.currentBaseToolNames) {
        result.activeTools = this.currentBaseToolNames as any
      }

      // Advance the cache breakpoint on steps 1+ so newly added messages
      // (tool results, assistant responses) are included in the cached prefix.
      // Step 0 breakpoints are placed by prepareCall; here we move the
      // "last history message" breakpoint forward as the conversation grows.
      if (stepNumber > 0 && this.config.enablePromptCaching && messages.length > 0) {
        const updatedMessages = this.advanceCacheBreakpoint(messages)
        if (updatedMessages) {
          result.messages = updatedMessages
        }
      }

      return Object.keys(result).length > 0 ? result : undefined
    }

    const onStepFinish: ToolLoopAgentOnStepFinishCallback<Record<string, any>> = async stepResult => {
      const usage = stepResult?.usage
      safeLog(
        'info',
        'agent.step.finish',
        {
          agentName,
          finishReason: stepResult?.finishReason,
          toolCallCount: stepResult?.toolCalls?.length ?? 0,
          ...(usage
            ? {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                ...(usage.cachedInputTokens ? { cachedInputTokens: usage.cachedInputTokens } : {}),
                ...(usage.inputTokenDetails?.cacheReadTokens ? { cacheReadTokens: usage.inputTokenDetails.cacheReadTokens } : {}),
                ...(usage.inputTokenDetails?.cacheWriteTokens ? { cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens } : {})
              }
            : {})
        },
        'agent.step.finish.log_failed'
      )

      // Log caching statistics if available
      // Check for !== undefined rather than truthiness to capture pure cache hits (inputTokens = 0)
      // and tool-only steps (outputTokens = 0)
      if (usage?.inputTokens !== undefined &&
          usage.outputTokens !== undefined &&
          usage.totalTokens !== undefined &&
          (usage.cachedInputTokens !== undefined || usage.inputTokenDetails?.cacheReadTokens !== undefined || usage.inputTokenDetails?.cacheWriteTokens !== undefined)) {
        logCachingStats({
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cachedInputTokens: usage.cachedInputTokens,
          inputTokenDetails: usage.inputTokenDetails
        })
      }

      // Update skill usage tracking for any skill tools that were called
      // Skill tools use the pattern: skillname__toolname (e.g., database__listTables)
      const conversationId = this.currentConversationId
      const stepNumber = this.currentStepNumber

      if (conversationId && this.skillToolProvider && stepResult?.toolCalls?.length) {
        const updatedSkills = new Set<string>()

        for (const toolCall of stepResult.toolCalls) {
          const toolName = toolCall.toolName
          // Check for skill tool pattern: skillname__toolname
          if (toolName && toolName.includes('__')) {
            const skillName = toolName.split('__')[0]
            if (skillName && !updatedSkills.has(skillName)) {
              updatedSkills.add(skillName)
              try {
                this.skillToolProvider.updateSkillUsage(conversationId, skillName, stepNumber)
                safeLog('info', 'agent.skill.usage_updated', {
                  agentName,
                  conversationId,
                  skillName,
                  toolName,
                  stepNumber
                }, 'agent.skill.usage_updated.log_failed')
              } catch (error) {
                safeLog('error', 'agent.skill.usage_update_failed', {
                  agentName,
                  conversationId,
                  skillName,
                  stepNumber,
                  error: error instanceof Error ? error.message : String(error)
                }, 'agent.skill.usage_update_failed.log_failed')
              }
            }
          }
        }
      }
    }

    const onFinish: ToolLoopAgentOnFinishCallback = async event => {
      safeLog(
        'info',
        'agent.run.finish',
        {
          agentName,
          finishReason: event.finishReason,
          steps: event.steps.length,
          totalUsage: event.totalUsage
        },
        'agent.run.finish.log_failed'
      )
    }

    return { prepareStep, onStepFinish, onFinish }
  }

  /**
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config }
  }

  /**
   * Create a new AgentWrapper with a different model.
   * Preserves all other config (tools, system prompt, temperature, etc.).
   * The new instance gets its own ToolLoopAgent with model defaults,
   * addCacheControlToSystemPrompt, and prepareCall closure for the new model.
   */
  withModel(model: import('ai').LanguageModel, modelName: string): AgentWrapper {
    return new AgentWrapper(
      { ...this.config, model, modelName },
      this.skillToolProvider
    )
  }

  private async getOrCreateOverrideAgent(modelName: string): Promise<AgentWrapper | undefined> {
    const cached = this.overrideAgents.get(modelName)
    if (cached) return cached

    try {
      const model = await getModel(modelName)
      const created = this.withModel(model, modelName)
      this.overrideAgents.set(modelName, created)
      logger.info('agent.override.created', {
        agentName: this.config.name,
        overrideModel: modelName,
      })
      return created
    } catch (error) {
      logger.warn('agent.override.failed', {
        agentName: this.config.name,
        overrideModel: modelName,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  /**
   * Generate a response (non-streaming)
   */
  async generate(prompt: string, options?: {
    messages?: Array<{ role: 'user' | 'assistant', content: string }>
    /** Custom context messages to be injected before previous conversation messages */
    context?: PipelineContextMessage[]
    files?: ProcessedFile[]
    executionContext?: Record<string, unknown>
  }): Promise<{
    content: string

    usage: any

    finishReason: any

    toolCalls: any
  }> {
    // env var > AsyncLocalStorage > configured model
    const override = process.env.AI_MODEL_OVERRIDE || getActiveModelOverride()
    if (override && override !== this.config.modelName) {
      const effective = await this.getOrCreateOverrideAgent(override)
      if (effective) {
        return effective.generate(prompt, options)
      }
    }

    const callOptions: AgentCallOptions = {
      basePrompt: prompt
    }
    if (options?.executionContext) {
      callOptions.executionContext = options.executionContext
    }
    if (options?.context && options.context.length > 0) {
      callOptions.contextMessages = options.context
    }
    if (options?.messages && options.messages.length > 0) {
      callOptions.conversationMessages = options.messages
    }
    if (options?.files && options.files.length > 0) {
      callOptions.files = options.files
    }

    // Extract and set LiteLLM metadata for cost tracking
    const litellmMetadata = extractLitellmMetadata(options?.executionContext, this.config.id)

    const retryContext: RetryContext = {
      operation: 'generate',
      agentName: this.config.name,
      modelName: this.config.modelName || 'unknown',
      ...(this.config.logger && { logger: this.config.logger })
    }

    // Wrap LLM call with retryWithBackoff for proper 429/5xx retry handling
    const generateParams = {
      prompt,
      options: callOptions,
      ...(this.config.timeout && { timeout: this.config.timeout }),
    }
    const result = await retryWithBackoff(
      () => litellmMetadata
        ? llmMetadataContext.run(litellmMetadata, async () => {
            return await this.agent.generate(generateParams)
          })
        : this.agent.generate(generateParams),
      this.config.retryConfig,
      retryContext
    )

    // Await all promises from ToolLoopAgent
    const [usage, finishReason, toolCalls] = await Promise.all([
      result.usage,
      result.finishReason,
      result.toolCalls
    ])

    return {
      content: result.text,
      usage,
      finishReason,
      toolCalls
    }
  }

  /**
   * Generate a streaming response with flexible context injection
   */
  async streamGenerate(prompt: string, options?: {
    /** Previous conversation messages in AI SDK v6 ModelMessage format */
    messages?: ModelMessage[]
    /** Custom context messages to be injected before previous conversation messages */
    context?: PipelineContextMessage[]
    /** Execution context for tools (appId, userId, etc.) */
    executionContext?: Record<string, unknown>
    /** Files to include in the request (for vision/document analysis) */
    files?: ProcessedFile[]
    /** AbortSignal to cancel the stream (propagated to AI SDK) */
    abortSignal?: AbortSignal
  }): Promise<{
    textStream: AsyncIterable<string>
    baseStream?: unknown

    response?: PromiseLike<{ id: string; timestamp: Date; modelId: string; headers?: Record<string, string>; body?: any }>
    getFinalResult: () => Promise<{

      usage: any

      finishReason: any

      toolCalls: any
    }>
  }> {
    // env var > AsyncLocalStorage > configured model
    const override = process.env.AI_MODEL_OVERRIDE || getActiveModelOverride()
    if (override && override !== this.config.modelName) {
      const effective = await this.getOrCreateOverrideAgent(override)
      if (effective) {
        return effective.streamGenerate(prompt, options)
      }
    }

    return this._executeStreamGenerate(prompt, options)
  }

  /**
   * Internal implementation of streamGenerate
   * Handles tool execution context propagation via ToolLoopAgent call options
   * Includes grant fallback logic for budget exceeded errors
   */
  private async _executeStreamGenerate(prompt: string, options?: {
    messages?: ModelMessage[]
    context?: PipelineContextMessage[]
    files?: ProcessedFile[]
    executionContext?: Record<string, unknown>
    abortSignal?: AbortSignal
  }): Promise<{
    textStream: AsyncIterable<string>
    baseStream?: unknown

    response?: PromiseLike<{ id: string; timestamp: Date; modelId: string; headers?: Record<string, string>; body?: any }>
    getFinalResult: () => Promise<{

      usage: any

      finishReason: any

      toolCalls: any
    }>
  }> {
    // Get socketId for grant session management
    const socketId = (options?.executionContext as any)?.socketId as string | undefined

    return this._executeStreamWithGrantFallback(prompt, options, socketId, 0)
  }

  /**
   * Execute stream with grant fallback on budget exceeded errors
   */
  private async _executeStreamWithGrantFallback(
    prompt: string,
    options: {
      messages?: ModelMessage[]
      context?: PipelineContextMessage[]
      files?: ProcessedFile[]
      executionContext?: Record<string, unknown>
      abortSignal?: AbortSignal
    } | undefined,
    socketId: string | undefined,
    retryCount: number
  ): Promise<{
    textStream: AsyncIterable<string>
    baseStream?: unknown

    response?: PromiseLike<{ id: string; timestamp: Date; modelId: string; headers?: Record<string, string>; body?: any }>
    getFinalResult: () => Promise<{

      usage: any

      finishReason: any

      toolCalls: any
    }>
  }> {
    // For new accounts: wait for grants to be provisioned if feature is enabled but grants are empty
    // This handles the case where subscription is active but grants haven't been created yet
    // Skip entirely in BMS mode
    const typedContext = options?.executionContext as ExecutionContext | undefined
    const budgetServiceEnabled = typedContext?.metadata?.budgetServiceEnabled === true
    if (socketId && retryCount === 0 && !budgetServiceEnabled) {
      const hasGrants = grantSessionManager.hasGrants(socketId)

      if (!hasGrants) {
        logger.info('grants.awaiting_provisioning', {
          socketId,
          message: 'Grants feature enabled but no grants yet - waiting for provisioning',
        })

        // Request refresh and wait for grants to be provisioned
        const gotGrants = await grantSessionManager.requestGrantRefreshAndWait(socketId, 10000)

        if (gotGrants) {
          logger.info('grants.provisioning_complete', {
            socketId,
            message: 'Grants provisioned successfully',
          })
        } else {
          logger.warn('grants.provisioning_timeout', {
            socketId,
            message: 'Grants provisioning timeout - will proceed with customerId fallback',
          })
        }
      } else if (hasGrants && isGrantsExhausted(options?.executionContext)) {
        // All cached grants exhausted - request refresh before giving up
        // User may have purchased a credit pack since grants were last synced
        logger.info('grants.exhausted_refreshing', {
          socketId,
          message: 'All cached grants exhausted - requesting refresh for possible new credit packs',
        })

        // Using 10s timeout for both provisioning and refresh to handle network latency variations
        const gotNewGrants = await grantSessionManager.requestGrantRefreshAndWait(socketId, 10000)

        // Query the session manager directly for usability - consistent with the
        // mid-stream BudgetExceededError fallback at the bottom of this method.
        if (gotNewGrants && grantSessionManager.getCurrentUserId(socketId) !== undefined) {
          logger.info('grants.exhausted_refresh_success', {
            socketId,
            message: 'Grant refresh found usable grants - proceeding',
          })
        } else {
          throw new BudgetExceededError(
            GRANTS_EXHAUSTED_MESSAGE,
            400,
            GrantErrorCode.AllGrantsExhausted
          )
        }
      }
    }

    let streamResult
    try {
      const callOptions: AgentCallOptions = {
        basePrompt: prompt
      }
      if (options?.executionContext) {
        callOptions.executionContext = options.executionContext
      }
      if (options?.context && options.context.length > 0) {
        callOptions.contextMessages = options.context
      }
      if (options?.messages && options.messages.length > 0) {
        callOptions.conversationMessages = options.messages
      }
      if (options?.files && options.files.length > 0) {
        callOptions.files = options.files
      }

      // Extract userId (appId/siteId), sessionId, and customerId from execution context for Langfuse tracing
      const contextMetadata = (options?.executionContext as any)?.metadata
      const userId = contextMetadata?.appId as string | undefined
      const sessionId = contextMetadata?.sessionId as string | undefined
      const customerId = contextMetadata?.customerId as string | undefined

      // Wrap stream call with Langfuse attribute propagation
      const attributes: { userId?: string; sessionId?: string; metadata?: Record<string, string> } = {}
      if (userId) attributes.userId = userId
      if (sessionId) attributes.sessionId = sessionId
      if (customerId) attributes.metadata = { customerId }

      // Extract and set LiteLLM metadata for cost tracking
      const litellmMetadata = extractLitellmMetadata(options?.executionContext, this.config.id)

      const retryContext: RetryContext = {
        operation: 'stream',
        agentName: this.config.name,
        modelName: this.config.modelName || 'unknown',
        ...(this.config.logger && { logger: this.config.logger })
      }

      // Wrap LLM call with retryWithBackoff for proper 429/5xx retry handling
      const streamParams = {
        prompt,
        options: callOptions,
        ...(this.config.timeout && { timeout: this.config.timeout }),
        ...(options?.abortSignal && { abortSignal: options.abortSignal }),
      }
      streamResult = await retryWithBackoff(
        () => litellmMetadata
          ? llmMetadataContext.run(litellmMetadata, async () => {
              return await propagateAttributes(
                attributes,
                async () => {
                  return await this.agent.stream(streamParams)
                }
              )
            })
          : propagateAttributes(
              attributes,
              async () => {
                return await this.agent.stream(streamParams)
              }
            ),
        this.config.retryConfig,
        retryContext
      )

  } catch (error: any) {
      // Normalize APICallError budget errors to BudgetExceededError so grant fallback works
      let normalizedError = error
      if (isBudgetExceededAPIError(error) && !BudgetExceededError.isInstance(error)) {
        normalizedError = new BudgetExceededError(error.message, error.statusCode ?? 400, error.responseBody)
        if (error.stack) normalizedError.stack = error.stack
      }
      if (BudgetExceededError.isInstance(normalizedError)) {
        // In BMS mode, budget enforcement is via GoCode headers - no grant fallback
        if (budgetServiceEnabled) {
          throw normalizedError
        }
        if (!socketId || !grantSessionManager.hasGrants(socketId)) {
          throw normalizedError // No grant fallback available
        }

        // Prevent infinite retry loops
        if (retryCount >= MAX_GRANT_RETRIES) {
          logger.error('grants.fallback.max_retries', { socketId, retryCount })
          throw new BudgetExceededError(
            GRANTS_EXHAUSTED_MESSAGE,
            400,
            GrantErrorCode.AllGrantsExhausted
          )
        }

        // Try to advance to next grant
        const advanced = grantSessionManager.advanceToNextGrant(socketId)

        if (!advanced) {
          // No more grants in current list - request refresh and wait for new grants
          logger.info('grants.fallback.requesting_refresh', {
            socketId,
            retryCount,
          })

          const gotNewGrants = await grantSessionManager.requestGrantRefreshAndWait(socketId, 5000)

          if (gotNewGrants) {
            // New grants arrived, check if we now have a usable grant
            const hasUsableGrant = grantSessionManager.getCurrentUserId(socketId) !== undefined
            if (hasUsableGrant) {
              // Enforce MAX_GRANT_RETRIES even after successful refresh
              const nextRetryCount = retryCount + 1
              if (nextRetryCount >= MAX_GRANT_RETRIES) {
                logger.error('grants.fallback.max_retries_after_refresh', {
                  socketId,
                  retryCount: nextRetryCount,
                })
                throw new BudgetExceededError(
                  GRANTS_EXHAUSTED_MESSAGE,
                  400,
                  GrantErrorCode.AllGrantsExhausted
                )
              }

              logger.info('grants.fallback.refresh_success', {
                socketId,
                retryCount: nextRetryCount,
              })
              // Don't retry if already aborted
              if (options?.abortSignal?.aborted) throw options.abortSignal.reason instanceof Error ? options.abortSignal.reason : new Error('Aborted')
              // Retry with the new grant
              return this._executeStreamWithGrantFallback(prompt, options, socketId, nextRetryCount)
            }
            // New grants arrived but still no usable grant
            logger.warn('grants.fallback.refresh_no_usable', {
              socketId,
              retryCount,
              message: 'Received refreshed grants but none are usable',
            })
          } else {
            // Refresh failed (timeout, no callback, or disconnected)
            logger.warn('grants.fallback.refresh_failed', {
              socketId,
              retryCount,
              message: 'Grant refresh failed - timed out or callback not registered',
            })
          }

          // Still no usable grants after refresh - surface error to user
          throw new BudgetExceededError(
            GRANTS_EXHAUSTED_MESSAGE,
            400,
            GrantErrorCode.AllGrantsExhausted
          )
        }

        logger.info('grants.fallback.retry', {
          socketId,
          retryCount: retryCount + 1,
        })

        // Don't retry if already aborted
        if (options?.abortSignal?.aborted) throw options.abortSignal.reason instanceof Error ? options.abortSignal.reason : new Error('Aborted')
        // Retry with next grant
        return this._executeStreamWithGrantFallback(prompt, options, socketId, retryCount + 1)
      }

      // Handle API call errors (like tool input validation failures)
      const isToolValidationError =
        (APICallError.isInstance(error) && error.message?.includes('toolUse.input is invalid')) ||
        error?.message?.includes('toolUse.input is invalid')

      if (isToolValidationError) {
        logger.error('tool.validation.failure', {
          message: error.message,
          statusCode: APICallError.isInstance(error) ? error.statusCode : undefined
        })

        // Create an error message for the LLM
        const errorMessage = `Tool call failed due to invalid input format: ${error.message}. Please ensure all tool arguments are properly formatted as valid JSON objects. Check that:
1. All string values are properly quoted
2. All object properties use valid JSON syntax
3. No undefined or null values are passed as tool arguments
4. Arrays and objects are properly structured

Please retry your tool call with corrected input formatting.`

        // Return a mock stream result with the error message and validation flags
        const mockResult: StreamResultWithValidation = {
          textStream: (async function* () {
            yield errorMessage
          })(),
          baseStream: null,
          getFinalResult: async () => ({
            usage: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
            finishReason: 'error',
            toolCalls: []
          }),
          isToolValidationError: true,
          validationErrorMessage: error.message
        }

        return mockResult
      }

      // Re-throw other errors
      throw error
    }

    // Preserve getter evaluation order: textStream → response → baseStream.
    // Accessing .response triggers the AI SDK's internal consumeStream() →
    // teeStream() which locks the current baseStream fork, so .response must
    // be read BEFORE .baseStream to ensure baseStream captures the post-tee
    // unlocked fork.
    const textStream = streamResult.textStream
    const responsePromise = streamResult.response
    // Attach a rejection handler at the library boundary so callers that
    // don't attach their own handler can't leak an unhandled rejection and
    // trip the agents service's global handler. Transports are expected to
    // consume this promise non-blockingly (see
    // `@airo/ai-transport` → `captureResponseMetadata`); this catch is the
    // backstop. Abort-triggered rejections are silent; everything else is
    // logged at warn so HTTP-layer failures that surface only through
    // `response` (ECONNRESET, TLS, 502 before body) remain diagnosable.
    void Promise.resolve(responsePromise).catch((err: unknown) => {
      const e = err as { name?: string; code?: string } | null | undefined
      const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR'
      if (isAbort) return
      logger.warn('agent.stream.response_promise.rejected', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
    const baseStream = (streamResult as any).baseStream

    return {
      textStream,

      // Response metadata promise (includes headers from GoCode/LLM provider)
      response: responsePromise,

      // Raw baseStream for real-time tool call events. Exists at runtime but
      // not in the AI SDK type definitions.
      baseStream,

      // Function to get final result after streaming is complete
      getFinalResult: async () => {
        // streamResult is the object returned from ToolLoopAgent.stream; its properties are promises to be awaited below
        const finalResult = streamResult

        // Await all promises from ToolLoopAgent
        const [usage, totalUsage, finishReason, toolCalls, toolResults, steps] = await Promise.all([
          finalResult.usage,
          finalResult.totalUsage,
          finalResult.finishReason,
          finalResult.toolCalls,
          finalResult.toolResults,
          finalResult.steps
        ])

        // Use toolResults if available (includes both input and output), otherwise fall back to toolCalls
        const finalToolCalls = toolResults && toolResults.length > 0 ? toolResults : toolCalls

        return {
          usage,
          totalUsage,
          finishReason,
          toolCalls: finalToolCalls,
          steps
        }
      }
    }
  }


  /**
   * Get the underlying ToolLoopAgent (for advanced usage)
   */

  getToolLoopAgent(): ToolLoopAgent<any, any, any> {
    return this.agent
  }
}

/**
 * Factory for creating and managing ToolLoopAgent instances
 */
export class AgentFactory {
  private agents = new Map<string, AgentWrapper>()
  private globalConfig: GlobalAgentConfig
  private handoffHistory: HandoffHistoryEntry[] = []
  private agentConfigs = new Map<string, AgentConfig>()

  constructor(globalConfig: GlobalAgentConfig = {}) {
    this.globalConfig = globalConfig
  }

  /**
   * Define multiple agents and return a typed interface for accessing them
   */
  defineAgents<T extends Record<string, AgentConfig>>(agentConfigs: T) {
    const definitions = agentConfigs

    // Store agent configurations for handoff access
    Object.entries(agentConfigs).forEach(([id, config]) => {
      // Ensure the config has the agent ID set
      config.id = id
      this.agentConfigs.set(id, config)
    })

    // Create typed getter function
    const get = <K extends keyof T>(id: K): AgentWrapper => {
      const stringId = id as string

      if (!this.agents.has(stringId)) {
        const config = agentConfigs[id]
        if (!config) {
          throw new Error(`Agent config not found for id: ${stringId}`)
        }
        const mergedConfig = this.mergeWithGlobalConfig(config)
        this.agents.set(stringId, new AgentWrapper(mergedConfig, this.globalConfig.skillToolProvider))
      }

      return this.agents.get(stringId)!
    }

    return {
      /** Get an agent by ID */
      get,

      /** Agent definitions (for inspection) */
      definitions,

      /** List all agent IDs */
      list: (): (keyof T)[] => Object.keys(agentConfigs),

      /** Reload a specific agent (useful for development) */
      reload: (id: keyof T): AgentWrapper => {
        this.agents.delete(id as string)
        return get(id)
      },

      /** Preload all agents (create instances) */
      preload: (): void => {
        Object.keys(agentConfigs).forEach(id => get(id as keyof T))
      },

      /** Check if an agent exists */
      has: (id: keyof T): boolean => {
        return id in agentConfigs
      },

      /** Get agent configuration without creating instance */
      getConfig: (id: keyof T): AgentConfig => {
        const config = agentConfigs[id]
        if (!config) {
          throw new Error(`Agent config not found for id: ${String(id)}`)
        }
        return this.mergeWithGlobalConfig(config)
      }
    }
  }

  /**
   * Create a single agent (for dynamic creation)
   */
  createAgent(config: AgentConfig & { id: string }): AgentWrapper {
    const mergedConfig = this.mergeWithGlobalConfig(config)
    const agent = new AgentWrapper(mergedConfig, this.globalConfig.skillToolProvider)

    // Cache the agent
    this.agents.set(config.id, agent)

    return agent
  }

  /**
   * Update global configuration
   */
  updateGlobalConfig(config: Partial<GlobalAgentConfig>): void {
    this.globalConfig = { ...this.globalConfig, ...config }

    // Clear cached agents so they pick up new global config
    this.agents.clear()
  }

  /**
   * Get current global configuration
   */
  getGlobalConfig(): GlobalAgentConfig {
    return { ...this.globalConfig }
  }

  /**
   * Execute a handoff from one agent to another
   */
  async executeHandoff(
    sourceAgentId: string,
    targetAgentId: string,
    handoffContext: HandoffContext,
    executionContext?: Record<string, unknown>
  ): Promise<HandoffResult> {
    // Ensure source agent exists
    let sourceAgent = this.agents.get(sourceAgentId)
    if (!sourceAgent) {
      const sourceConfig = this.agentConfigs.get(sourceAgentId)
      if (!sourceConfig) {
        throw new Error(`Source agent configuration not found: ${sourceAgentId}`)
      }
      const mergedConfig = this.mergeWithGlobalConfig(sourceConfig)
      sourceAgent = new AgentWrapper(mergedConfig, this.globalConfig.skillToolProvider)
      this.agents.set(sourceAgentId, sourceAgent)
    }

    // Ensure target agent exists
    let targetAgent = this.agents.get(targetAgentId)
    if (!targetAgent) {
      const targetConfig = this.agentConfigs.get(targetAgentId)
      if (!targetConfig) {
        throw new Error(`Target agent configuration not found: ${targetAgentId}`)
      }
      const mergedConfig = this.mergeWithGlobalConfig(targetConfig)
      targetAgent = new AgentWrapper(mergedConfig, this.globalConfig.skillToolProvider)
      this.agents.set(targetAgentId, targetAgent)
    }

    // Validate handoff is allowed
    const sourceConfig = sourceAgent.getConfig()
    const allowedHandoffs = sourceConfig.handoffs || []
    const isHandoffAllowed = allowedHandoffs.some(h => h.agentName === targetAgentId)

    if (!isHandoffAllowed) {
      throw new Error(`Handoff from ${sourceAgentId} to ${targetAgentId} is not configured`)
    }

    // Create handoff history entry
    const handoffId = `handoff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = new Date().toISOString()

    const historyEntry: HandoffHistoryEntry = {
      id: handoffId,
      sourceAgent: sourceAgentId,
      targetAgent: targetAgentId,
      timestamp,
      task: handoffContext.task,
      context: handoffContext,
      status: 'pending'
    }

    this.handoffHistory.push(historyEntry)

    try {
      logger.info('handoff.begin', { sourceAgentId, targetAgentId, task: handoffContext.task })

      // Execute the task on the target agent with only the provided context
      const streamOptions: {
        context?: PipelineContextMessage[]
      } = {}

      if (handoffContext.context) {
        streamOptions.context = [
          {
            role: 'user' as const,
            content: `Context from ${sourceAgentId}: ${JSON.stringify(handoffContext.context, null, 2)}`
          }
        ]
      }

      const streamOptionsWithContext = {
        ...streamOptions,
        ...(executionContext && { executionContext })
      }

      const result = await targetAgent.streamGenerate(handoffContext.task, streamOptionsWithContext)

      // Collect the response
      let response = ''
      for await (const chunk of result.textStream) {
        response += chunk
      }

      const finalResult = await result.getFinalResult()

      const handoffResult: HandoffResult = {
        success: true,
        result: {
          response,
          usage: await finalResult.usage,
          toolCalls: finalResult.toolCalls
        },
        handoffDetails: {
          sourceAgent: sourceAgentId,
          targetAgent: targetAgentId,
          timestamp,
          context: handoffContext
        }
      }

      // Update history entry
      historyEntry.result = handoffResult
      historyEntry.status = 'completed'

      logger.info('handoff.success', { sourceAgentId, targetAgentId })

      return handoffResult

    } catch (error) {
      const handoffResult: HandoffResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        handoffDetails: {
          sourceAgent: sourceAgentId,
          targetAgent: targetAgentId,
          timestamp,
          context: handoffContext
        }
      }

      // Update history entry
      historyEntry.result = handoffResult
      historyEntry.status = 'failed'

      logger.error('handoff.failure', { sourceAgentId, targetAgentId, error: handoffResult.error })

      return handoffResult
    }
  }

  /**
   * Get handoff history
   */
  getHandoffHistory(): HandoffHistoryEntry[] {
    return [...this.handoffHistory]
  }

  /**
   * Get handoff history for a specific agent
   */
  getHandoffHistoryForAgent(agentId: string): HandoffHistoryEntry[] {
    return this.handoffHistory.filter(
      entry => entry.sourceAgent === agentId || entry.targetAgent === agentId
    )
  }

  /**
   * Clear handoff history
   */
  clearHandoffHistory(): void {
    this.handoffHistory = []
  }

  /**
   * Clear all cached agents (useful for development/testing)
   */
  clearCache(): void {
    this.agents.clear()
  }

  /**
   * Get statistics about cached agents
   */
  getStats(): {
    totalCached: number
    cachedAgents: string[]
  } {
    return {
      totalCached: this.agents.size,
      cachedAgents: Array.from(this.agents.keys())
    }
  }

  /**
   * Merge agent config with global config
   */
  private mergeWithGlobalConfig(config: AgentConfig): AgentConfig {
    const merged: AgentConfig = {
      ...config,
      // Apply global defaults if not specified
      temperature: config.temperature ?? this.globalConfig.defaultTemperature ?? 0.3,
      maxOutputTokens: config.maxOutputTokens ?? this.globalConfig.defaultMaxTokens ?? 2000,
      maxSteps: config.maxSteps ?? 8 // Default to 8 reasoning steps
    }

    const providerOptions = mergeProviderOptions(this.globalConfig.providerOptions, config.providerOptions)
    if (providerOptions) {
      merged.providerOptions = providerOptions
    }

    // Merge tools (global tools + agent-specific tools, skill tools only if agent has skill loader)
    const globalTools = this.globalConfig.globalTools || []
    const configTools = config.tools || {}

    // Only merge skill tools for agents that declare the 'skill' tool — agents
    // without the skill loader have no mechanism to activate skills, so merging
    // skill tool definitions just bloats their tool map and risks exposing them
    // if the activeTools filter doesn't run (e.g. missing conversationId).
    const hasSkillLoader = configTools['skill'] != null
    const skillTools = hasSkillLoader
      ? (this.globalConfig.skillToolProvider?.getAllTools() || {})
      : {}

    // Convert global tools array to object if needed

    let globalToolsObj: Record<string, any> = {}
    if (Array.isArray(globalTools)) {
      globalTools.forEach((tool, index) => {
        // Tools don't have a name property, so we use index-based naming
        globalToolsObj[`global_tool_${index}`] = tool
      })
    } else {
      globalToolsObj = globalTools
    }

    // Filter out undefined/null tools to prevent errors
    const filteredGlobalTools = Object.fromEntries(
      Object.entries(globalToolsObj).filter(([_, tool]) => tool != null)
    )
    const filteredSkillTools = Object.fromEntries(
      Object.entries(skillTools).filter(([_, tool]) => tool != null)
    )
    const filteredConfigTools = Object.fromEntries(
      Object.entries(configTools).filter(([_, tool]) => tool != null)
    )

    // Merge with precedence: agent tools > skill tools > global tools
    merged.tools = {
      ...filteredGlobalTools,
      ...filteredSkillTools,
      ...filteredConfigTools
    }

    return merged
  }
}

/**
 * Create a new experimental agent factory with global configuration
 */
export function createAgentFactory(globalConfig?: GlobalAgentConfig): AgentFactory {
  return new AgentFactory(globalConfig)
}

/**
 * Default experimental agent factory instance
 */
export const defaultAgentFactory = new AgentFactory()
