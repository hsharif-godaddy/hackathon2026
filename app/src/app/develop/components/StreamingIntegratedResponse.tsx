'use client'

import { useMemo } from 'react'

import BudgetExceededBanner from '@/app/develop/components/chat/BudgetExceededBanner'
import MessageContentRenderer, { type ContentBlock } from '@/app/develop/components/MessageContentRenderer'
import MessageToolCallsRenderer from '@/app/develop/components/MessageToolCallsRenderer'
import ResponseMetadata from '@/app/develop/components/ResponseMetadata'
import StreamingAlertMessage from '@/app/develop/components/StreamingAlertMessage'
import { hasValidSegments, isStreamingMessage } from '@/app/develop/components/utils'
import { useTranslations } from '@/hooks/useTranslations'
import type { ChatMessage, StreamingMessage as StreamingMessageType, ToolCall } from '@/stores/useStreamingConversationStore'

interface StreamingIntegratedResponseProps {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
  startTime?: Date
  streamingState?: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error'
}

/**
 * Check if a tool call is a media slot tool that should be grouped
 */
function isMediaSlotTool(name?: string): boolean {
  return name === 'media'
}

/**
 * Group consecutive media slot tool calls into tool-group blocks
 * Single media tool calls are left as individual tool blocks
 */
function groupConsecutiveMediaTools(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = []
  let mediaGroup: ContentBlock[] = []

  const flushMediaGroup = () => {
    if (mediaGroup.length > 1) {
      // Multiple consecutive media tools - create a group
      result.push({
        type: 'tool-group',
        toolCalls: mediaGroup.map((b) => b.toolCall!),
        order: mediaGroup[0]!.order,
      })
    } else if (mediaGroup.length === 1) {
      // Single media tool - keep as individual
      result.push(mediaGroup[0]!)
    }
    mediaGroup = []
  }

  blocks.forEach((block) => {
    if (block.type === 'tool' && isMediaSlotTool(block.toolCall?.name)) {
      mediaGroup.push(block)
    } else {
      // Non-media block - flush any accumulated media group first
      flushMediaGroup()
      result.push(block)
    }
  })

  // Flush any remaining media group at end
  flushMediaGroup()

  return result
}

export default function StreamingIntegratedResponse({ message, isActiveStream = false, isLastAssistantMessage = false, startTime, streamingState }: StreamingIntegratedResponseProps) {
  const t = useTranslations();
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
              status: (segment.toolCall.status || 'completed') as ToolCall['status'],
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
                status: (segment.toolCall.status || (segment.type === 'tool_result' ? 'completed' : 'running')) as ToolCall['status'],
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

    // Sort blocks by order, then group consecutive media tools
    const sortedBlocks = blocks.sort((a, b) => a.order - b.order)
    return groupConsecutiveMediaTools(sortedBlocks)
  }, [hasSegments, message.segments])

  const getFullResponseText = () => {
    return chronologicalContent
      .filter(block => block.type === 'text')
      .map(block => block.content)
      .join('\n\n')
  }

  return (
    <div>
      <div className="space-y-1">
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

        {/* Output token limit reached notification */}
        {message.outputTokenLimitReached && (
          <StreamingAlertMessage
            type="Warning"
            title={t('builder_output_limit_title', undefined, 'Output limit reached')}
            message={t('builder_output_limit_message', undefined, 'The response was cut short because it exceeded the output size limit. Try continuing with a follow-up message, or break your request into smaller parts.')}
          />
        )}

        {/* Connection lost notification */}
        {message.connectionLost && (
          <StreamingAlertMessage
            type="Warning"
            title="Connection lost"
            message="Your connection was interrupted and the response may be incomplete. Try sending a follow-up message to continue."
          />
        )}

        {/* Budget exceeded error notification */}
        {message.budgetExceeded && <BudgetExceededBanner />}

        {/* Upstream service error notification */}
        {message.upstreamError && !message.budgetExceeded && (
          <>
            {/* Retry error - show attempt count and reason */}
            {message.errorType === 'RETRY_ERROR' && message.retryAttempts ? (
              <StreamingAlertMessage
                type="Critical"
                title="Connection Failed After Multiple Attempts"
                message={`Failed after ${message.retryAttempts} attempts${message.retryReason ? ` (${message.retryReason})` : ''}. ${message.error || 'Please try again.'}`}
              />
            ) : message.errorType === 'NETWORK_ERROR' ? (
              /* Network error - prompt to check connection */
              <StreamingAlertMessage
                type="Critical"
                title="Network Error"
                message="Unable to reach the service. Please check your internet connection and try again."
              />
            ) : (
              /* Generic upstream error for all other types */
              <StreamingAlertMessage
                type="Critical"
                title="Error"
                message={message.error || "Sorry, an error occurred while processing your request. Please try again."}
              />
            )}
          </>
        )}

        {/* Connection retrying notification (yellow warning) */}
        {!message.upstreamError && !message.budgetExceeded && streamingState === 'retrying' && isActiveStream && !isComplete && (
          <StreamingAlertMessage
            type="Warning"
            title="Connection Lost"
            message="Retrying connection... Your request will resume automatically when reconnected."
          />
        )}

        {/* Connection error notification (red critical - after 5 minutes or reconnect failed) */}
        {!message.upstreamError && !message.budgetExceeded && streamingState === 'error' && isActiveStream && !isComplete && (
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
  )
}
