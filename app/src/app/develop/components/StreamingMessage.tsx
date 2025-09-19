'use client'

import StreamingIntegratedResponse from './StreamingIntegratedResponse'
import type { ChatMessage, StreamingMessage as StreamingMessageType } from '@/stores/useStreamingConversationStore'

interface StreamingMessageProps {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
}

// Helper function to determine if message should be rendered
function shouldRenderMessage(message: ChatMessage | StreamingMessageType): boolean {
  if (message.role === 'user') return true
  
  // Assistant messages - only render if they have meaningful content
  const hasContent = Boolean(
    message.content || 
    ('isComplete' in message && !message.isComplete) || // Active stream
    message.segments?.length || 
    message.toolCalls?.length
  )
  
  return hasContent
}

// Helper function to get message styling classes (matching Message.tsx)
function getMessageClasses(message: ChatMessage | StreamingMessageType, isActiveStream?: boolean): string {
  const baseClasses = 'inline-block px-3 py-2 rounded-md max-w-full'
  
  // User messages
  if (message.role === 'user') {
    return `${baseClasses} bg-ai-light text-intents-ux-boxHighContrast-foregroundColor`
  }
  
  // Assistant messages with tool calls - transparent background
  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return `${baseClasses} bg-transparent p-0!`
  }
  
  // Active streaming messages that are incomplete
  if (isActiveStream && 'isComplete' in message && !message.isComplete && message.content === '') {
    return `hidden`
  }
  
  // Default assistant messages
  return `${baseClasses} p-0!`
}

// Helper function to render message content based on type and role (matching Message.tsx)
function renderMessageContent(message: ChatMessage | StreamingMessageType, isActiveStream?: boolean) {
  // Assistant messages - use streaming integrated response for proper content flow
  if (message.role === 'assistant') {
    return <StreamingIntegratedResponse message={message} isActiveStream={isActiveStream} />
  }
  
  // User messages and other types
  return (
    <p className="text-sm leading-normal break-words">
      {message.content}
    </p>
  )
}

export default function StreamingMessage({ message, isActiveStream = false }: StreamingMessageProps) {
  // Don't render messages that shouldn't be displayed
  if (!shouldRenderMessage(message)) {
    return null
  }
  
  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
      <div className={`w-full ${message.role === 'user' ? 'order-2 max-w-sm' : 'order-1'}`}>
        <div className={`${message.role === 'user' ? 'text-right' : ''}`}>
          <div className={getMessageClasses(message, isActiveStream)}>
            <div className="overflow-hidden">
              {renderMessageContent(message, isActiveStream)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
