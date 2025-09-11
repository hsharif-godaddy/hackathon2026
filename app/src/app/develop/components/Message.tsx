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

// Helper function to determine if message should be rendered
function shouldRenderMessage(message: MessageType): boolean {
  if (message.sender === 'user') return true
  
  // Agent messages - only render if they have meaningful content
  const hasContent = Boolean(message.content || message.isThinking || message.segments?.length || message.tool_calls?.length)
  const isSpecialType = ['status', 'tool_result', 'tool_call', 'complete'].includes(String(message.type || ''))
  
  return hasContent || isSpecialType
}

// Helper function to get message styling classes
function getMessageClasses(message: MessageType): string {
  const baseClasses = 'inline-block px-3 py-2 rounded-md max-w-full'
  
  // Special message types with transparent background
  const specialTypes = ['status', 'tool_result', 'tool_call', 'complete']
  if (specialTypes.includes(message.type || '')) {
    return `${baseClasses} bg-transparent p-0!`
  }
  
  // Agent messages with tool calls
  if (message.sender === 'agent' && message.tool_calls !== undefined && message.tool_calls.length > 0) {
    return `${baseClasses} bg-transparent p-0!`
  }
  
  // User messages
  if (message.sender === 'user') {
    return `${baseClasses} bg-ai-light text-intents-ux-boxHighContrast-foregroundColor`
  }
  
  // Handoff messages
  if (message.handoff) {
    return `${baseClasses} border border-indigo-200`
  }

  // Weird empty thinking messages
  if (message.isThinking && message.content === '') {
    return `hidden`
  }
  
  // Default agent messages
  return `${baseClasses} p-0!`
}

// Helper function to render message content based on type and sender
function renderMessageContent(message: MessageType) {
  // Special message types
  if (message.type === 'status') {
    return (
      <StatusMessage 
        status={message.status || 'unknown'} 
        message={message.message || message.content} 
      />
    )
  }
  
  if (message.type === 'tool_call') {
    return (
      <ToolCallMessage 
        toolName={message.tool_name || 'unknown'} 
        toolStatus={message.tool_status || 'running'}
        duration={message.duration_ms}
        toolResult={message.tool_result}
        error={message.error}
        toolArgs={serializeToolArgs(message.tool_args)}
      />
    )
  }
  
  if (message.type === 'complete') {
    return (
      <CompletionMessage 
        duration={message.duration_ms || 0}
        error={message.error}
      />
    )
  }
  
  if (message.type === 'tool_result') {
    return (
      <ToolResultMessage 
        toolName={message.tool_name || 'unknown'} 
        toolResult={message.tool_result || message.content} 
      />
    )
  }
  
  // Agent messages
  if (message.sender === 'agent') {
    // Use integrated response for agent messages (new structure or segments)
    if (message.tool_calls !== undefined || message.segments) {
      return <IntegratedResponse message={message} />
    }
    
    // Legacy agent message handling
    if (message.isThinking) {
      return (
        <div className="text-sm leading-normal break-words flex items-center space-x-2">
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-ai-light rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-ai rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-2 h-2 bg-ai-dark rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>
          <span className="text-gray-600">AI Developer is thinking...</span>
        </div>
      )
    }
    
    return (
      <MarkdownRenderer 
        content={message.content}
        className="text-sm leading-normal break-words"
      />
    )
  }
  
  // User messages and other types
  return (
    <p className={`text-sm ${message.handoff ? 'truncate' : 'leading-normal break-words'}`}>
      {message.content}
    </p>
  )
}

export default function Message({ message }: MessageProps) {
  // Don't render messages that shouldn't be displayed
  if (!shouldRenderMessage(message)) {
    return null
  }
  
  return (
    <div className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
      <div className={`w-full ${message.sender === 'user' ? 'order-2 max-w-sm' : 'order-1'}`}>
        <div className={`${message.sender === 'user' ? 'text-right' : ''}`}>
          <div className={getMessageClasses(message)}>
            <div className="overflow-hidden">
              {renderMessageContent(message)}
            </div>
            {message.handoff && (
              <div className="mt-2 pt-2 border-t">
                <Link
                  href={message.handoff.url}
                  className="inline-flex items-center px-3 py-2 text-xs font-medium rounded-lg hover:shadow-lg transition-all duration-200"
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
