/**
 * AgentFactory - Modern agent factory using AI SDK 6's ToolLoopAgent
 *
 * Provides agentic loop control, streaming, tool management, and agent handoffs.
 */

import { propagateAttributes } from '@langfuse/tracing'
import { ToolLoopAgent, stepCountIs, hasToolCall, tool } from 'ai'
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
import { buildHybridContent } from '../utils/image-content-builder.js'
import type { ContentBlock, TextContentBlock, ImageContentBlock } from '../utils/image-content-builder.js'
import { createLogger } from '../utils/logger.js'
import { serializeError } from '../utils/errors.js'
import { addCacheControlToMessages, addCacheControlToSystemPrompt, logCachingStats } from '../utils/prompt-caching.js'
import { llmMetadataContext, type LitellmMetadata } from '../providers/unified-provider.js'

const logger = createLogger('agent-factory')

/**
 * Default maximum retry attempts for AI SDK calls.
 *
 * Note: Only maxAttempts is configurable via AgentConfig.retryConfig.
 * Retry delay timing (initial delay, backoff factor, jitter) is controlled
 * by the AI SDK provider implementation and cannot be customized here.
 * Most providers use ~2s initial delay with exponential backoff.
 */
const DEFAULT_MAX_RETRY_ATTEMPTS = 5

/**
 * Extract LiteLLM metadata from execution context for per-request cost tracking
 * @param executionContext - The execution context passed from the caller
 * @param agentName - The name of the current agent
 * @returns LiteLLM metadata object with subscriptionId, customerId, appId, and source tags
 */
function extractLitellmMetadata(
  executionContext?: Record<string, unknown>,
  agentName?: string
): LitellmMetadata | null {
  if (!executionContext || !executionContext.metadata) {
    return null
  }

  const metadata = executionContext.metadata as Record<string, unknown>
  const appId = metadata.appId as string | undefined
  const subscriptionId = metadata.subscriptionId as string | undefined
  const customerId = metadata.customerId as string | undefined

  // Must have at least appId to create metadata
  if (!appId) {
    return null
  }

  const tags: string[] = []

  // Add customerId if available
  if (customerId) {
    tags.push(customerId)
  }

  // Add appId
  tags.push(appId)

  // Add source tag for distinguishing user-triggered vs background operations
  tags.push('source:user-chat')

  // Add agent name (low cardinality - only ~6 agents)
  if (agentName) {
    tags.push(`agent:${agentName}`)
  }

  const litellmMetadata: LitellmMetadata = {
    tags
  }

  // Add subscriptionId for budget tracking
  if (subscriptionId) {
    litellmMetadata.user = subscriptionId
  }

  return litellmMetadata
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

  constructor(config: AgentConfig) {
    this.config = config

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

    // Add stop after specific tools
    if (config.stopAfterTools) {
      stopWhen.push(...config.stopAfterTools.map(toolName => hasToolCall(toolName)))
    }

    // Add custom stop conditions
    if (config.stopWhen) {
      stopWhen.push(...config.stopWhen)
    }

    // Wrap tools with execution hooks if provided
    const wrappedTools = this.wrapToolsWithHooks(config.tools || {})

    const configuredMaxAttempts = config.retryConfig?.maxAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS
    const maxRetries = configuredMaxAttempts > 0 ? Math.max(0, configuredMaxAttempts - 1) : 0

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
      // Pass provider-specific options (e.g., disableParallelToolUse for Anthropic)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(config.providerOptions && { providerOptions: config.providerOptions as any }),
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
      safeLog('info', 'agent.step.begin', {
        agentName,
        stepNumber,
        messageCount: messages.length
      }, 'agent.step.begin.log_failed')

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
    const litellmMetadata = extractLitellmMetadata(options?.executionContext, this.config.name)

    // Wrap LLM call with AsyncLocalStorage context for per-request metadata
    const result = await (litellmMetadata
      ? llmMetadataContext.run(litellmMetadata, async () => {
          return await this.agent.generate({ prompt, options: callOptions })
        })
      : this.agent.generate({ prompt, options: callOptions }))

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

      // Extract userId (appId/siteId) and sessionId from execution context for Langfuse tracing
      const metadata = (options?.executionContext as any)?.metadata
      const userId = metadata?.appId as string | undefined
      const sessionId = metadata?.sessionId as string | undefined

      // Wrap stream call with Langfuse attribute propagation
      const attributes: { userId?: string; sessionId?: string } = {}
      if (userId) attributes.userId = userId
      if (sessionId) attributes.sessionId = sessionId

      // Extract and set LiteLLM metadata for cost tracking
      const litellmMetadata = extractLitellmMetadata(options?.executionContext, this.config.name)

      // Wrap LLM call with AsyncLocalStorage context for per-request metadata
      streamResult = await (litellmMetadata
        ? llmMetadataContext.run(litellmMetadata, async () => {
            return await propagateAttributes(
              attributes,
              async () => {
                return await this.agent.stream({ prompt, options: callOptions })
              }
            )
          })
        : propagateAttributes(
            attributes,
            async () => {
              return await this.agent.stream({ prompt, options: callOptions })
            }
          ))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
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
        this.agents.set(stringId, new AgentWrapper(mergedConfig))
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
    const agent = new AgentWrapper(mergedConfig)

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
      sourceAgent = new AgentWrapper(mergedConfig)
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
      targetAgent = new AgentWrapper(mergedConfig)
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

    // Merge tools (global tools + agent-specific tools)
    if (this.globalConfig.globalTools || config.tools) {
      const globalTools = this.globalConfig.globalTools || []
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

      // Merge with agent-specific tools (agent tools take precedence)
      // Filter out undefined/null tools to prevent errors
      const filteredGlobalTools = Object.fromEntries(
        Object.entries(globalToolsObj).filter(([_, tool]) => tool != null)
      )
      const filteredConfigTools = Object.fromEntries(
        Object.entries(configTools).filter(([_, tool]) => tool != null)
      )
      merged.tools = {
        ...filteredGlobalTools,
        ...filteredConfigTools
      }
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
