'use client'

import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { Message as MessageType } from './types'
import MarkdownRenderer from './MarkdownRenderer'
import ToolCallMessage from './ToolCallMessage'

interface IntegratedResponseProps {
  message: MessageType
}

export default function IntegratedResponse({ message }: IntegratedResponseProps) {
  const [isCompletionExpanded, setIsCompletionExpanded] = useState(false)
  
  const hasSegments = message.segments && message.segments.length > 0
  const hasLegacyTools = message.tool_calls && message.tool_calls.length > 0
  const hasLegacyContent = Boolean(message.content && !message.isThinking && !hasSegments)
  const isComplete = message.is_complete
  
  return (
    <div>
      <div className="bg-gray-100 text-gray-900 p-2 rounded-lg">
        {/* Thinking indicator */}
        {message.isThinking && (
          <div className="text-sm leading-relaxed break-words flex items-center space-x-2 mb-2">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
            <span className="text-gray-600">Thinking...</span>
          </div>
        )}

        <div className="space-y-2">
          {/* New segmented approach - render interleaved content and tools */}
          {hasSegments && (
            <div className="space-y-2">
              {message.segments?.map((segment, index) => (
                <div key={segment.id || `segment-${index}`}>
                  {segment.type === 'content' && segment.content && (
                    <MarkdownRenderer 
                      content={segment.content}
                      className="text-sm leading-relaxed break-words"
                    />
                  )}
                  {segment.type === 'tool_call' && segment.tool_call && (
                    <ToolCallMessage
                      toolName={segment.tool_call.tool_name}
                      toolStatus={segment.tool_call.status}
                      duration={segment.tool_call.duration_ms}
                      toolResult={segment.tool_call.tool_result}
                      error={segment.tool_call.error}
                      toolArgs={segment.tool_call.tool_args}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Legacy approach - fallback for old messages */}
          {!hasSegments && (
            <>
              {/* Main content */}
              {hasLegacyContent && (
                <MarkdownRenderer 
                  content={message.content}
                  className="text-sm leading-relaxed break-words"
                />
              )}

              {/* Tool calls integrated inline within the message */}
              {hasLegacyTools && (
                <div className="space-y-1">
                  {message.tool_calls?.map((toolCall, index) => (
                    <ToolCallMessage
                      key={toolCall.id || `toolcall-${index}`}
                      toolName={toolCall.tool_name}
                      toolStatus={toolCall.status}
                      duration={toolCall.duration_ms}
                      toolResult={toolCall.tool_result}
                      error={toolCall.error}
                      toolArgs={toolCall.tool_args}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Completion drawer - outside the main message bubble */}
      {isComplete && message.response_duration_ms && (
        <div className="border-t border-gray-200 pt-2 mt-2">
          <div 
            className="flex items-center justify-between cursor-pointer py-1 hover:opacity-70"
            onClick={() => setIsCompletionExpanded(!isCompletionExpanded)}
          >
            <div className="flex items-center space-x-2">
              <span className="text-xs text-gray-500 font-medium">
                {message.error ? 'Task failed' : 'Task completed'}
              </span>
              <span className="text-xs text-gray-400">
                {message.response_duration_ms < 1000 
                  ? `${message.response_duration_ms}ms`
                  : `${(message.response_duration_ms / 1000).toFixed(1)}s`
                }
              </span>
            </div>
            {isCompletionExpanded ? (
              <ChevronDownIcon className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRightIcon className="w-3 h-3 text-gray-400" />
            )}
          </div>
          
          {/* Expanded completion details */}
          {isCompletionExpanded && (
            <div className="ml-4 mt-2 space-y-1 text-xs text-gray-500">
              <div>Started: {new Date(message.response_start_time || 0).toLocaleTimeString()}</div>
              <div>Finished: {new Date(message.response_end_time || 0).toLocaleTimeString()}</div>
              {message.error && (
                <div className="text-red-600 font-mono bg-red-50 p-2 rounded mt-2">
                  {message.error}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
