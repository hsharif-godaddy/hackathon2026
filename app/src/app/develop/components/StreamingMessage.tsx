'use client'

import { useState } from 'react'
import clsx from 'clsx'
import StreamingIntegratedResponse from './StreamingIntegratedResponse'
import ThinkingIndicator from './ThinkingIndicator'
import type { ChatMessage, StreamingMessage as StreamingMessageType } from '@/stores/useStreamingConversationStore'
import { useStreamingState } from '@/stores/useStreamingConversationStore'
import { Check, ClipboardCopy } from 'lucide-react'

interface StreamingMessageProps {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
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
    message.budgetExceeded || // Show budget exceeded message
    message.maxStepsReached // Show max steps warnings
  )

  return hasContent
}

// Helper function to get message styling classes (matching Message.tsx)
function getMessageClasses(message: ChatMessage | StreamingMessageType, isActiveStream?: boolean): string {
  const baseClasses = 'rounded-md'

  // Don't hide messages - we'll show ThinkingIndicator when there's no content
  // (Previously hid messages with no content, but now we show indicator instead)

  switch (message.role) {
    case 'user':
      return clsx(baseClasses, 'bg-intents-ux-boxLowContrast-backgroundColor px-2 py-1.5 border rounded-br-none ml-4 my-0.5')

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
        className="absolute -bottom-0.5 -right-3 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 text-xs"
        title="Copy message to clipboard"
      >
        {copiedToClipboard ? <Check className="w-2 h-2" /> : <ClipboardCopy className="w-2 h-2" />}
      </button>
    </div>
  )
}

// Helper function to render message content based on type and role (matching Message.tsx)
function renderMessageContent(message: ChatMessage | StreamingMessageType, isActiveStream?: boolean, isLastAssistantMessage?: boolean, startTime?: Date, streamingState?: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error') {
  // Assistant messages - use streaming integrated response for proper content flow
  if (message.role === 'assistant') {
    // Check if we should show thinking indicator (no content yet, stream is active)
    const hasNoContent = !message.content && !message.segments?.length && !message.toolCalls?.length
    const isIncomplete = 'isComplete' in message && !message.isComplete
    const isErrorState = streamingState === 'error'
    const showThinking = isActiveStream && isIncomplete && hasNoContent && !message.upstreamError && !message.budgetExceeded && !message.maxStepsReached && !isErrorState

    if (showThinking) {
      return <ThinkingIndicator />
    }

    return <StreamingIntegratedResponse message={message} isActiveStream={isActiveStream} isLastAssistantMessage={isLastAssistantMessage} startTime={startTime} streamingState={streamingState} />
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

export default function StreamingMessage({ message, isActiveStream = false, isLastAssistantMessage = false, startTime }: StreamingMessageProps) {
  const streamingState = useStreamingState()

  // Don't render messages that shouldn't be displayed
  if (!shouldRenderMessage(message)) {
    return null
  }

  return (
    <div className={clsx('flex w-full', {
      'justify-end': message.role === 'user',
      'justify-start': message.role !== 'user'
    })}>
      <div className={clsx({
        'order-2 max-w-sm max-w-full': message.role === 'user',
        'order-1 w-full': message.role !== 'user'
      })}>
        <div className={getMessageClasses(message, isActiveStream)}>
          <div className="overflow-hidden">
            {renderMessageContent(message, isActiveStream, isLastAssistantMessage, startTime, streamingState)}
          </div>
        </div>
      </div>
    </div>
  )
}
