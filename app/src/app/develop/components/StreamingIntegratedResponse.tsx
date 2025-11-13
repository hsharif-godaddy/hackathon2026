'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import clsx from 'clsx'
import ResponseMetadata from '@/app/develop/components/ResponseMetadata'
import StreamingAlertMessage from '@/app/develop/components/StreamingAlertMessage'
import MessageContentRenderer, { type ContentBlock } from '@/app/develop/components/MessageContentRenderer'
import MessageToolCallsRenderer from '@/app/develop/components/MessageToolCallsRenderer'
import ThinkingIndicator from '@/app/develop/components/ThinkingIndicator'
import { isStreamingMessage, hasValidSegments } from '@/app/develop/components/utils'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { ChatMessage, StreamingMessage as StreamingMessageType } from '@/stores/useStreamingConversationStore'

interface StreamingIntegratedResponseProps {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
  startTime?: Date
}

export default function StreamingIntegratedResponse({ message, isActiveStream = false, startTime }: StreamingIntegratedResponseProps) {
  const [showThinkingIndicator, setShowThinkingIndicator] = useState(false)
  const lastUpdateTimeRef = useRef<number>(Date.now())
  const thinkingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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

  // Track content changes to show thinking indicator
  useEffect(() => {
    // Don't show thinking indicator if there's an error or max steps reached
    if (isComplete || !isActiveStream || message.upstreamError || message.maxStepsReached) {
      setShowThinkingIndicator(false)
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current)
        thinkingTimeoutRef.current = null
      }
      return
    }

    // Update last update time when content changes
    lastUpdateTimeRef.current = Date.now()

    // Clear existing timeout
    if (thinkingTimeoutRef.current) {
      clearTimeout(thinkingTimeoutRef.current)
    }

    // Set thinking indicator after brief delay - reduced for smoother UX
    thinkingTimeoutRef.current = setTimeout(() => {
      setShowThinkingIndicator(true)
    }, 400) // Show thinking after 400ms of no updates (reduced from 800ms)

    return () => {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current)
      }
    }
  }, [chronologicalContent, isComplete, isActiveStream, message.upstreamError, message.maxStepsReached])

  const getFullResponseText = () => {
    return chronologicalContent
      .filter(block => block.type === 'text')
      .map(block => block.content)
      .join('\n\n')
  }

  return (
    <div>
      <div className="p-2">

        <div className="space-y-2">
          {/* Always use segments - extract tool calls directly if chronologicalContent is empty */}
          {hasSegments ? (
            chronologicalContent.length > 0 ? (
              <MessageContentRenderer blocks={chronologicalContent} />
            ) : (
              <MessageToolCallsRenderer toolCalls={extractToolCallsFromSegments(message.segments)} />
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

        {/* Error notification */}
        {message.upstreamError && (
          <StreamingAlertMessage
            type="Critical"
            title="Error"
            message="Sorry, an error occurred while processing your request. Please try again."
          />
        )}

        {/* Thinking indicator for active streams - reserve space to prevent layout shifts */}
        <div className={clsx("transition-all duration-200", {
          "h-8 opacity-100": isActiveStream && !isComplete && showThinkingIndicator && !message.upstreamError && !message.maxStepsReached,
          "h-0 opacity-0 overflow-hidden": !(isActiveStream && !isComplete && showThinkingIndicator && !message.upstreamError && !message.maxStepsReached)
        })}>
          {isActiveStream && !isComplete && showThinkingIndicator && !message.upstreamError && !message.maxStepsReached && <ThinkingIndicator />}
        </div>

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
