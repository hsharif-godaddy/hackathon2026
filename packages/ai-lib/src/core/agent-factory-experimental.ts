/**
 * AgentFactory using AI SDK 5's Experimental_Agent
 * 
 * This replaces the custom Agent class with AI SDK 5's built-in Experimental_Agent,
 * which provides better agentic loop control, streaming, and tool management.
 */

import { Experimental_Agent, stepCountIs, hasToolCall, type LanguageModel } from 'ai'
import type { GlobalAgentConfig, AgentContext } from './types.js'

/**
 * Tool execution hook function types
 */
export type BeforeToolExecutionHook = (toolName: string, args: unknown, context?: AgentContext) => Promise<unknown> | unknown
export type AfterToolExecutionHook = (toolName: string, args: unknown, result: unknown, context?: AgentContext) => Promise<unknown> | unknown

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
  context?: Record<string, any> | undefined
  /** Parameters to pass to the target agent */
  parameters?: Record<string, any> | undefined
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
  result?: any
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
 * Configuration for creating an Experimental_Agent
 */
export interface ExperimentalAgentConfig {
  /** Human-readable name of the agent */
  name: string
  /** System prompt for the agent */
  system?: string
  /** Model to use (must be LanguageModel instance) */
  model: LanguageModel
  /** Original model name used for token cost calculations */
  modelName?: string
  /** Tools available to this agent */
  tools?: Record<string, any>
  /** Temperature for generation (0-1) */
  temperature?: number
  /** Maximum tokens to generate */
  maxOutputTokens?: number
  /** Stop conditions for agentic loops */
  stopWhen?: Array<(result: any) => boolean>
  /** Maximum steps for agentic reasoning */
  maxSteps?: number
  /** Stop after specific tool calls */
  stopAfterTools?: string[]
  /** Provider-specific options */
  providerOptions?: Record<string, any>
  /** Hook called before each tool execution */
  beforeToolExecution?: BeforeToolExecutionHook
  /** Hook called after each tool execution */
  afterToolExecution?: AfterToolExecutionHook
  /** Available handoff targets for this agent */
  handoffs?: AgentHandoffConfig[]
}

/**
 * Wrapper around Experimental_Agent to provide consistent API
 */
export class ExperimentalAgentWrapper {
  private agent: Experimental_Agent<any, any, any>
  private config: ExperimentalAgentConfig
  private executionContext?: Record<string, unknown>

  constructor(config: ExperimentalAgentConfig) {
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
    
    // Create the Experimental_Agent
    this.agent = new Experimental_Agent({
      model: config.model,
      ...(config.system && { system: config.system }),
      tools: wrappedTools,
      ...(config.temperature !== undefined && { temperature: config.temperature }),
      ...(config.maxOutputTokens !== undefined && { maxOutputTokens: config.maxOutputTokens }),
      stopWhen: stopWhen.length > 0 ? stopWhen : [stepCountIs(10)] // Default max 10 steps
    })
  }

  /**
   * Get agent name
   */
  getName(): string {
    return this.config.name
  }

  /**
   * Wrap tools with execution hooks
   */
  private wrapToolsWithHooks(tools: Record<string, any>): Record<string, any> {
    if (!this.config.beforeToolExecution && !this.config.afterToolExecution) {
      return tools
    }

    const wrappedTools: Record<string, any> = {}

    for (const [toolName, tool] of Object.entries(tools)) {
      // Clone the tool to avoid modifying the original
      const wrappedTool = { ...tool }

      // Get the original execute function - prefer executeWithContext if available
      const originalExecute = (tool as any).executeWithContext || tool.execute

      if (originalExecute) {
        // Wrap the execute function with hooks
        wrappedTool.execute = async (args: any) => {
          let processedArgs = args

          // Pass execution context to tools that support it
          const context = this.executionContext || {}

          // Execute the original tool function with context
          let result
          try {

            // Call beforeToolExecution hook
            if (this.config.beforeToolExecution) {
              try {
                const hookResult = await this.config.beforeToolExecution(toolName, args, context as AgentContext)
                // If hook returns something, use it as the new args
                if (hookResult !== undefined) {
                  processedArgs = hookResult
                }
              } catch (error) {
                console.error(`Error in beforeToolExecution hook for ${toolName}:`, error)
                // Continue with original args if hook fails
              }
            }
            
            // CRITICAL FIX: Use executeWithContext when available to pass context to tools like fileEdit
            if ((tool as any).executeWithContext) {
              result = await (tool as any).executeWithContext(processedArgs, context)
            } else {
              result = await originalExecute(processedArgs)
            }
          } catch (error) {
            // Call afterToolExecution hook even on error
            if (this.config.afterToolExecution) {
              try {
                await this.config.afterToolExecution(toolName, processedArgs, { error }, context as AgentContext)
              } catch (hookError) {
                console.error(`Error in afterToolExecution hook for ${toolName}:`, hookError)
              }
            }
            
            // IMPROVED ERROR REPORTING: Log detailed error information for better debugging
            console.error(`❌ Tool execution failed for ${toolName}:`, {
              toolName,
              args: processedArgs,
              error: error instanceof Error ? {
                message: error.message,
                stack: error.stack,
                name: error.name
              } : error,
              context: context?.metadata || 'No context'
            })
            
            throw error
          }

          // Call afterToolExecution hook
          if (this.config.afterToolExecution) {
            try {
              const hookResult = await this.config.afterToolExecution(toolName, processedArgs, result, context as AgentContext)
              // If hook returns something, use it as the new result
              if (hookResult !== undefined) {
                result = hookResult
              }
            } catch (error) {
              console.error(`Error in afterToolExecution hook for ${toolName}:`, error)
              // Continue with original result if hook fails
            }
          }

          return result
        }
      }

      wrappedTools[toolName] = wrappedTool
    }

    return wrappedTools
  }

  /**
   * Get agent configuration
   */
  getConfig(): ExperimentalAgentConfig {
    return { ...this.config }
  }

  /**
   * Generate a response (non-streaming)
   */
  async generate(prompt: string, options?: {
    messages?: Array<{ role: 'user' | 'assistant', content: string }>
    context?: Record<string, any>
  }): Promise<{
    content: string
    usage: any
    finishReason: any
    toolCalls: any
  }> {
    const messages = []
    
    // Add context messages if provided
    if (options?.messages) {
      messages.push(...options.messages)
    }
    
    // Add the main prompt
    messages.push({ role: 'user' as const, content: prompt })

    const result = await this.agent.generate(
      messages.length > 1 
        ? { messages } 
        : { prompt }
    )

    // Await all promises from Experimental_Agent
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
  }): Promise<{
    textStream: AsyncIterable<string>
    baseStream?: any
    getFinalResult: () => Promise<{
      usage: any
      finishReason: any
      toolCalls: any
    }>
  }> {
    // Set execution context for tool calls
    this.executionContext = options?.executionContext || {}
    
    const messages = []
    
    // Add custom context as a user message if provided
    if (options?.context) {
      messages.push(...options.context
        .filter(msg => msg.content && msg.content.trim().length > 0)
        .map(msg => ({
          role: msg.role,
          content: msg.content,
          // Convert cachePoint to proper providerOptions format for Bedrock
          ...(msg.cachePoint && {
            providerOptions: {
              bedrock: {
                cachePoint: msg.cachePoint.type
              }
            }
          })
        }))
      )
    }    
    
    // Add conversation history messages if provided
    if (options?.messages) {
      messages.push(...options.messages
        .filter(msg => msg.content && msg.content.trim().length > 0)
        .map(msg => ({
          role: msg.role,
          content: msg.content,
          // Convert cachePoint to proper providerOptions format for Bedrock
          ...(msg.cachePoint && {
            providerOptions: {
              bedrock: {
                cachePoint: msg.cachePoint.type
              }
            }
          })
        }))
      )
    }
    
    // Add the main prompt
    messages.push({ role: 'user' as const, content: prompt })

    let streamResult
    try {
      streamResult = this.agent.stream(
        messages.length > 1 
          ? { messages } 
          : { prompt }
      )
    } catch (error: any) {
      // Handle API call errors (like tool input validation failures)
      if (error?.name === 'AI_APICallError' || error?.message?.includes('toolUse.input is invalid')) {
        console.error('❌ Tool input validation error in ExperimentalAgentWrapper.streamGenerate:', error.message)
        
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
      textStream: streamResult.textStream,
      
      // Provide access to the raw baseStream for real-time tool call events
      baseStream: (streamResult as any).baseStream,
      
      // Function to get final result after streaming is complete
      getFinalResult: async () => {
        const finalResult = await streamResult
        
        // Await all promises from Experimental_Agent
        const [usage, finishReason, toolCalls, toolResults] = await Promise.all([
          finalResult.usage,
          finalResult.finishReason,
          finalResult.toolCalls,
          finalResult.toolResults
        ])
        
        // Use toolResults if available (includes both input and output), otherwise fall back to toolCalls
        const finalToolCalls = toolResults && toolResults.length > 0 ? toolResults : toolCalls
        
        return {
          usage,
          finishReason,
          toolCalls: finalToolCalls
        }
      }
    }
  }


  /**
   * Get the underlying Experimental_Agent (for advanced usage)
   */
  getExperimentalAgent(): Experimental_Agent<any, any, any> {
    return this.agent
  }
}

/**
 * Factory for creating and managing Experimental_Agent instances
 */
export class ExperimentalAgentFactory {
  private agents = new Map<string, ExperimentalAgentWrapper>()
  private globalConfig: GlobalAgentConfig
  private handoffHistory: HandoffHistoryEntry[] = []
  private agentConfigs = new Map<string, ExperimentalAgentConfig>()

  constructor(globalConfig: GlobalAgentConfig = {}) {
    this.globalConfig = globalConfig
  }

  /**
   * Define multiple agents and return a typed interface for accessing them
   */
  defineAgents<T extends Record<string, ExperimentalAgentConfig>>(agentConfigs: T) {
    const definitions = agentConfigs
    
    // Store agent configurations for handoff access
    Object.entries(agentConfigs).forEach(([id, config]) => {
      this.agentConfigs.set(id, config)
    })

    // Create typed getter function
    const get = <K extends keyof T>(id: K): ExperimentalAgentWrapper => {
      const stringId = id as string
      
      if (!this.agents.has(stringId)) {
        const config = agentConfigs[id]
        if (!config) {
          throw new Error(`Agent config not found for id: ${stringId}`)
        }
        const mergedConfig = this.mergeWithGlobalConfig(config)
        this.agents.set(stringId, new ExperimentalAgentWrapper(mergedConfig))
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
      reload: (id: keyof T): ExperimentalAgentWrapper => {
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
      getConfig: (id: keyof T): ExperimentalAgentConfig => {
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
  createAgent(config: ExperimentalAgentConfig & { id: string }): ExperimentalAgentWrapper {
    const mergedConfig = this.mergeWithGlobalConfig(config)
    const agent = new ExperimentalAgentWrapper(mergedConfig)
    
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
    handoffContext: HandoffContext
  ): Promise<HandoffResult> {
    // Ensure source agent exists
    let sourceAgent = this.agents.get(sourceAgentId)
    if (!sourceAgent) {
      const sourceConfig = this.agentConfigs.get(sourceAgentId)
      if (!sourceConfig) {
        throw new Error(`Source agent configuration not found: ${sourceAgentId}`)
      }
      const mergedConfig = this.mergeWithGlobalConfig(sourceConfig)
      sourceAgent = new ExperimentalAgentWrapper(mergedConfig)
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
      targetAgent = new ExperimentalAgentWrapper(mergedConfig)
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
      console.log(`🔄 Executing handoff: ${sourceAgentId} → ${targetAgentId}`)
      console.log(`📋 Task: ${handoffContext.task}`)

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
      
      const result = await targetAgent.streamGenerate(handoffContext.task, streamOptions)

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

      console.log(`✅ Handoff completed successfully: ${sourceAgentId} → ${targetAgentId}`)

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

      console.log(`❌ Handoff failed: ${sourceAgentId} → ${targetAgentId}`)
      console.log(`Error: ${handoffResult.error}`)

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
  private mergeWithGlobalConfig(config: ExperimentalAgentConfig): ExperimentalAgentConfig {
    const merged: ExperimentalAgentConfig = {
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
      merged.tools = {
        ...globalToolsObj,
        ...configTools
      }
    }

    return merged
  }
}

/**
 * Create a new experimental agent factory with global configuration
 */
export function createExperimentalAgentFactory(globalConfig?: GlobalAgentConfig): ExperimentalAgentFactory {
  return new ExperimentalAgentFactory(globalConfig)
}

/**
 * Default experimental agent factory instance
 */
export const defaultExperimentalAgentFactory = new ExperimentalAgentFactory()
