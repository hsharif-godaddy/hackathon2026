'use client'

import Link from 'next/link'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { Message as MessageType } from './types'
import MarkdownRenderer from './MarkdownRenderer'
import StatusMessage from './StatusMessage'
import ToolResultMessage from './ToolResultMessage'
import ToolCallMessage from './ToolCallMessage'
import CompletionMessage from './CompletionMessage'
import IntegratedResponse from './IntegratedResponse'
import { serializeToolArgs } from './utils'

interface MessageProps {
  message: MessageType
}

export default function Message({ message }: MessageProps) {
  return (
    <div className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
      <div className={`w-full ${message.sender === 'user' ? 'order-2 max-w-sm' : 'order-1'}`}>
        <div className={`${message.sender === 'user' ? 'text-right' : ''}`}>
            <div className={`inline-block px-3 py-2 rounded-md max-w-full ${
              message.type === 'status' || message.type === 'tool_result' || message.type === 'tool_call' || message.type === 'complete'
                ? 'bg-transparent p-0!'
                : message.sender === 'agent' && message.tool_calls !== undefined
                ? 'bg-transparent p-0!'
                : message.sender === 'user'
                ? 'bg-purple-600 text-white'
                : message.handoff
                ? 'bg-gradient-to-r from-green-50 to-indigo-50 border border-indigo-200'
                : 'bg-gray-100 text-gray-900 p-0!'
            }`}>
              <div className="overflow-hidden">
                {message.type === 'status' ? (
                  <StatusMessage 
                    status={message.status || 'unknown'} 
                    message={message.message || message.content} 
                  />
                ) : message.type === 'tool_call' ? (
                  <ToolCallMessage 
                    toolName={message.tool_name || 'unknown'} 
                    toolStatus={message.tool_status || 'running'}
                    duration={message.duration_ms}
                    toolResult={message.tool_result}
                    error={message.error}
                    toolArgs={serializeToolArgs(message.tool_args)}
                  />
                ) : message.type === 'complete' ? (
                  <CompletionMessage 
                    duration={message.duration_ms || 0}
                    error={message.error}
                  />
                ) : message.type === 'tool_result' ? (
                  <ToolResultMessage 
                    toolName={message.tool_name || 'unknown'} 
                    toolResult={message.tool_result || message.content} 
                  />
                ) : message.sender === 'agent' ? (
                  // Use integrated response for agent messages (new structure or segments)
                  (message.tool_calls !== undefined || message.segments) ? (
                    <IntegratedResponse message={message} />
                  ) : (
                    // Legacy agent message handling
                    message.isThinking ? (
                      <div className="text-sm leading-normal break-words flex items-center space-x-2">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        </div>
                        <span className="text-gray-600">AI Developer is thinking...</span>
                      </div>
                    ) : (
                      <MarkdownRenderer 
                        content={message.content}
                        className="text-sm leading-normal break-words"
                      />
                    )
                  )
                ) : (
                  <p className={`text-sm ${message.handoff ? 'truncate' : 'leading-normal break-words'}`}>
                    {message.content}
                  </p>
                )}
              </div>
              {message.handoff && (
                <div className="mt-2 pt-2 border-t border-indigo-200">
                  <Link
                    href={message.handoff.url}
                    className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-medium rounded-lg hover:shadow-lg transition-all duration-200"
                  >
                    <SparklesIcon className="w-3 h-3 mr-1" />
                    {message.handoff.action} with {message.handoff.to}
                  </Link>
                </div>
              )}
            </div>
        </div>
      </div>
    </div>
  )
}
