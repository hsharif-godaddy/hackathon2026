'use client'

import { useMemo } from 'react'
import ResponseMetadata from '@/app/develop/components/ResponseMetadata'
import StreamingAlertMessage from '@/app/develop/components/StreamingAlertMessage'
import MessageContentRenderer, { type ContentBlock } from '@/app/develop/components/MessageContentRenderer'
import MessageToolCallsRenderer from '@/app/develop/components/MessageToolCallsRenderer'
import { isStreamingMessage, hasValidSegments } from '@/app/develop/components/utils'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { ChatMessage, StreamingMessage as StreamingMessageType } from '@/stores/useStreamingConversationStore'

interface StreamingIntegratedResponseProps {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
  startTime?: Date
  streamingState?: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error'
}

export default function StreamingIntegratedResponse({ message, isActiveStream = false, isLastAssistantMessage = false, startTime, streamingState }: StreamingIntegratedResponseProps) {
  const hasSegments = hasValidSegments(message)
  const isComplete = isStreamingMessage(message) ? message.isComplete : true

  /**
   * Extract tool calls directly from segments as a fallback when chronologicalContent is empty
   * This should only be needed if chronologicalContent processing fails for some reason
   */
  const extractToolCallsFromSegments = (segments: typeof message.segments): ToolCall[] => {
    if (!segments) return []

    const toolCalls: ToolCall[] = []
    const seenIds = new Set<string>()

    segments.forEach((segment) => {
      if ((segment.type === 'tool_start' || segment.type === 'tool_result' || segment.type === 'tool_call') && segment.toolCall) {
        const toolId = segment.toolCall.id
        if (!seenIds.has(toolId)) {
          seenIds.add(toolId)
          toolCalls.push(segment.toolCall)
        }
      }
    })

    return toolCalls
  }

  // Create chronological content blocks from segments
  const chronologicalContent = useMemo(() => {
    if (!hasSegments) return []

    const blocks: ContentBlock[] = []

    let currentTextBlock = ''
    let order = 0

    // Track tool calls to combine start/result
    const toolCallsMap = new Map<string, any>()

    message.segments?.forEach((segment) => {
      if (segment.type === 'text' || segment.type === 'content') {
        // Accumulate text content
        currentTextBlock += segment.content
      } else if (segment.type === 'tool_start' || segment.type === 'tool_result' || segment.type === 'tool_call') {
        // Flush any accumulated text before tool
        if (currentTextBlock.trim()) {
          blocks.push({
            type: 'text',
            content: currentTextBlock,
            order: order++
          })
          currentTextBlock = ''
        }

        if (segment.toolCall) {
          const toolId = segment.toolCall.id

          if (segment.type === 'tool_call') {
            // For persisted tool_call segments, we have complete tool information
            const toolCall: ContentBlock['toolCall'] = {
              id: segment.toolCall.id,
              name: segment.toolCall.name,
              status: (segment.toolCall.status || 'completed') as 'running' | 'completed' | 'error',
              input: segment.toolCall.input,
              result: segment.toolCall.result,
              error: segment.toolCall.error,
              startTime: segment.toolCall.startTime,
              endTime: segment.toolCall.endTime,
              duration: segment.toolCall.duration,
              partialInput: segment.toolCall.partialInput
            }

            blocks.push({
              type: 'tool',
              toolCall,
              order: order++
            })
          } else {
            // For streaming tool_start/tool_result segments, combine them
            if (!toolCallsMap.has(toolId)) {
              // First time seeing this tool - create entry
              const toolCall: ContentBlock['toolCall'] = {
                id: toolId,
                name: segment.toolCall.name,
                status: (segment.type === 'tool_result' ? 'completed' : 'running') as 'running' | 'completed' | 'error',
                input: segment.toolCall.input,
                result: segment.toolCall.result,
                error: segment.toolCall.error,
                startTime: segment.toolCall.startTime,
                endTime: segment.toolCall.endTime,
                partialInput: segment.toolCall.partialInput
              }
              toolCallsMap.set(toolId, toolCall)

              blocks.push({
                type: 'tool',
                toolCall,
                order: order++
              })
            } else {
              // Update existing tool call
              const existingTool = toolCallsMap.get(toolId)!
              if (segment.type === 'tool_result') {
                existingTool.status = segment.toolCall.status || 'completed'
                existingTool.result = segment.toolCall.result
                existingTool.error = segment.toolCall.error
                existingTool.endTime = segment.toolCall.endTime
                // Preserve input from tool_start if not in tool_result
                if (!existingTool.input && segment.toolCall.input) {
                  existingTool.input = segment.toolCall.input
                }
                // Preserve partialInput if present
                if (segment.toolCall.partialInput !== undefined) {
                  existingTool.partialInput = segment.toolCall.partialInput
                }
              } else if (segment.type === 'tool_start') {
                // Update with tool_start data (input, startTime)
                if (segment.toolCall.input) {
                  existingTool.input = segment.toolCall.input
                }
                if (segment.toolCall.startTime) {
                  existingTool.startTime = segment.toolCall.startTime
                }
                // Update partialInput if present
                if (segment.toolCall.partialInput !== undefined) {
                  existingTool.partialInput = segment.toolCall.partialInput
                }
              } else if (segment.type === 'tool_call') {
                // Update with tool_call data (full input)
                if (segment.toolCall.input) {
                  existingTool.input = segment.toolCall.input
                }
                // Update partialInput if present
                if (segment.toolCall.partialInput !== undefined) {
                  existingTool.partialInput = segment.toolCall.partialInput
                }
              }
            }
          }
        }
      }
    })

    // Flush any remaining text
    if (currentTextBlock.trim()) {
      blocks.push({
        type: 'text',
        content: currentTextBlock,
        order: order++
      })
    }

    return blocks.sort((a, b) => a.order - b.order)
  }, [hasSegments, message.segments])

  const getFullResponseText = () => {
    return chronologicalContent
      .filter(block => block.type === 'text')
      .map(block => block.content)
      .join('\n\n')
  }

  return (
    <div>
      <div className="px-2">

        <div className="space-y-2">
          {/* Always use segments - extract tool calls directly if chronologicalContent is empty */}
          {hasSegments ? (
            chronologicalContent.length > 0 ? (
              <MessageContentRenderer blocks={chronologicalContent} isActiveStream={isActiveStream} isLastAssistantMessage={isLastAssistantMessage} />
            ) : (
              <MessageToolCallsRenderer toolCalls={extractToolCallsFromSegments(message.segments)} isActiveStream={isActiveStream} isLastAssistantMessage={isLastAssistantMessage} />
            )
          ) : null}
        </div>

        {/* Max steps reached notification */}
        {message.maxStepsReached && (
          <StreamingAlertMessage
            type="Warning"
            title="Maximum reasoning steps reached"
            message="Content generation stopped here to maintain quick responses, but more steps are needed to complete this task. Continue with a follow-up question or break down your request into smaller parts."
          />
        )}

        {/* Upstream service error notification */}
        {message.upstreamError && (
          <StreamingAlertMessage
            type="Critical"
            title="Error"
            message="Sorry, an error occurred while processing your request. Please try again."
          />
        )}

        {/* Connection retrying notification (yellow warning) */}
        {!message.upstreamError && streamingState === 'retrying' && isActiveStream && !isComplete && (
          <StreamingAlertMessage
            type="Warning"
            title="Connection Lost"
            message="Retrying connection... Your request will resume automatically when reconnected."
          />
        )}

        {/* Connection error notification (red critical - after 5 minutes or reconnect failed) */}
        {!message.upstreamError && streamingState === 'error' && isActiveStream && !isComplete && (
          <StreamingAlertMessage
            type="Critical"
            title="Connection Error"
            message="The connection was lost and could not be restored. Please try again."
          />
        )}

        {/* Response metadata - timing and copy */}
        {isComplete && startTime && (
          <ResponseMetadata
            duration={message.timestamp.getTime() - startTime.getTime()}
            content={getFullResponseText()}
          />
        )}
      </div>
    </div>
  )
}
