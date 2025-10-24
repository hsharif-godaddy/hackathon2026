'use client'

import clsx from 'clsx'
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
    message.toolCalls?.length ||
    message.upstreamError || // Show error messages
    message.maxStepsReached // Show max steps warnings
  )

  return hasContent
}

// Helper function to get message styling classes (matching Message.tsx)
function getMessageClasses(message: ChatMessage | StreamingMessageType, isActiveStream?: boolean): string {
  const baseClasses = 'rounded-md'

  // Active streaming messages that are incomplete - but don't hide if there's an error or warning
  if (isActiveStream && 'isComplete' in message && !message.isComplete && message.content === '' && !message.upstreamError && !message.maxStepsReached) {
    return 'hidden'
  }

  switch (message.role) {
    case 'user':
      return clsx(baseClasses, 'bg-intents-ux-boxLowContrast-backgroundColor px-4 py-3 border rounded-br-none ml-8')

    case 'assistant':
      return clsx(baseClasses, 'max-w-full p-0')

    default:
      return clsx(baseClasses)
  }
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
    <div className={clsx('flex w-full', {
      'justify-end': message.role === 'user',
      'justify-start': message.role !== 'user'
    })}>
      <div className={clsx('w-full', {
        'order-2 max-w-sm': message.role === 'user',
        'order-1': message.role !== 'user'
      })}>
        <div className={getMessageClasses(message, isActiveStream)}>
          <div className="overflow-hidden">
            {renderMessageContent(message, isActiveStream)}
          </div>
        </div>
      </div>
    </div>
  )
}
