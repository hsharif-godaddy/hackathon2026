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
import { createDuplicateResponseStopCondition } from './duplicate-detection.js'
import { supportsEffort } from '../utils/model-normalization.js'
import { buildHybridContent } from '../utils/image-content-builder.js'
import type { ContentBlock, TextContentBlock, ImageContentBlock } from '../utils/image-content-builder.js'
import { createLogger } from '../utils/logger.js'
import { serializeError, isBudgetExceededAPIError } from '../utils/errors.js'
import { addCacheControlToMessages, addCacheControlToSystemPrompt, logCachingStats } from '../utils/prompt-caching.js'
import { llmMetadataContext, type LitellmMetadata } from '../providers/unified-provider.js'
import {
  buildLitellmMetadataFromContext,
  LlmCallSource,
  grantSessionManager,
  isGrantsExhausted,
  GrantErrorCode,
} from '../grants/index.js'
import { BudgetExceededError } from '../utils/errors.js'
import { retryWithBackoff, type RetryContext } from '../utils/retry-with-backoff.js'

const logger = createLogger('agent-factory')

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
  contextMessages?: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string | unknown
    cachePoint?: { type: 'default' | 'ephemeral' }
  }>
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
  bedrock?: {
    cachePoint?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
  }
  anthropic?: {
    cacheControl?: { type: string }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private agent: ToolLoopAgent<AgentCallOptions, any, any>
  private config: AgentConfig
  private skillToolProvider?: GlobalAgentConfig['skillToolProvider']
  private currentConversationId: string | undefined
  private currentStepNumber: number = 0

  constructor(config: AgentConfig, skillToolProvider?: GlobalAgentConfig['skillToolProvider']) {
    this.config = config
    this.skillToolProvider = skillToolProvider

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(config.providerOptions && { providerOptions: this.filterProviderOptions(config.providerOptions, config.model, config.modelName) as any }),
      maxRetries,
      // Enable OpenTelemetry telemetry for Elastic APM and Langfuse integration
      experimental_telemetry: { isEnabled: true, functionId: `agent-${config.name}` },
      ...(telemetryHooks.prepareStep ? { prepareStep: telemetryHooks.prepareStep } : {}),
      ...(telemetryHooks.onStepFinish ? { onStepFinish: telemetryHooks.onStepFinish } : {}),
      ...(telemetryHooks.onFinish ? { onFinish: telemetryHooks.onFinish } : {}),
      prepareCall: async ({ options, ...callParameters }) => {
        const callOptions = (options as AgentCallOptions | undefined) || {}

        const { prompt: incomingPrompt, messages: incomingMessages, ...rest } = callParameters

        const promptText = typeof incomingPrompt === 'string' ? incomingPrompt : undefined
        const promptMessageList = Array.isArray(incomingPrompt) ? incomingPrompt : undefined
        const basePrompt = callOptions.basePrompt ?? promptText ?? ''
        const trimmedBasePrompt = basePrompt.trim()

        // Unified path: normalize conversationMessages (empty array if not provided)
        const conversationMessages = callOptions.conversationMessages || []

        const preparedCall = { ...rest } as typeof callParameters

        // Normalize context messages (system prompts, etc.)
        const contextNormalized: ModelMessage[] = []
        if (callOptions.contextMessages && callOptions.contextMessages.length > 0) {
          for (const msg of callOptions.contextMessages) {
            const normalizedContent = this.normalizeContentForMessage(msg.content)
            const msgWithMetadata = msg as MessageWithCachePoint

            // Preserve existing providerOptions and merge in cache hints
            const existingProviderOptions: ProviderOptions = msgWithMetadata.providerOptions || {}
            const providerOptions: ProviderOptions = { ...existingProviderOptions }

            // Convert cachePoint from stored messages to providerOptions format
            // (preserves cache metadata even if current agent has caching disabled)
            if (msg.cachePoint) {
              // Populate both Bedrock and Anthropic formats for cross-provider compatibility
              providerOptions.bedrock = {
                ...(existingProviderOptions.bedrock || {}),
                cachePoint: msg.cachePoint.type
              }
              providerOptions.anthropic = {
                ...(existingProviderOptions.anthropic || {}),
                cacheControl: { type: msg.cachePoint.type }
              }
            }
            contextNormalized.push({
              role: msg.role,
              content: normalizedContent,
              ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {})
            } as ModelMessage)
          }
        }

        // Normalize conversation messages to preserve cachePoint metadata
        const conversationNormalized: ModelMessage[] = []
        for (const msg of conversationMessages) {
          // Check if this message has cachePoint metadata (ConversationMessage type)
          const msgWithCache = msg as MessageWithCachePoint
          // Convert cachePoint from stored messages to providerOptions format
          // (preserves cache metadata even if current agent has caching disabled)
          if (msgWithCache.cachePoint) {
            // Preserve existing providerOptions and merge in cache hints
            const existingProviderOptions: ProviderOptions = msgWithCache.providerOptions || {}
            const providerOptions: ProviderOptions = {
              ...existingProviderOptions,
              bedrock: {
                ...(existingProviderOptions.bedrock || {}),
                cachePoint: msgWithCache.cachePoint.type
              },
              anthropic: {
                ...(existingProviderOptions.anthropic || {}),
                cacheControl: { type: msgWithCache.cachePoint.type }
              }
            }
            // Create normalized message without cachePoint property
            const { cachePoint, ...messageWithoutCache } = msgWithCache
            conversationNormalized.push({
              ...messageWithoutCache,
              providerOptions
            })
          } else {
            // No cachePoint, pass through as-is
            conversationNormalized.push(msg)
          }
        }

        let allMessages: ModelMessage[] = [
          ...contextNormalized,
          ...conversationNormalized
        ]

        // Determine if we should use fallback messages (legacy path for direct ToolLoopAgent calls)
        // This takes precedence over the normal message building flow
        const shouldUseFallback = (
          (incomingMessages && incomingMessages.length > 0) ||
          (promptMessageList && promptMessageList.length > 0)
        )

        // If using fallback, apply caching to fallback messages and skip normal message building
        if (shouldUseFallback) {
          if (incomingMessages && incomingMessages.length > 0) {
            preparedCall.messages = this.processFallbackMessages(incomingMessages, callOptions.files)
          } else if (promptMessageList && promptMessageList.length > 0) {
            preparedCall.messages = this.processFallbackMessages(promptMessageList as ModelMessage[], callOptions.files)
          }
        } else {
          // Normal path: build current user message and apply caching

          // Build the current user message (with files if present)
          let currentUserMessage: ModelMessage | null = null
          if (callOptions.files && callOptions.files.length > 0) {
            currentUserMessage = buildHybridContent(basePrompt, callOptions.files)
          } else if (trimmedBasePrompt.length > 0) {
            currentUserMessage = { role: 'user', content: trimmedBasePrompt }
          }

          // Apply prompt caching strategy
          // - On first turn (no conversation history): mark the current user message so it's cached
          // - On subsequent turns: mark only conversation history, not the current message
          if (this.config.enablePromptCaching && currentUserMessage) {
            const cachingStrategy = typeof this.config.enablePromptCaching === 'object'
              ? this.config.enablePromptCaching
              : {}

            if (this.isFirstTurn(conversationNormalized)) {
              // First turn (no prior conversation): cache context + current user message
              // This ensures request #1 caches the first user input, even with context present
              const messagesToCache = [...allMessages, currentUserMessage]
              const cachedMessages = addCacheControlToMessages(
                messagesToCache,
                this.config.model,
                cachingStrategy
              )
              // Replace allMessages with cached versions (context + user message minus the last one)
              allMessages = cachedMessages.slice(0, -1)
              currentUserMessage = cachedMessages[cachedMessages.length - 1] || currentUserMessage
            } else {
              // Subsequent turns: cache only history (exclude current message)
              allMessages = addCacheControlToMessages(allMessages, this.config.model, cachingStrategy)
            }
          }

          // Add current user message to allMessages
          if (currentUserMessage) {
            allMessages.push(currentUserMessage)
          }

          preparedCall.messages = allMessages
        }

        if (callOptions.executionContext) {
          ;(preparedCall as typeof preparedCall & { experimental_context?: unknown }).experimental_context = callOptions.executionContext
        }

        // Store conversationId for prepareStep to use (skill tools are pre-registered,
        // activeTools filtering controls visibility)
        const executionContext = callOptions.executionContext as Record<string, any> | undefined
        this.currentConversationId = executionContext?.metadata?.conversationId as string | undefined

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
   * Detect if this is the first turn of a conversation.
   * First turn = no assistant messages in history (only user/system messages)
   *
   * This is used to determine caching strategy:
   * - First turn: cache system + user message
   * - Subsequent: cache only history, not current message
   */
  private isFirstTurn(messages: ModelMessage[]): boolean {
    return !messages.some(msg => msg.role === 'assistant')
  }

  /**
   * Apply caching and file handling to fallback messages (legacy API path).
   * Handles both incomingMessages and promptMessageList paths identically.
   *
   * @param fallbackMessages - Messages from legacy API
   * @param files - Optional files to merge into last user message
   * @returns Processed messages with caching applied and files merged
   */
  private processFallbackMessages(
    fallbackMessages: ModelMessage[],
    files?: ProcessedFile[]
  ): ModelMessage[] {
    let processedMessages = fallbackMessages

    // Apply caching if enabled
    if (this.config.enablePromptCaching && processedMessages.length > 0) {
      const cachingStrategy = typeof this.config.enablePromptCaching === 'object'
        ? this.config.enablePromptCaching
        : {}

      // Only exclude last message from caching if it's a user message (new input)
      // If it's an assistant message, it's part of history and should be cached
      const lastMessage = processedMessages[processedMessages.length - 1]
      const lastMessageIsUser = lastMessage?.role === 'user'

      if (lastMessageIsUser && processedMessages.length > 1) {
        if (this.isFirstTurn(processedMessages)) {
          // First turn: cache everything including the last user message
          processedMessages = addCacheControlToMessages(processedMessages, this.config.model, cachingStrategy)
        } else {
          // Subsequent turns: cache all messages except the last user message (new input)
          const lastMessage = processedMessages[processedMessages.length - 1]!
          const messagesToCache = processedMessages.slice(0, -1)
          const cachedMessages = addCacheControlToMessages(messagesToCache, this.config.model, cachingStrategy)
          processedMessages = [...cachedMessages, lastMessage]
        }
      } else {
        // Last message is assistant (or only one message), cache everything
        processedMessages = addCacheControlToMessages(processedMessages, this.config.model, cachingStrategy)
      }
    }

    // Merge files into last user message if files are present
    if (files && files.length > 0) {
      // Find last user message (backwards iteration)
      let lastUserIndex = -1
      for (let i = processedMessages.length - 1; i >= 0; i--) {
        if (processedMessages[i]?.role === 'user') {
          lastUserIndex = i
          break
        }
      }
      if (lastUserIndex >= 0) {
        const lastUserMsg = processedMessages[lastUserIndex]
        if (lastUserMsg) {
          const textContent = typeof lastUserMsg.content === 'string'
            ? lastUserMsg.content
            : ''
          const hybridMessage = buildHybridContent(textContent, files)
          // Safe to cast: we found this by searching for role === 'user', and hybridMessage.content matches user message content
          processedMessages[lastUserIndex] = {
            ...lastUserMsg,
            content: hybridMessage.content
          } as ModelMessage
        }
      } else {
        // No user message found - files will be dropped
        logger.warn('agent.prepareCall.files_dropped', {
          fileCount: files.length,
          messageCount: processedMessages.length,
          reason: 'no_user_message'
        })
      }
    }

    return processedMessages
  }

  /**
   * Wrap tools with execution hooks and context passing
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wrapToolsWithHooks(tools: Record<string, any>): Record<string, Tool> {
    const wrappedTools: Record<string, Tool> = {}

    for (const [toolName, toolDefinition] of Object.entries(tools)) {
      if (!toolDefinition) {
        logger.warn(`Skipping invalid tool definition: ${toolName}`)
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
            logger.error('Error in beforeToolExecution hook', { toolName, error })
          }
        }

        let toolCallResult: unknown
        let toolCallError: unknown

        try {
          toolCallResult = await originalExecute(processedArgs, executionOptions)
        } catch (error) {
          toolCallError = error
          const serializedError = serializeError(error)
          logger.error('Tool execution failed', {
            toolName,
            args: processedArgs,
            error: serializedError,
            context
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
              logger.error('Error in afterToolExecution hook', { toolName, error })
            }
          }
        }

        return toolCallResult
      }
    })
  }

  private normalizeContentForMessage(content: unknown): string | ContentBlock[] {
    if (typeof content === 'string') {
      return content
    }

    if (Array.isArray(content)) {
      if (content.every(block => this.isSupportedContentBlock(block))) {
        return content as ContentBlock[]
      }

      return content
        .map(block => {
          if (typeof block === 'string') {
            return block
          }
          if (block === null || block === undefined) {
            return ''
          }
          try {
            return JSON.stringify(block)
          } catch {
            return String(block)
          }
        })
        .join('\n')
    }

    if (content === null || content === undefined) {
      return ''
    }

    if (typeof content === 'object') {
      try {
        return JSON.stringify(content)
      } catch (error) {
        logger.warn('agent.message.normalize_failure', {
          error,
          contentType: typeof content,
          contentPreview: String(content).slice(0, 100)
        })
        return String(content)
      }
    }

    return String(content)
  }

  private isSupportedContentBlock(block: unknown): block is ContentBlock {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      return false
    }

    if ((block as TextContentBlock).type === 'text') {
      return typeof (block as TextContentBlock).text === 'string'
    }

    if ((block as ImageContentBlock).type === 'image') {
      return typeof (block as ImageContentBlock).mediaType === 'string' && typeof (block as ImageContentBlock).image === 'string'
    }

    return false
  }

  private createTelemetryHooks(agentLogger?: AgentConfig['logger']): {
    prepareStep?: PrepareStepFunction
    onStepFinish?: ToolLoopAgentOnStepFinishCallback<Record<string, any>>
    onFinish?: ToolLoopAgentOnFinishCallback
  } {
    if (!agentLogger) {
      return {}
    }

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

      // Get conversationId stored during prepareCall
      const conversationId = this.currentConversationId

      if (conversationId && this.skillToolProvider) {
        try {
          // Cleanup inactive skills (10 step threshold)
          const deactivated = this.skillToolProvider.cleanupInactiveSkills(
            conversationId,
            stepNumber
          )

          if (deactivated.length > 0) {
            safeLog('info', 'agent.skills.auto_unloaded', {
              agentName,
              conversationId,
              skills: deactivated,
              stepNumber
            }, 'agent.skills.auto_unloaded.log_failed')
          }

          // Get active tool names for this conversation
          const activeSkillTools = this.skillToolProvider.getActiveToolNames(conversationId)

          // Filter out skill tools from base tools using the provider's registry
          // Skill tools should only appear in activeTools when the skill is active
          const skillToolNames = new Set(this.skillToolProvider.getSkillToolNames())
          const allToolNames = Object.keys(this.config.tools || {})
          const baseToolNames = allToolNames.filter(name => !skillToolNames.has(name))

          return {
            // Type cast needed: AI SDK expects keyof TOOLS but we have runtime string arrays
            // from baseToolNames and activeSkillTools that match tool keys at runtime
            activeTools: [...baseToolNames, ...activeSkillTools] as any
          }
        } catch (error) {
          safeLog('error', 'agent.skills.prepareStep_failed', {
            agentName,
            conversationId,
            stepNumber,
            error: error instanceof Error ? error.message : String(error)
          }, 'agent.skills.prepareStep_failed.log_failed')
        }
      }

      return undefined
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
                ...(usage.cachedInputTokens ? { cachedInputTokens: usage.cachedInputTokens } : {})
              }
            : {})
        },
        'agent.step.finish.log_failed'
      )

      // Log caching statistics if available
      // Check for !== undefined rather than truthiness to capture pure cache hits (inputTokens = 0)
      // and tool-only steps (outputTokens = 0)
      if (usage?.cachedInputTokens !== undefined &&
          usage.inputTokens !== undefined &&
          usage.outputTokens !== undefined &&
          usage.totalTokens !== undefined) {
        logCachingStats({
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cachedInputTokens: usage.cachedInputTokens
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
   * Generate a response (non-streaming)
   */
  async generate(prompt: string, options?: {
    messages?: Array<{ role: 'user' | 'assistant', content: string }>
    files?: ProcessedFile[]
    executionContext?: Record<string, unknown>
  }): Promise<{
    content: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usage: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    finishReason: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolCalls: any
  }> {
    const callOptions: AgentCallOptions = {
      basePrompt: prompt
    }
    if (options?.executionContext) {
      callOptions.executionContext = options.executionContext
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
    context?: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'default' | 'ephemeral' } }>
    /** Execution context for tools (appId, userId, etc.) */
    executionContext?: Record<string, unknown>
    /** Files to include in the request (for vision/document analysis) */
    files?: ProcessedFile[]
  }): Promise<{
    textStream: AsyncIterable<string>
  baseStream?: unknown
    getFinalResult: () => Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usage: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  finishReason: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls: any
    }>
  }> {
    return this._executeStreamGenerate(prompt, options)
  }

  /**
   * Internal implementation of streamGenerate
   * Handles tool execution context propagation via ToolLoopAgent call options
   * Includes grant fallback logic for budget exceeded errors
   */
  private async _executeStreamGenerate(prompt: string, options?: {
    messages?: ModelMessage[]
    context?: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'default' | 'ephemeral' } }>
    files?: ProcessedFile[]
    executionContext?: Record<string, unknown>
  }): Promise<{
    textStream: AsyncIterable<string>
    baseStream?: unknown
    getFinalResult: () => Promise<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      usage: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      finishReason: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      context?: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'default' | 'ephemeral' } }>
      files?: ProcessedFile[]
      executionContext?: Record<string, unknown>
    } | undefined,
    socketId: string | undefined,
    retryCount: number
  ): Promise<{
    textStream: AsyncIterable<string>
    baseStream?: unknown
    getFinalResult: () => Promise<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      usage: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      finishReason: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolCalls: any
    }>
  }> {
    // For new accounts: wait for grants to be provisioned if feature is enabled but grants are empty
    // This handles the case where subscription is active but grants haven't been created yet
    if (socketId && retryCount === 0) {
      const featureEnabled = grantSessionManager.isFeatureEnabled(socketId)
      const hasGrants = grantSessionManager.hasGrants(socketId)

      if (featureEnabled && !hasGrants) {
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
      } else if (featureEnabled && hasGrants && isGrantsExhausted(options?.executionContext)) {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
      // Normalize APICallError budget errors to BudgetExceededError so grant fallback works
      let normalizedError = error
      if (isBudgetExceededAPIError(error) && !BudgetExceededError.isInstance(error)) {
        normalizedError = new BudgetExceededError(error.message, error.statusCode ?? 400, error.responseBody)
        if (error.stack) normalizedError.stack = error.stack
      }
      if (BudgetExceededError.isInstance(normalizedError)) {
        // Check if grants feature is active for this session
        if (!socketId || !grantSessionManager.isFeatureEnabled(socketId)) {
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

        // Retry with next grant
        return this._executeStreamWithGrantFallback(prompt, options, socketId, retryCount + 1)
      }

      // Handle API call errors (like tool input validation failures)
      const isToolValidationError =
        (APICallError.isInstance(error) && error.message?.includes('toolUse.input is invalid')) ||
        error?.message?.includes('toolUse.input is invalid')

      if (isToolValidationError) {
        logger.error('Tool input validation error in AgentWrapper.streamGenerate', {
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

    return {
      // Provide the text stream for the caller to iterate over
      // ToolLoopAgent internal types are provider-specific
      textStream: streamResult.textStream,

      // Provide access to the raw baseStream for real-time tool call events
      // baseStream exists at runtime but is not in the AI SDK type definitions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseStream: (streamResult as any).baseStream,

      // Function to get final result after streaming is complete
      getFinalResult: async () => {
        // streamResult is the object returned from ToolLoopAgent.stream; its properties are promises to be awaited below
        const finalResult = streamResult

        // Await all promises from ToolLoopAgent
        const [usage, totalUsage, finishReason, toolCalls, toolResults] = await Promise.all([
          finalResult.usage,
          finalResult.totalUsage,
          finalResult.finishReason,
          finalResult.toolCalls,
          finalResult.toolResults
        ])

        // Use toolResults if available (includes both input and output), otherwise fall back to toolCalls
        const finalToolCalls = toolResults && toolResults.length > 0 ? toolResults : toolCalls

        return {
          usage,
          totalUsage,
          finishReason,
          toolCalls: finalToolCalls
        }
      }
    }
  }


  /**
   * Get the underlying ToolLoopAgent (for advanced usage)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getToolLoopAgent(): ToolLoopAgent<any, any, any> {
    return this.agent
  }

  /**
   * Strip provider options the current model doesn't support (e.g. effort on older Claude models)
   */
  private filterProviderOptions(
    providerOptions: Record<string, unknown>,
    model: import('ai').LanguageModel,
    modelName?: string
  ): Record<string, unknown> | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anthropic = providerOptions.anthropic as Record<string, any> | undefined
    if (!anthropic?.effort) {
      return providerOptions
    }

    const resolvedName = (model as any).modelId || modelName || ''
    if (supportsEffort(resolvedName)) {
      return providerOptions
    }

    logger.warn('provider_options.effort.unsupported', {
      model: resolvedName,
      effort: anthropic.effort,
      message: `Stripping effort parameter — model '${resolvedName}' does not support it`
    })

    const { effort: _, ...restAnthropic } = anthropic
    const filtered: Record<string, unknown> = { ...providerOptions }
    if (Object.keys(restAnthropic).length > 0) {
      filtered.anthropic = restAnthropic
    } else {
      delete filtered.anthropic
    }
    return Object.keys(filtered).length > 0 ? filtered : undefined
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
      logger.info(`Executing handoff: ${sourceAgentId} -> ${targetAgentId}`)
      logger.info(`Task: ${handoffContext.task}`)

      // Execute the task on the target agent with only the provided context
      const streamOptions: {
        context?: { role: 'user' | 'assistant'; content: string; cachePoint?: { type: 'default' | 'ephemeral' } }[]
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

      logger.info(`Handoff completed successfully: ${sourceAgentId} -> ${targetAgentId}`)

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

      logger.error(`Handoff failed: ${sourceAgentId} -> ${targetAgentId}`)
      logger.error(`Error: ${handoffResult.error}`)

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

    // Merge tools (global tools + skill tools + agent-specific tools)
    const globalTools = this.globalConfig.globalTools || []
    const skillTools = this.globalConfig.skillToolProvider?.getAllTools() || {}
    const configTools = config.tools || {}

    // Convert global tools array to object if needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
