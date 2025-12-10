/**
 * AgentFactory - Modern agent factory using AI SDK 6's ToolLoopAgent
 *
 * Provides agentic loop control, streaming, tool management, and agent handoffs.
 */

import { ToolLoopAgent, stepCountIs, hasToolCall, tool, convertToModelMessages } from 'ai'
import type {
  PrepareStepFunction,
  ToolLoopAgentOnFinishCallback,
  ToolLoopAgentOnStepFinishCallback,
  Tool,
  ToolExecutionOptions
} from 'ai'
import type { GlobalAgentConfig, AgentContext, ProcessedFile, AgentConfig } from './types.js'
import { buildHybridContent } from '../utils/image-content-builder.js'
import type { ContentBlock, TextContentBlock, ImageContentBlock } from '../utils/image-content-builder.js'
import { DEFAULT_RETRY_CONFIG } from '../utils/retry-with-backoff.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('agent-factory')

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
  conversationMessages?: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string | unknown
    cachePoint?: { type: 'default' | 'ephemeral' }
    tool_calls?: unknown
    tool_call_id?: string
    name?: string
    providerOptions?: Record<string, unknown>
  }>
  files?: ProcessedFile[]
  basePrompt?: string
}

type NormalizedMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentBlock[]
  providerOptions?: Record<string, unknown>
  cachePoint?: { type: 'default' | 'ephemeral' }
  name?: string
  tool_calls?: unknown
  tool_call_id?: string
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

    const configuredMaxAttempts = config.retryConfig?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts
    const maxRetries = configuredMaxAttempts > 0 ? Math.max(0, configuredMaxAttempts - 1) : 0

    const telemetryHooks = this.createTelemetryHooks(config.logger)

    // Create the ToolLoopAgent
    this.agent = new ToolLoopAgent({
      model: config.model,
      ...(config.system && { instructions: config.system }),
      tools: wrappedTools,
      ...(config.temperature !== undefined && { temperature: config.temperature }),
      ...(config.maxOutputTokens !== undefined && { maxOutputTokens: config.maxOutputTokens }),
      stopWhen: stopWhen.length > 0 ? stopWhen : [stepCountIs(10)], // Default max 10 steps
      // Pass provider-specific options (e.g., disableParallelToolUse for Anthropic)
      ...(config.providerOptions && { providerOptions: config.providerOptions as any }),
      maxRetries,
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

        const userMessages: Array<{
          role: 'user' | 'assistant' | 'system'
          content: string | unknown
          cachePoint?: { type: 'default' | 'ephemeral' }
          providerOptions?: Record<string, unknown>
          name?: string
          tool_calls?: unknown
          tool_call_id?: string
        }> = [
          ...(callOptions.contextMessages ?? []),
          ...(callOptions.conversationMessages ?? [])
        ]

        if (callOptions.files && callOptions.files.length > 0) {
          userMessages.push(buildHybridContent(basePrompt, callOptions.files) as any)
        } else if (trimmedBasePrompt.length > 0) {
          userMessages.push({ role: 'user', content: trimmedBasePrompt })
        }

        const filteredMessages = userMessages.filter(msg => {
          if (!msg?.content) return false
          if (typeof msg.content === 'string') return msg.content.trim().length > 0
          if (Array.isArray(msg.content)) return msg.content.length > 0
          return true
        })

        const normalizedMessages: NormalizedMessage[] = filteredMessages.map(msg => {
          const normalizedContent = this.normalizeContentForMessage(msg.content)
          const providerOptions = { ...(msg.providerOptions ?? {}) }
          if (msg.cachePoint) {
            providerOptions.bedrock = {
              ...(providerOptions.bedrock as Record<string, unknown> | undefined),
              cachePoint: msg.cachePoint.type
            }
          }
          return {
            role: msg.role,
            content: normalizedContent,
            ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
            ...(msg.name ? { name: msg.name } : {}),
            ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
            ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {})
          }
        })

        let convertedMessages: Array<Record<string, unknown>> | undefined
        const canUseSDKConversion =
          normalizedMessages.length > 0 && normalizedMessages.every(message => this.canConvertMessageForSDK(message))

        if (canUseSDKConversion) {
          const providerOptionsList = normalizedMessages.map(message => message.providerOptions)
          const uiMessages = normalizedMessages.map(message => ({
            role: message.role,
            parts: this.toUIPartsFromContent(message.content)
          }))
          convertedMessages = convertToModelMessages(uiMessages as any).map((modelMessage, index) => {
            const providerOptions = providerOptionsList[index]
            return providerOptions ? { ...modelMessage, providerOptions } : modelMessage
          })
        }

        const preparedCall = { ...rest } as typeof callParameters

        if (convertedMessages && convertedMessages.length > 0) {
          preparedCall.messages = convertedMessages as any
        } else if (normalizedMessages.length > 0) {
          preparedCall.messages = normalizedMessages as any
        } else if (incomingMessages && incomingMessages.length > 0) {
          preparedCall.messages = incomingMessages
        } else if (promptMessageList && promptMessageList.length > 0) {
          preparedCall.messages = promptMessageList as any
        } else if (trimmedBasePrompt.length > 0) {
          preparedCall.prompt = trimmedBasePrompt
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
          logger.error('Tool execution failed', {
            toolName,
            args: processedArgs,
            error: error instanceof Error
              ? {
                  stack: error.stack,
                  message: error.message,
                  name: error.name
                }
              : String(error),
            context
          })
          throw error
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

  private canConvertMessageForSDK(message: NormalizedMessage): boolean {
    if (message.tool_calls || message.tool_call_id || message.name) {
      return false
    }

    if (typeof message.content === 'string') {
      return true
    }

    if (Array.isArray(message.content)) {
      return message.content.every(block => this.isSupportedContentBlock(block))
    }

    return false
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

  private toUIPartsFromContent(content: string | ContentBlock[]): Array<{ type: 'text'; text: string } | { type: 'file'; mediaType: string; url: string }> {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }]
    }

    return content.map(block => {
      if (this.isTextContentBlock(block)) {
        const textBlock = block as TextContentBlock
        return { type: 'text', text: textBlock.text }
      }

      if (this.isImageContentBlock(block)) {
        const imageBlock = block as ImageContentBlock
      return {
        type: 'file',
          mediaType: imageBlock.mediaType,
          url: imageBlock.image
      }
      }

      logger.warn(`Unsupported content block type encountered in toUIPartsFromContent: ${JSON.stringify(block)}`)
      return { type: 'text', text: '' }
    })
  }
  private isTextContentBlock(block: ContentBlock): block is TextContentBlock {
    return block.type === 'text'
  }

  private isImageContentBlock(block: ContentBlock): block is ImageContentBlock {
    return block.type === 'image'
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
                totalTokens: usage.totalTokens
              }
            : {})
        },
        'agent.step.finish.log_failed'
      )
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

    const result = await this.agent.generate({ prompt, options: callOptions })

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
    /** Previous conversation messages */
    messages?: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'default' | 'ephemeral' } }>
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
    messages?: Array<{ role: 'user' | 'assistant' | 'system', content: string, cachePoint?: { type: 'default' | 'ephemeral' } }>
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
      streamResult = await this.agent.stream({ prompt, options: callOptions })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
      // Handle API call errors (like tool input validation failures)
      if (error?.name === 'AI_APICallError' || error?.message?.includes('toolUse.input is invalid')) {
        logger.error('Tool input validation error in AgentWrapper.streamGenerate', { message: error.message })

        // Create an error message for the LLM
        const errorMessage = `Tool call failed due to invalid input format: ${error.message}. Please ensure all tool arguments are properly formatted as valid JSON objects. Check that:
1. All string values are properly quoted
2. All object properties use valid JSON syntax
3. No undefined or null values are passed as tool arguments
4. Arrays and objects are properly structured

Please retry your tool call with corrected input formatting.`

        // Return a mock stream result with the error message
        return {
          textStream: (async function* () {
            yield errorMessage
          })(),
          baseStream: null,
          getFinalResult: async () => ({
            usage: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
            finishReason: 'error',
            toolCalls: []
          })
        }
      }

      // Re-throw other errors
      throw error
    }

    return {
      // Provide the text stream for the caller to iterate over
  // Cast to any for streaming structure as ToolLoopAgent internal types are provider-specific.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textStream: (streamResult as any).textStream,

      // Provide access to the raw baseStream for real-time tool call events
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseStream: (streamResult as any).baseStream,

      // Function to get final result after streaming is complete
      getFinalResult: async () => {
  // streamResult is the object returned from ToolLoopAgent.stream; its properties are promises to be awaited below
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalResult: any = streamResult

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
