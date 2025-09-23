/**
 * Simplified Streaming Agentic Runner using AI SDK 5 built-in features
 * 
 * This replaces our custom implementation with AI SDK 5's native agentic loop control:
 * - Uses streamText with built-in tool calling
 * - Leverages stopWhen conditions for loop control
 * - Provides real-time streaming with automatic tool execution
 */

import { streamText, type LanguageModel, type Tool } from 'ai'
import { stepCountIs, hasToolCall } from 'ai'

export interface SimpleStreamingAgenticOptions {
  model: LanguageModel
  tools?: Record<string, Tool>
  maxSteps?: number
  stopWhenToolCalled?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

export interface StreamingAgenticEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'step_start' | 'step_complete' | 'complete'
  data?: any
  content?: string
  step?: number
}

/**
 * Simple Streaming Agentic Runner using AI SDK 5 native capabilities
 */
export class SimpleStreamingAgenticRunner {
  private options: SimpleStreamingAgenticOptions

  constructor(options: SimpleStreamingAgenticOptions) {
    this.options = {
      maxSteps: 10,
      temperature: 0.3,
      maxTokens: 2000,
      ...options
    }
  }

  /**
   * Run streaming agentic loop with built-in AI SDK 5 features
   */
  async *runStream(
    prompt: string,
    onEvent?: (event: StreamingAgenticEvent) => void | Promise<void>
  ): AsyncGenerator<StreamingAgenticEvent, any, unknown> {
    
    // Build messages
    const messages = []
    if (this.options.systemPrompt) {
      messages.push({
        role: 'system' as const,
        content: this.options.systemPrompt
      })
    }
    messages.push({
      role: 'user' as const,
      content: prompt
    })

    // Build stop conditions
    const stopConditions = [stepCountIs(this.options.maxSteps!)]
    if (this.options.stopWhenToolCalled) {
      stopConditions.push(hasToolCall(this.options.stopWhenToolCalled))
    }

    // Emit start event
    const startEvent: StreamingAgenticEvent = {
      type: 'step_start',
      step: 1,
      data: { prompt }
    }
    if (onEvent) await onEvent(startEvent)
    yield startEvent

    try {
      // Use AI SDK 5's streamText with built-in agentic loop
      let result
      try {
        result = streamText({
          model: this.options.model,
          messages,
          tools: this.options.tools || {},
          ...(this.options.temperature !== undefined && { temperature: this.options.temperature }),
          ...(this.options.maxTokens !== undefined && { maxOutputTokens: this.options.maxTokens }),
          // AI SDK 5's built-in agentic loop control
          stopWhen: stopConditions,
          // Note: experimental_continueSteps may not be available in current AI SDK version
        })
      } catch (error: any) {
        // Handle API call errors (like tool input validation failures)
        if (error?.name === 'AI_APICallError' || error?.message?.includes('toolUse.input is invalid')) {
          console.error('❌ Tool input validation error in SimpleStreamingAgenticRunner:', error.message)
          
          const errorMessage = `Tool call failed due to invalid input format: ${error.message}. Please ensure all tool arguments are properly formatted as valid JSON objects. Check that:
1. All string values are properly quoted
2. All object properties use valid JSON syntax
3. No undefined or null values are passed as tool arguments
4. Arrays and objects are properly structured

Please retry your tool call with corrected input formatting.`

          // Emit error event
          const errorEvent: StreamingAgenticEvent = {
            type: 'complete',
            data: {
              error: errorMessage,
              content: errorMessage
            }
          }
          
          if (onEvent) await onEvent(errorEvent)
          yield errorEvent
          
          return { text: errorMessage, usage: { totalTokens: 0 }, finishReason: 'error' }
        }
        
        // Re-throw other errors
        throw error
      }

      let stepCount = 1
      let accumulatedContent = ''

      try {
        // Stream text content
        for await (const textPart of result.textStream) {
          accumulatedContent += textPart
          
          const textEvent: StreamingAgenticEvent = {
            type: 'text',
            content: textPart,
            step: stepCount
          }
          
          if (onEvent) await onEvent(textEvent)
          yield textEvent
        }

        // Get final result with tool calls
        const finalResult = await result
      } catch (error: any) {
        // Handle streaming errors (like tool input validation failures during streaming)
        if (error?.name === 'AI_APICallError' || error?.message?.includes('toolUse.input is invalid')) {
          console.error('❌ Tool input validation error during streaming in SimpleStreamingAgenticRunner:', error.message)
          
          const errorMessage = `\n\nTool call failed due to invalid input format: ${error.message}. Please ensure all tool arguments are properly formatted as valid JSON objects and retry your tool call with corrected input formatting.`
          
          accumulatedContent += errorMessage
          
          // Emit error as text event
          const errorTextEvent: StreamingAgenticEvent = {
            type: 'text',
            content: errorMessage,
            step: stepCount
          }
          
          if (onEvent) await onEvent(errorTextEvent)
          yield errorTextEvent
          
          // Emit completion event with error
          const errorCompleteEvent: StreamingAgenticEvent = {
            type: 'complete',
            data: {
              content: accumulatedContent,
              error: error.message,
              usage: { totalTokens: 0 },
              finishReason: 'error'
            }
          }
          
          if (onEvent) await onEvent(errorCompleteEvent)
          yield errorCompleteEvent
          
          return { text: accumulatedContent, usage: { totalTokens: 0 }, finishReason: 'error' }
        }
        
        // Re-throw other errors
        throw error
      }

      // Get tool calls (they're a promise in AI SDK 5)
      const toolCalls = await finalResult.toolCalls
      
      // Emit tool events if any tools were called
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          const toolCallEvent: StreamingAgenticEvent = {
            type: 'tool_call',
            step: stepCount,
            data: {
              name: toolCall.toolName,
              input: toolCall.input,
              id: toolCall.toolCallId
            }
          }
          
          if (onEvent) await onEvent(toolCallEvent)
          yield toolCallEvent

          // Tool result event
          const toolResultEvent: StreamingAgenticEvent = {
            type: 'tool_result',
            step: stepCount,
            data: {
              name: toolCall.toolName,
              result: (toolCall as any).result || 'Tool executed', // Handle potential API difference
              id: toolCall.toolCallId
            }
          }
          
          if (onEvent) await onEvent(toolResultEvent)
          yield toolResultEvent
        }
      }

      // Emit completion event
      const completeEvent: StreamingAgenticEvent = {
        type: 'complete',
        step: stepCount,
        data: {
          content: accumulatedContent,
          toolCalls: toolCalls,
          usage: finalResult.usage,
          finishReason: finalResult.finishReason,
          steps: stepCount
        }
      }
      
      if (onEvent) await onEvent(completeEvent)
      yield completeEvent

      return finalResult

    } catch (error) {
      const errorEvent: StreamingAgenticEvent = {
        type: 'complete',
        data: {
          error: error instanceof Error ? error.message : String(error)
        }
      }
      
      if (onEvent) await onEvent(errorEvent)
      yield errorEvent
      
      throw error
    }
  }

  /**
   * Run with promise-based API (simpler for non-streaming use cases)
   */
  async run(
    prompt: string,
    onEvent?: (event: StreamingAgenticEvent) => void | Promise<void>
  ): Promise<any> {
    const stream = this.runStream(prompt, onEvent)
    let finalResult
    
    for await (const event of stream) {
      if (event.type === 'complete') {
        finalResult = event.data
      }
    }
    
    return finalResult
  }
}

/**
 * Factory function to create a simplified streaming agentic runner
 */
export function createSimpleStreamingAgenticRunner(options: SimpleStreamingAgenticOptions): SimpleStreamingAgenticRunner {
  return new SimpleStreamingAgenticRunner(options)
}

/**
 * Utility function for direct streaming without class instantiation
 */
export async function* streamAgenticLoop(
  prompt: string,
  options: SimpleStreamingAgenticOptions,
  onEvent?: (event: StreamingAgenticEvent) => void | Promise<void>
): AsyncGenerator<StreamingAgenticEvent, any, unknown> {
  const runner = new SimpleStreamingAgenticRunner(options)
  yield* runner.runStream(prompt, onEvent)
}
