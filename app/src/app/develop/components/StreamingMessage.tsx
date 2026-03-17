'use client'

import clsx from 'clsx'
import { Check, ClipboardCopy, Expand, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Button from '@ux/button'

import { AttachmentList } from '@/app/develop/components/chat/AttachmentBadge'
import { FileReferenceList } from '@/app/develop/components/chat/FileReferenceBadge'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import type { ChatMessage, StreamingMessage as StreamingMessageType } from '@/stores/useStreamingConversationStore'
import { useStreamingState } from '@/stores/useStreamingConversationStore'
import StreamingIntegratedResponse from './StreamingIntegratedResponse'

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
    message.maxStepsReached || // Show max steps warnings
    message.outputTokenLimitReached // Show output token limit warnings
  )

  return hasContent
}

// Helper function to get message styling classes (matching Message.tsx)
function getMessageClasses(message: ChatMessage | StreamingMessageType): string {
  const baseClasses = 'rounded-lg'

  // Don't hide messages - we'll show ThinkingIndicator when there's no content
  // (Previously hid messages with no content, but now we show indicator instead)

  switch (message.role) {
    case 'user':
      return clsx(baseClasses, 'bg-intents-ux-actionHovered-backgroundColor px-2 py-1.5 border ml-4 my-0.5')

    case 'assistant':
      return clsx(baseClasses, 'max-w-full p-0')

    default:
      return clsx(baseClasses)
  }
}

/**
 * Modal component for viewing full message content
 */
function FullMessageModal({ content, isOpen, onClose }: { content: string; isOpen: boolean; onClose: () => void }) {
  const t = useTranslations()
  const [copiedToClipboard, setCopiedToClipboard] = useState(false)

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedToClipboard(true)
      setTimeout(() => setCopiedToClipboard(false), 2000)
    } catch (err) {
      logger.error('streaming_message.copy.failed', {
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pl-3 pr-2 py-2 border-b border-intents-ux-box-borderColor">
          <span className="font-medium">{t('builder_settings_logs_expanded_full_message')}</span>
          <div className="flex items-center gap-1">
            <Button
              onClick={handleCopyMessage}
              title={t('builder_common_copy_clipboard')}
              icon={copiedToClipboard ? <Check /> : <ClipboardCopy />}
              size="sm"
            />
            <Button
              onClick={onClose}
              title={t('builder_common_close')}
              icon={<X />}
              size="sm"
            />
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          <pre className="text-sm whitespace-pre-wrap break-words font-sans leading-relaxed">
            {content}
          </pre>
        </div>
      </div>
    </div>
  )
}

/**
 * User message component with copy functionality and truncation for large messages
 */
const MAX_MESSAGE_HEIGHT = 250 // pixels

function UserMessage({ content, selectedAssets, referencedFiles }: { content: string; selectedAssets?: any[]; referencedFiles?: Array<{ path: string; content: string }> }) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contentRef.current) {
      setIsTruncated(contentRef.current.scrollHeight > MAX_MESSAGE_HEIGHT)
    }
  }, [content])

  return (
    <>
      <div className="flex flex-col">
        <div className="relative group max-w-full">
          <div
            ref={contentRef}
            className="relative text-sm leading-relaxed break-words whitespace-pre-wrap font-sans overflow-hidden"
            style={{ maxHeight: isTruncated ? `${MAX_MESSAGE_HEIGHT}px` : undefined }}
          >
            {content}
            {isTruncated && (
              <div
                className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none"
                style={{
                  background: 'linear-gradient(to top, #F5F7F8 0%, transparent 100%)'
                }}
              />
            )}
          </div>
          {isTruncated && (
            <div className="flex items-center justify-center w-full gap-1 pt-1 z-10">
              <button
                onClick={() => setIsModalOpen(true)}
                className="text-xs text-intents-ux-link-foregroundColor hover:cursor-pointer flex items-center gap-0.5 group"
              >
                <Expand className="size-2 group-hover:scale-110 transition-transform duration-200" />
                {t('builder_full_message_modal_show')}
              </button>
            </div>
          )}
        </div>
        {selectedAssets && selectedAssets.length > 0 && (
          <AttachmentList assets={selectedAssets} />
        )}
        {referencedFiles && referencedFiles.length > 0 && (
          <FileReferenceList files={referencedFiles} />
        )}
        <FullMessageModal
          content={content}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </div>
    </>
  )
}

// Helper function to render message content based on type and role (matching Message.tsx)
function renderMessageContent(message: ChatMessage | StreamingMessageType, isActiveStream?: boolean, isLastAssistantMessage?: boolean, startTime?: Date, streamingState?: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error') {
  // Assistant messages - use streaming integrated response for proper content flow
  if (message.role === 'assistant') {
    return <StreamingIntegratedResponse message={message} isActiveStream={isActiveStream} isLastAssistantMessage={isLastAssistantMessage} startTime={startTime} streamingState={streamingState} />
  }

  // User messages with copy functionality
  if (message.role === 'user') {
    return <UserMessage content={message.content} selectedAssets={message.selectedAssets} referencedFiles={message.referencedFiles} />
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
        'order-2 max-w-full': message.role === 'user',
        'order-1 w-full': message.role !== 'user'
      })}>
        <div className={getMessageClasses(message)}>
          {renderMessageContent(message, isActiveStream, isLastAssistantMessage, startTime, streamingState)}
        </div>
      </div>
    </div>
  )
}
