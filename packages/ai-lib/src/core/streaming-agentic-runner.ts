import type { Agent } from './agent.js'
import type { AgentContext, AgentResult } from './types.js'

export interface StreamingEvent {
  type: 'step_start' | 'text_chunk' | 'tool_start' | 'tool_result' | 'step_complete'
  step: number
  content?: string
  data?: any
}

export interface StreamingAgenticOptions {
  maxSteps?: number
  context?: AgentContext
  onEvent?: (event: StreamingEvent) => Promise<void> | void
  stopCondition?: (result: AgentResult) => boolean
}

/**
 * Streaming Agentic Runner
 * 
 * Provides real-time streaming of agentic reasoning loops with:
 * - Streaming text content as it's generated
 * - Immediate tool call notifications
 * - Step-by-step progress updates
 * - Real-time UI updates
 */
export class StreamingAgenticRunner {
  constructor(private agent: Agent) {}

  /**
   * Run a streaming agentic loop with real-time updates
   */
  async *runStreamingLoop(
    input: string,
    options: StreamingAgenticOptions = {}
  ): AsyncGenerator<StreamingEvent, AgentResult, unknown> {
    const {
      maxSteps = 10,
      context,
      onEvent,
      stopCondition
    } = options

    let currentInput = input
    let stepNumber = 1
    let finalResult: AgentResult | null = null

    while (stepNumber <= maxSteps) {
      // Emit step start event
      const stepStartEvent: StreamingEvent = {
        type: 'step_start',
        step: stepNumber,
        data: {
          input: currentInput,
          status: 'thinking'
        }
      }
      
      if (onEvent) await onEvent(stepStartEvent)
      yield stepStartEvent

      try {
        // Use the agent's streaming method
        let stepContent = ''
        let stepToolCalls: any[] = []
        
        // Get the streaming generator
        const streamGenerator = this.agent.generateStream(currentInput, context)
        
        // Stream text chunks from the agent
        let streamResult = await streamGenerator.next()
        while (!streamResult.done) {
          const chunk = streamResult.value
          stepContent += chunk
          
          // Emit text chunk event
          const textEvent: StreamingEvent = {
            type: 'text_chunk',
            step: stepNumber,
            content: chunk,
            data: {
              position: stepToolCalls.length > 0 ? 'after_tool' : 'before_tool'
            }
          }
          
          if (onEvent) await onEvent(textEvent)
          yield textEvent
          
          streamResult = await streamGenerator.next()
        }

        // Get the final result (the return value of the generator)
        finalResult = streamResult.value
        
        // If there are tool calls, execute them and emit tool events
        if (finalResult && finalResult.toolCalls && Array.isArray(finalResult.toolCalls)) {
          for (const toolCall of finalResult.toolCalls) {
            // Tool start event
            const toolStartEvent: StreamingEvent = {
              type: 'tool_start',
              step: stepNumber,
              content: `Using ${toolCall.name}...`,
              data: {
                tool: {
                  name: toolCall.name,
                  input: toolCall.input,
                  id: toolCall.id
                }
              }
            }
            
            if (onEvent) await onEvent(toolStartEvent)
            yield toolStartEvent
            
            // Execute the tool to get the result
            let toolResult = toolCall.result
            if (toolResult === undefined && this.agent.hasTools()) {
              try {
                // Get the tool from the agent and execute it
                const tools = this.agent.getTools()
                const tool = tools[toolCall.name]
                if (tool) {
                  // Use executeWithContext if available (for ai-lib tools), otherwise use execute
                  if ((tool as any).executeWithContext) {
                    toolResult = await (tool as any).executeWithContext(toolCall.input, context)
                  } else if (tool.execute) {
                    toolResult = await tool.execute(toolCall.input)
                  } else {
                    console.error('Tool has no execute method:', toolCall.name)
                  }
                } else {
                  console.error('Tool not found:', toolCall.name)
                }
              } catch (error) {
                console.error('Error executing tool:', toolCall.name, error)
                toolResult = { error: error instanceof Error ? error.message : String(error) }
              }
            }
            
            // Create executed tool call with result
            const executedToolCall = {
              ...toolCall,
              result: toolResult
            }
            
            // Tool result event
            const toolResultEvent: StreamingEvent = {
              type: 'tool_result',
              step: stepNumber,
              content: `${toolCall.name} completed`,
              data: {
                tool: {
                  name: toolCall.name,
                  input: toolCall.input,
                  result: toolResult,
                  id: toolCall.id
                }
              }
            }
            
            stepToolCalls.push(executedToolCall)
            
            if (onEvent) await onEvent(toolResultEvent)
            yield toolResultEvent
          }
        }
        
        // Use the streamed content and update tool calls with results
        if (finalResult) {
          finalResult.content = stepContent
          // Update the finalResult with executed tool calls that have results
          if (stepToolCalls.length > 0) {
            finalResult.toolCalls = stepToolCalls
          }
        }

        // Emit step completion
        const stepCompleteEvent: StreamingEvent = {
          type: 'step_complete',
          step: stepNumber,
          content: stepContent,
          data: {
            toolCalls: stepToolCalls,
            isFinal: stepNumber === maxSteps || !this.shouldContinue(finalResult),
            usage: finalResult.usage
          }
        }
        
        if (onEvent) await onEvent(stepCompleteEvent)
        yield stepCompleteEvent

        // Check custom stop condition
        if (stopCondition && stopCondition(finalResult)) {
          break
        }

        // Check if we should continue
        if (!finalResult || !this.shouldContinue(finalResult)) {
          break
        }

        // Prepare input for next step
        currentInput = this.buildNextStepInput(finalResult)
        stepNumber++

      } catch (error) {
        console.error('Error in streaming step:', stepNumber, error)
        // Create a fallback result
        finalResult = {
          content: 'An error occurred during streaming',
          toolCalls: [],
          usage: undefined,
          finishReason: 'error'
        }
        break
      }
    }

    return finalResult || {
      content: 'No result generated',
      toolCalls: [],
      usage: undefined,
      finishReason: 'length'
    }
  }

  /**
   * Check if the agentic loop should continue
   */
  private shouldContinue(result: AgentResult): boolean {
    return !!(result.toolCalls && Array.isArray(result.toolCalls) && result.toolCalls.length > 0)
  }

  /**
   * Run a streaming loop with promise-based API (for easier integration)
   */
  async runStreamingLoopWithCallbacks(
    input: string,
    options: StreamingAgenticOptions = {}
  ): Promise<AgentResult> {
    const generator = this.runStreamingLoop(input, options)
    let result = await generator.next()
    
    while (!result.done) {
      result = await generator.next()
    }
    
    return result.value
  }

  /**
   * Build input for the next step including tool results
   */
  private buildNextStepInput(result: AgentResult): string {
    if (!result.toolCalls || !Array.isArray(result.toolCalls) || result.toolCalls.length === 0) {
      return result.content
    }

    try {
      // Double-check that toolCalls is still an array before mapping
      if (!Array.isArray(result.toolCalls)) {
        return result.content
      }
      
      const toolResults = result.toolCalls
        .map(call => `${call.name}: ${JSON.stringify(call.result)}`)
        .join('\n')

      return `\n\nTool Results:\n${toolResults}\n`
    } catch (error) {
      console.error('Error in buildNextStepInput:', error)
      return result.content
    }
  }
}

/**
 * Factory function to create a streaming agentic runner
 */
export function createStreamingAgenticRunner(agent: Agent): StreamingAgenticRunner {
  return new StreamingAgenticRunner(agent)
}
