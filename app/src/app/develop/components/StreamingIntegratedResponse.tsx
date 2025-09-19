'use client'

import { useState, useEffect, useRef } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import ToolCallMessage from './ToolCallMessage'
import type { ChatMessage, StreamingMessage as StreamingMessageType } from '@/stores/useStreamingConversationStore'

interface StreamingIntegratedResponseProps {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
}

export default function StreamingIntegratedResponse({ message, isActiveStream = false }: StreamingIntegratedResponseProps) {
  const [showThinkingIndicator, setShowThinkingIndicator] = useState(false)
  const lastUpdateTimeRef = useRef<number>(Date.now())
  const thinkingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  const hasSegments = message.segments && message.segments.length > 0
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasContent = Boolean(message.content)
  const isComplete = 'isComplete' in message ? message.isComplete : true
  
  // Create chronological content blocks from segments
  const chronologicalContent = hasSegments 
    ? (() => {
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
        
        message.segments?.forEach((segment, index) => {
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
      })()
    : []
  
  // Track content changes to show thinking indicator
  useEffect(() => {
    if (isComplete || !isActiveStream) {
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
    
    // Set thinking indicator after brief delay
    thinkingTimeoutRef.current = setTimeout(() => {
      setShowThinkingIndicator(true)
    }, 800) // Show thinking after 800ms of no updates
    
    return () => {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current)
      }
    }
  }, [chronologicalContent, isComplete, isActiveStream])

  const thinkingIndicator = () => (
    <div className="flex items-center space-x-2 text-gray-500 text-sm my-2">
      <div className="flex space-x-1">
        <div className="w-2 h-2 bg-ai-light rounded-full animate-bounce"></div>
        <div className="w-2 h-2 bg-ai rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
        <div className="w-2 h-2 bg-ai-dark rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
      </div>
      <span>AI Developer is thinking...</span>
    </div>
  )

  return (
    <div>
      <div className="p-2">
        {/* Initial thinking indicator - show when actively streaming but no content yet */}
        {isActiveStream && !isComplete && chronologicalContent.length === 0 && !hasSegments && thinkingIndicator()}

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
                    <ToolCallMessage
                      toolName={block.toolCall.name}
                      toolStatus={
                        block.toolCall.status === 'completed' ? 'success' :
                        block.toolCall.status === 'error' ? 'error' :
                        'running'
                      }
                      duration={
                        block.toolCall.startTime && block.toolCall.endTime
                          ? new Date(block.toolCall.endTime).getTime() - new Date(block.toolCall.startTime).getTime()
                          : undefined
                      }
                      toolResult={
                        typeof block.toolCall.result === 'string' 
                          ? block.toolCall.result 
                          : block.toolCall.result 
                            ? JSON.stringify(block.toolCall.result, null, 2)
                            : undefined
                      }
                      error={block.toolCall.error}
                      toolArgs={
                        block.toolCall.input && Object.keys(block.toolCall.input).length > 0
                          ? JSON.stringify(block.toolCall.input, null, 2)
                          : undefined
                      }
                    />
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
                    <div key={toolCall.id || `tool-${index}`} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm text-gray-700">
                          🔧 {toolCall.name}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          toolCall.status === 'completed' ? 'bg-green-100 text-green-800' :
                          toolCall.status === 'error' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {toolCall.status}
                        </span>
                      </div>
                      
                      {/* Tool input */}
                      {toolCall.input && Object.keys(toolCall.input).length > 0 && (
                        <div className="mb-2">
                          <div className="text-xs text-gray-600 mb-1">Input:</div>
                          <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                            {JSON.stringify(toolCall.input, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Tool result */}
                      {toolCall.result && (
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Result:</div>
                          <div className="text-sm">
                            {typeof toolCall.result === 'string' ? (
                              <div className="bg-gray-100 p-2 rounded text-xs font-mono">
                                {toolCall.result}
                              </div>
                            ) : (
                              <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                                {JSON.stringify(toolCall.result, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Tool error */}
                      {toolCall.error && (
                        <div className="mt-2">
                          <div className="text-xs text-red-600 mb-1">Error:</div>
                          <div className="text-xs text-red-800 bg-red-50 p-2 rounded">
                            {toolCall.error}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Thinking indicator for active streams */}
        {isActiveStream && !isComplete && showThinkingIndicator && thinkingIndicator()}
      </div>
    </div>
  )
}
