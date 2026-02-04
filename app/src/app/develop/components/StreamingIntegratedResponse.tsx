'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import Button from '@ux/button'
import text from '@ux/text'

import MessageContentRenderer, { type ContentBlock } from '@/app/develop/components/MessageContentRenderer'
import MessageToolCallsRenderer from '@/app/develop/components/MessageToolCallsRenderer'
import ResponseMetadata from '@/app/develop/components/ResponseMetadata'
import StreamingAlertMessage from '@/app/develop/components/StreamingAlertMessage'
import { hasValidSegments, isStreamingMessage } from '@/app/develop/components/utils'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { ChatMessage, StreamingMessage as StreamingMessageType } from '@/stores/useStreamingConversationStore'

interface StreamingIntegratedResponseProps {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
  startTime?: Date
  streamingState?: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error'
}

/**
 * Calculate the next budget reset time (00:10:00 UTC) and whether it's tomorrow
 */
function getNextResetInfo(): { date: Date; isTomorrow: boolean } {
  const now = new Date();
  const resetTime = new Date(now);

  // Set to 00:10:00 UTC
  resetTime.setUTCHours(0, 10, 0, 0);

  // If we're past today's reset time, move to tomorrow
  const isTomorrow = now >= resetTime;
  if (isTomorrow) {
    resetTime.setUTCDate(resetTime.getUTCDate() + 1);
  }

  return { date: resetTime, isTomorrow };
}

export default function StreamingIntegratedResponse({ message, isActiveStream = false, isLastAssistantMessage = false, startTime, streamingState }: StreamingIntegratedResponseProps) {
  const t = useTranslations();
  const intl = useIntl();
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const openCreditsModal = useDevelopPageStore((state) => state.openCreditsModal)
  const { data: purchaseEnabled } = useSwitchboard('appbuilder-usage-purchase')
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants')
  const hasSegments = hasValidSegments(message)
  const isComplete = isStreamingMessage(message) ? message.isComplete : true

  // Calculate formatted reset time as "today at [time] [timezone]" or "tomorrow at [time] [timezone]"
  const resetTime = useMemo(() => {
    const { date, isTomorrow } = getNextResetInfo();
    const time = intl.formatDate(date, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    return isTomorrow
      ? t('builder_usage_limit_reset_tomorrow', { time }, `tomorrow at ${time}`)
      : t('builder_usage_limit_reset_today', { time }, `today at ${time}`);
  }, [intl, t]);

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
                status: segment.toolCall.status || (segment.type === 'tool_result' ? 'completed' : 'running') as 'running' | 'completed' | 'error',
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

        {/* Budget exceeded error notification */}
        {message.budgetExceeded && (
          <StreamingAlertMessage
            type="Critical"
            title={t('builder_usage_limit_title')}
            message={
              resetTime ? (
                <text.p
                  size={0}
                  dangerouslySetInnerHTML={{
                    __html: t('builder_usage_limit_message', {
                      resetTime,
                      strong: (chunks: string) => `<strong>${chunks}</strong>`
                    })
                  }}
                />
              ) : (
                t('builder_usage_limit_message_no_reset_time')
              )
            }
            actions={purchaseEnabled && (
              <div className="flex gap-2">
                <Button
                  design="primary"
                  size="sm"
                  onClick={() => openUpgradeModal('budget_exceeded.upgrade')}
                  text={t('builder_usage_gauge_upgrade')}
                />
                <Button
                  design="secondary"
                  size="sm"
                  onClick={() => isGrantsEnabled
                    ? openCreditsModal('budget_exceeded.buy_credits')
                    : openUpgradeModal('budget_exceeded.buy_credits')
                  }
                  text={t('builder_usage_gauge_buy_tokens')}
                />
              </div>
            )}
          />
        )}

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
