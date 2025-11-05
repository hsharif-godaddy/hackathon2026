'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import clsx from 'clsx'
import MarkdownRenderer from '@/app/develop/components/MarkdownRenderer'
import ResponseMetadata from '@/app/develop/components/ResponseMetadata'
import StreamingAlertMessage from '@/app/develop/components/StreamingAlertMessage'
import ToolRenderer from '@/app/develop/components/ToolRenderer'
import WidgetRenderer from '@/app/develop/components/WidgetRenderer'
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

  const hasSegments = message.segments && message.segments.length > 0
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasContent = Boolean(message.content)
  const isComplete = 'isComplete' in message ? message.isComplete : true

  // Create chronological content blocks from segments
  const chronologicalContent = useMemo(() => {
    if (!hasSegments) return []

    const blocks: Array<{
      type: 'text' | 'tool'
      content?: string
      toolCall?: any
      order: number
    }> = []

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
            const toolCall = {
              id: segment.toolCall.id,
              name: segment.toolCall.name,
              status: segment.toolCall.status || 'completed', // tool_call segments are complete
              input: segment.toolCall.input,
              result: segment.toolCall.result,
              error: segment.toolCall.error,
              startTime: segment.toolCall.startTime,
              endTime: segment.toolCall.endTime,
              duration: segment.toolCall.duration,
              order: order++
            }

            blocks.push({
              type: 'tool',
              toolCall,
              order: toolCall.order
            })
          } else {
            // For streaming tool_start/tool_result segments, combine them
            if (!toolCallsMap.has(toolId)) {
              // First time seeing this tool - create entry
              const toolCall = {
                id: toolId,
                name: segment.toolCall.name,
                status: segment.type === 'tool_result' ? 'completed' : 'running',
                input: segment.toolCall.input,
                result: segment.toolCall.result,
                error: segment.toolCall.error,
                startTime: segment.toolCall.startTime,
                endTime: segment.toolCall.endTime,
                order: order++
              }
              toolCallsMap.set(toolId, toolCall)

              blocks.push({
                type: 'tool',
                toolCall,
                order: toolCall.order
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
              } else if (segment.type === 'tool_start') {
                // Update with tool_start data (input, startTime)
                if (segment.toolCall.input) {
                  existingTool.input = segment.toolCall.input
                }
                if (segment.toolCall.startTime) {
                  existingTool.startTime = segment.toolCall.startTime
                }
              } else if (segment.type === 'tool_call') {
                // Update with tool_call data (full input)
                if (segment.toolCall.input) {
                  existingTool.input = segment.toolCall.input
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
    if (hasSegments) {
      return chronologicalContent
        .filter(block => block.type === 'text')
        .map(block => block.content)
        .join('\n\n')
    }
    return message.content
  }

  const thinkingIndicator = () => (
    <div className="flex items-center gap-4 text-sm mt-4">
      <div className="bg-ai-light/40 rounded-sm px-2 py-1">Airo Developer is thinking</div>
      <div className="flex space-x-1">
        <div className="w-2 h-2 bg-ai-light rounded-full animate-bounce"></div>
        <div className="w-2 h-2 bg-ai rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
        <div className="w-2 h-2 bg-ai-dark rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
      </div>
    </div>
  )

  return (
    <div>
      <div className="p-2">
        {/* Initial thinking indicator - show when actively streaming but no content yet, and no errors */}
        {isActiveStream && !isComplete && chronologicalContent.length === 0 && !hasSegments && !message.upstreamError && !message.maxStepsReached && thinkingIndicator()}

        <div className="space-y-2">
          {/* Streaming approach - accumulate text and render tools in order */}
          {hasSegments ? (
            <div className="space-y-2">
              {/* Render content blocks in chronological order */}
              {chronologicalContent.map((block, index) => (
                <div key={`block-${index}`}>
                  {block.type === 'text' && block.content && (
                    <MarkdownRenderer
                      content={block.content}
                      className="text-sm leading-relaxed break-words"
                    />
                  )}

                  {block.type === 'tool' && block.toolCall && (
                    <>
                      {/* Check if this is a widgetRender tool - render widget instead of tool call */}
                      {block.toolCall.name === 'widgetRender' && 
                       block.toolCall.result && 
                       typeof block.toolCall.result === 'object' &&
                       (block.toolCall.result as any).widgetData ? (
                        <WidgetRenderer
                          widgetData={(block.toolCall.result as any).widgetData}
                          className="my-4"
                        />
                      ) : (
                        <ToolRenderer
                          toolCall={block.toolCall}
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Fallback for messages without segments */
            <>
              {/* Main content */}
              {hasContent && (
                <MarkdownRenderer
                  content={message.content}
                  className="text-sm leading-relaxed break-words"
                />
              )}

              {/* Tool calls for completed messages */}
              {hasToolCalls && (
                <div className="space-y-2">
                  {message.toolCalls?.map((toolCall, index) => (
                    <div key={toolCall.id || `tool-${index}`}>
                      {/* Check if this is a widgetRender tool - render widget instead */}
                      {toolCall.name === 'widgetRender' && 
                       toolCall.result && 
                       typeof toolCall.result === 'object' &&
                       (toolCall.result as any).widgetData ? (
                        <WidgetRenderer
                          widgetData={(toolCall.result as any).widgetData}
                          className="my-4"
                        />
                      ) : (
                        <ToolRenderer
                          toolCall={toolCall}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
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
          {isActiveStream && !isComplete && showThinkingIndicator && !message.upstreamError && !message.maxStepsReached && thinkingIndicator()}
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
