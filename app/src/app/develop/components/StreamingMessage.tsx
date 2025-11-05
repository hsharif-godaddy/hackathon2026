'use client'

import { useState } from 'react'
import clsx from 'clsx'
import StreamingIntegratedResponse from './StreamingIntegratedResponse'
import type { ChatMessage, StreamingMessage as StreamingMessageType } from '@/stores/useStreamingConversationStore'

interface StreamingMessageProps {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
  startTime?: Date
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

/**
 * User message component with copy functionality
 */
function UserMessage({ content }: { content: string }) {
  const [copiedToClipboard, setCopiedToClipboard] = useState(false)

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedToClipboard(true)
      setTimeout(() => setCopiedToClipboard(false), 2000)
    } catch (err) {
      console.error('Failed to copy message:', err)
    }
  }

  return (
    <div className="relative group">
      <p className="text-sm leading-normal break-words">
        {content}
      </p>
      <button
        onClick={handleCopyMessage}
        className="absolute -bottom-1 -right-6 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 text-xs"
        title="Copy message to clipboard"
      >
        {copiedToClipboard ? '✓' : '⧉'}
      </button>
    </div>
  )
}

// Helper function to render message content based on type and role (matching Message.tsx)
function renderMessageContent(message: ChatMessage | StreamingMessageType, isActiveStream?: boolean, startTime?: Date) {
  // Assistant messages - use streaming integrated response for proper content flow
  if (message.role === 'assistant') {
    return <StreamingIntegratedResponse message={message} isActiveStream={isActiveStream} startTime={startTime} />
  }

  // User messages with copy functionality
  if (message.role === 'user') {
    return <UserMessage content={message.content} />
  }

  // Other message types
  return (
    <p className="text-sm leading-normal break-words">
      {message.content}
    </p>
  )
}

export default function StreamingMessage({ message, isActiveStream = false, startTime }: StreamingMessageProps) {
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
            {renderMessageContent(message, isActiveStream, startTime)}
          </div>
        </div>
      </div>
    </div>
  )
}
