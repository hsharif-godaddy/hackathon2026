/**
 * Tool LLM Helper
 * 
 * Provides helpers for tools that need to make LLM calls internally.
 * Ensures proper tracking, metadata injection, and observability.
 */

import { generateText, type LanguageModel } from 'ai'
import { createLogger } from '@airo/ai-common'

const logger = createLogger('tool-llm-helper')

/**
 * Context for tool-initiated LLM calls
 */
export interface ToolLLMContext {
  /** App ID for usage tracking */
  appId?: string
  /** Conversation/session ID for grouping */
  conversationId?: string
  /** Description of what this LLM call is for */
  description?: string
  /** Tool name that initiated the call */
  toolName?: string
}

/**
 * Options for generateText with tracking
 */
export interface GenerateTextWithTrackingOptions {
  /** The language model to use */
  model: LanguageModel
  /** Model name for cost calculation and tracking */
  modelName: string
  /** System prompt */
  system?: string
  /** User prompt */
  prompt: string
  /** Temperature (0-1) */
  temperature?: number
  /** Maximum tokens to generate */
  maxOutputTokens?: number
  /** Context for tracking and observability */
  context?: ToolLLMContext
  /** Callback for usage tracking (receives usage data) */
  onUsage?: (usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedTokens?: number
    modelName: string
    context?: ToolLLMContext
  }) => Promise<void> | void
}

/**
 * Result from generateText with tracking
 */
export interface GenerateTextWithTrackingResult {
  /** Generated text */
  text: string
  /** Token usage information */
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedTokens?: number
  }
  /** Finish reason */
  finishReason: string
  /** Model name used */
  modelName: string
}

/**
 * Generate text with automatic usage tracking and observability
 * 
 * This helper wraps AI SDK's generateText to provide:
 * - Automatic usage tracking via callback
 * - Structured logging
 * - Error handling
 * - Metadata propagation
 * 
 * @param options - Generation options including model, prompts, and tracking context
 * @returns Promise resolving to generated text and usage information
 * 
 * @example
 * ```typescript
 * const result = await generateTextWithTracking({
 *   model: await getModel('sonnet'),
 *   modelName: 'claude-sonnet-4-20250514',
 *   system: 'You are a helpful assistant',
 *   prompt: 'Generate a color palette',
 *   temperature: 0.8,
 *   context: {
 *     appId: 'app-123',
 *     conversationId: 'conv-456',
 *     description: 'Color scheme generation',
 *     toolName: 'colorScheme'
 *   },
 *   onUsage: async (usage) => {
 *     await tokenRepo.recordUsage(
 *       usage.context.appId,
 *       'llm_request',
 *       usage.promptTokens,
 *       usage.completionTokens,
 *       {
 *         model: usage.modelName,
 *         conversationId: usage.context.conversationId,
 *         description: usage.context.description
 *       }
 *     )
 *   }
 * })
 * ```
 */
export async function generateTextWithTracking(
  options: GenerateTextWithTrackingOptions
): Promise<GenerateTextWithTrackingResult> {
  const {
    model,
    modelName,
    system,
    prompt,
    temperature,
    maxOutputTokens,
    context,
    onUsage
  } = options

  const startTime = Date.now()

  logger.info('tool_llm.generate.begin', {
    modelName,
    toolName: context?.toolName,
    appId: context?.appId,
    conversationId: context?.conversationId,
    description: context?.description,
    promptLength: prompt.length,
    hasSystem: !!system
  })

  try {
    const result = await generateText({
      model,
      ...(system && { system }),
      prompt,
      ...(temperature !== undefined && { temperature }),
      ...(maxOutputTokens !== undefined && { maxOutputTokens })
    })

    const durationMs = Date.now() - startTime

    logger.info('tool_llm.generate.complete', {
      modelName,
      toolName: context?.toolName,
      appId: context?.appId,
      conversationId: context?.conversationId,
      durationMs,
      textLength: result.text.length,
      usage: result.usage,
      finishReason: result.finishReason
    })

    if (onUsage && result.usage) {
      try {
        const usageData: {
          promptTokens: number
          completionTokens: number
          totalTokens: number
          cachedTokens?: number
          modelName: string
          context?: ToolLLMContext
        } = {
          promptTokens: result.usage.inputTokens ?? 0,
          completionTokens: result.usage.outputTokens ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
          modelName
        }
        
        if (context !== undefined) {
          usageData.context = context
        }
        
        if (result.usage.cachedInputTokens !== undefined) {
          usageData.cachedTokens = result.usage.cachedInputTokens
        }
        
        await onUsage(usageData)

        logger.info('tool_llm.usage.tracked', {
          modelName,
          toolName: context?.toolName,
          appId: context?.appId,
          totalTokens: result.usage.totalTokens ?? 0
        })
      } catch (error) {
        logger.error('tool_llm.usage.tracking_failed', {
          modelName,
          toolName: context?.toolName,
          appId: context?.appId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const usageResult: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
      cachedTokens?: number
    } = {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0
    }
    
    if (result.usage.cachedInputTokens !== undefined) {
      usageResult.cachedTokens = result.usage.cachedInputTokens
    }

    return {
      text: result.text,
      usage: usageResult,
      finishReason: result.finishReason,
      modelName
    }
  } catch (error) {
    const durationMs = Date.now() - startTime

    logger.error('tool_llm.generate.failed', {
      modelName,
      toolName: context?.toolName,
      appId: context?.appId,
      conversationId: context?.conversationId,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })

    throw error
  }
}

