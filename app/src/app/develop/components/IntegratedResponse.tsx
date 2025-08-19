'use client'

import { useState, useEffect } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { Message as MessageType, ToolCall } from './types'
import MarkdownRenderer from './MarkdownRenderer'
import ToolCallMessage from './ToolCallMessage'
import CompletionMessage from './CompletionMessage'

interface IntegratedResponseProps {
  message: MessageType
}

export default function IntegratedResponse({ message }: IntegratedResponseProps) {
  const [isToolsExpanded, setIsToolsExpanded] = useState(true)
  const [isCompletionExpanded, setIsCompletionExpanded] = useState(false)
  
  const hasTools = message.tool_calls && message.tool_calls.length > 0
  const hasContent = Boolean(message.content && !message.isThinking)
  const isComplete = message.is_complete
  
  // Automatically close tools section when message is complete
  useEffect(() => {
    if (isComplete && isToolsExpanded) {
      setIsToolsExpanded(false)
    }
  }, [isComplete, isToolsExpanded])
  
  return (
    <div className="space-y-1">
      {/* Thinking indicator */}
      {message.isThinking && (
        <div className="text-sm leading-relaxed break-words flex items-center space-x-2">
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>
          <span className="text-gray-600">Thinking...</span>
        </div>
      )}

      {/* Tool calls section */}
      {hasTools && (
        <div className="space-y-1">
          {/* Tool calls header (collapsible) */}
          <div 
            className="flex items-center space-x-2 cursor-pointer py-1"
            onClick={() => setIsToolsExpanded(!isToolsExpanded)}
          >
            {isToolsExpanded ? (
              <ChevronDownIcon className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRightIcon className="w-3 h-3 text-gray-400" />
            )}
            <span className="text-xs text-gray-500 font-medium">
              {message.tool_calls?.length} tool{message.tool_calls?.length !== 1 ? 's' : ''} used
            </span>
          </div>
          
          {/* Tool calls list */}
          {isToolsExpanded && (
            <div className="ml-4 space-y-1">
              {message.tool_calls?.map((toolCall) => (
                <ToolCallMessage
                  key={toolCall.id}
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
        </div>
      )}

      {/* Main content */}
      {hasContent && (
        <div className="bg-gray-100 text-gray-900 p-2 rounded-lg">
          <MarkdownRenderer 
            content={message.content}
            className="text-sm leading-relaxed break-words"
          />
        </div>
      )}

      {/* Completion drawer */}
      {isComplete && message.response_duration_ms && (
        <div className="border-t border-gray-200 pt-2">
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
