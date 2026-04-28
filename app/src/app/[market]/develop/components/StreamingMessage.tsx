'use client'

import clsx from 'clsx'
import { Check, ClipboardCopy, Expand, Headset } from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import Modal from '@ux/modal'

import { AttachmentList } from '@/app/[market]/develop/components/chat/AttachmentBadge'
import { FileReferenceList } from '@/app/[market]/develop/components/chat/FileReferenceBadge'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import type { ChatMessage, StreamingMessage as StreamingMessageType } from '@/stores/useStreamingConversationStore'
import { useStreamingState } from '@/stores/useStreamingConversationStore'
import { parseValidationStatus, toToolStatus } from '@/stores/validationToolCall'
import StreamingIntegratedResponse from './StreamingIntegratedResponse'
import { getToolRenderer } from './tool-renderers'
import type { DefaultToolRendererProps } from './tool-renderers/DefaultToolRenderer'

interface StreamingMessageProps {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
  startTime?: Date
  showThinking?: boolean
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
    message.outputTokenLimitReached || // Show output token limit warnings
    message.connectionLost || // Show connection lost warning
    message.userStopped // Show user stopped indicator
  )

  return hasContent
}

function isValidationMessage(message: ChatMessage | StreamingMessageType): boolean {
  return message.metadata?.source === 'post_stream_validator' && message.metadata?.displayAs === 'validation'
}

// Helper function to get message styling classes (matching Message.tsx)
function getMessageClasses(message: ChatMessage | StreamingMessageType, isSupport: boolean): string {
  const baseClasses = 'rounded-lg'

  if (isValidationMessage(message)) {
    return clsx(baseClasses, 'max-w-full p-0')
  }

  switch (message.role) {
    case 'user':
      return isSupport
        ? clsx(baseClasses, 'bg-ai/10 px-2 py-1.5 border ms-4 my-0.5')
        : clsx(baseClasses, 'bg-intents-ux-actionHovered-backgroundColor px-2 py-1.5 border ms-4 my-0.5')

    case 'assistant':
      return clsx(baseClasses, 'max-w-full p-0')

    default:
      return clsx(baseClasses)
  }
}

function SupportBadge() {
  return (
    <span className="text-ai mt-0.5 mr-0.5">
      <Headset className="size-2" />
    </span>
  )
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

  if (!isOpen) return null

  return (
    <Modal
      onClose={onClose}
      title={t('builder_settings_logs_expanded_full_message')}
      portalElem={document.body}
      actions={
        <Button
          onClick={handleCopyMessage}
          title={t('builder_common_copy_clipboard', undefined, 'Copy to clipboard')}
          aria-label={t('builder_common_copy_clipboard', undefined, 'Copy to clipboard')}
          icon={copiedToClipboard ? <Check /> : <ClipboardCopy />}
          text={t('builder_common_copy_clipboard', undefined, 'Copy to clipboard')}
          size="sm"
        />
      }
    >
      <div className="max-w-3xl w-full mx-4 max-h-[80vh] flex min-h-0 flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <pre className="min-h-0 flex-1 overflow-y-auto text-sm whitespace-pre-wrap break-words font-sans leading-relaxed">
          {content}
        </pre>
      </div>
    </Modal>
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
                  background: 'linear-gradient(to top, #dfdfe0 0%, transparent 100%)'
                }}
              />
            )}
          </div>
          {isTruncated && (
            <div className="flex items-center justify-center w-full gap-1 pt-1">
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

interface RenderMessageContentOptions {
  message: ChatMessage | StreamingMessageType
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
  startTime?: Date
  streamingState?: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error'
  showThinking?: boolean
}

function renderMessageContent({ message, isActiveStream, isLastAssistantMessage, startTime, streamingState, showThinking }: RenderMessageContentOptions) {
  if (isValidationMessage(message)) {
    const validationStatus = parseValidationStatus(message.metadata?.validationStatus)
    const ValidateCodeToolRenderer = getToolRenderer('validateCode') as ComponentType<DefaultToolRendererProps>

    return (
      <ValidateCodeToolRenderer
        toolName="validateCode"
        toolStatus={toToolStatus(validationStatus)}
        {...(validationStatus === 'error'
          ? { error: message.content }
          : {
            result: {
              status: validationStatus,
              diagnostics: message.content
            }
          })}
        size="regular"
      />
    )
  }

  if (message.role === 'assistant') {
    return <StreamingIntegratedResponse message={message} isActiveStream={isActiveStream} isLastAssistantMessage={isLastAssistantMessage} startTime={startTime} streamingState={streamingState} showThinking={showThinking} />
  }

  if (message.role === 'user') {
    return <UserMessage content={message.content} selectedAssets={message.selectedAssets} referencedFiles={message.referencedFiles} />
  }

  return (
    <p className="text-sm leading-normal break-words">
      {message.content}
    </p>
  )
}

export default function StreamingMessage({ message, isActiveStream = false, isLastAssistantMessage = false, startTime, showThinking = false }: StreamingMessageProps) {
  const streamingState = useStreamingState()
  const showSupportIndicator = useSwitchboard('airo-builder-support-chat-ui')
  const isSupport = showSupportIndicator === true && message.origin === 'support'
  const isValidation = isValidationMessage(message)

  // Don't render messages that shouldn't be displayed
  if (!shouldRenderMessage(message)) {
    return null
  }

  return (
    <div className={clsx('flex w-full', {
      'justify-end': message.role === 'user' && !isValidation,
      'justify-start': message.role !== 'user' || isValidation
    })}>
      <div className={clsx({
        'order-2 flex flex-col items-end': message.role === 'user' && !isValidation,
        'order-1 w-full': message.role !== 'user' || isValidation
      })}>
        <div className={getMessageClasses(message, isSupport)}>
          {renderMessageContent({ message, isActiveStream, isLastAssistantMessage, startTime, streamingState, showThinking })}
        </div>
        {isSupport && message.role === 'user' && !isValidation && <SupportBadge />}
      </div>
    </div>
  )
}
