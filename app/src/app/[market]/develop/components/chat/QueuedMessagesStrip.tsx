'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import GrabVertIcon from '@ux/icon/grab-vert'
import InlineEditIcon from '@ux/icon/inline-edit'
import LinkArrowIcon from '@ux/icon/link-arrow'
import PauseIcon from '@ux/icon/pause'
import PlayIcon from '@ux/icon/play'
import TrashIcon from '@ux/icon/trash'
import Tag from '@ux/tag'

import CollapsibleChatInputSection from '@/app/[market]/develop/components/chat/CollapsibleChatInputSection'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import {
  QUEUE_MAX,
  type QueuedMessage,
  useIsQueuePaused,
  useQueuedMessages,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'

const PREVIEW_CHARS = 80

function previewOf(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= PREVIEW_CHARS) return trimmed
  return trimmed.slice(0, PREVIEW_CHARS) + '…'
}

interface QueuedMessageRowProps {
  item: QueuedMessage
  index: number
  isDragging: boolean
  isDropTarget: boolean
  onEdit: (id: string, content: string) => void
  onRemove: (id: string) => void
  onDragStart: (index: number) => void
  onDragOver: (index: number) => void
  onDragEnd: () => void
  onDrop: (index: number) => void
}

function QueuedMessageRow({
  item,
  index,
  isDragging,
  isDropTarget,
  onEdit,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: QueuedMessageRowProps) {
  const t = useTranslations()
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(item.content)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  const submit = () => {
    const next = draft.trim()
    if (!next) return
    if (next !== item.content) onEdit(item.id, next)
    setIsEditing(false)
  }

  const cancelEdit = () => {
    setDraft(item.content)
    setIsEditing(false)
  }

  return (
    <div
      data-testid="queued-message-row"
      draggable={!isEditing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', item.id) // required for drop to fire in some browsers
        onDragStart(index)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver(index)
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop(index)
      }}
      onDragEnd={onDragEnd}
      className={clsx(
        'group flex items-center gap-1 p-0.5 rounded-md transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor',
        isDragging && 'opacity-50',
        isDropTarget && 'bg-intents-ux-boxLowContrast-backgroundColor',
      )}
    >
      <span
        className="relative text-intents-ux-textSubtle-textColor shrink-0 cursor-grab active:cursor-grabbing"
        aria-label={t('builder_queue_drag_handle')}
      >
        <LinkArrowIcon className="block group-hover:hidden size-2!" />
        <GrabVertIcon className="hidden group-hover:block size-2!" />
      </span>
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelEdit()
              }
            }}
            rows={1}
            className="block w-full resize-none text-xs leading-snug bg-transparent outline-none p-0 m-0 align-middle field-sizing-content"
            aria-label={t('builder_common_edit')}
            data-testid="queued-message-edit-input"
          />
        ) : (
          <span
            className="block text-xs leading-snug truncate"
            title={item.content}
            data-testid="queued-message-preview"
          >
            {previewOf(item.content)}
          </span>
        )}
      </div>
      {!isEditing && (
        <div className="flex items-center gap-0 shrink-0">
          <Button
            size="sm"
            design="tertiary"
            icon={<InlineEditIcon className="size-2!" />}
            onClick={() => setIsEditing(true)}
            aria-label={t('builder_common_edit')}
            data-testid="queued-message-edit"
          />
          <Button
            size="sm"
            design="tertiary"
            icon={<TrashIcon className="size-2!" />}
            onClick={() => onRemove(item.id)}
            aria-label={t('builder_common_delete')}
            data-testid="queued-message-remove"
          />
        </div>
      )}
    </div>
  )
}

/** Queue strip above ChatInput. Flag: appbuilder-queue. */
export default function QueuedMessagesStrip() {
  const t = useTranslations()
  const queuedMessages = useQueuedMessages()
  const queuePaused = useIsQueuePaused()
  const removeQueuedMessage = useStreamingConversationStore((s) => s.removeQueuedMessage)
  const updateQueuedMessage = useStreamingConversationStore((s) => s.updateQueuedMessage)
  const moveQueuedMessage = useStreamingConversationStore((s) => s.moveQueuedMessage)
  const setQueuePaused = useStreamingConversationStore((s) => s.setQueuePaused)

  const [isExpanded, setIsExpanded] = useState(true)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)

  const handleEdit = useCallback(
    (id: string, content: string) => {
      logger.info('queue.edit', { id, contentLength: content.length })
      updateQueuedMessage(id, content)
    },
    [updateQueuedMessage],
  )

  const handleRemove = useCallback(
    (id: string) => {
      logger.info('queue.remove', { id })
      removeQueuedMessage(id)
    },
    [removeQueuedMessage],
  )

  const handleTogglePaused = useCallback(() => {
    const next = !queuePaused
    logger.info('queue.toggle-paused', { paused: next, queueLength: queuedMessages.length })
    setQueuePaused(next)
  }, [queuePaused, setQueuePaused, queuedMessages.length])

  const handleDragStart = useCallback((index: number) => {
    setDraggedIndex(index)
  }, [])

  const handleDragOver = useCallback((index: number) => {
    setDropTargetIndex((prev) => (prev === index ? prev : index))
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null)
    setDropTargetIndex(null)
  }, [])

  const handleDrop = useCallback(
    (index: number) => {
      if (draggedIndex === null || draggedIndex === index) {
        handleDragEnd()
        return
      }
      logger.info('queue.reorder', { from: draggedIndex, to: index })
      moveQueuedMessage(draggedIndex, index)
      handleDragEnd()
    },
    [draggedIndex, moveQueuedMessage, handleDragEnd],
  )

  if (queuedMessages.length === 0) return null

  const atCap = queuedMessages.length >= QUEUE_MAX
  const PauseToggleIcon = queuePaused ? PlayIcon : PauseIcon

  const headerTitle = (
    <span className="flex items-center gap-1">
      <span>{t('builder_chatinput_queue_header')}</span>
      <Tag size="sm" emphasis="neutral" aria-label={t('builder_chatinput_queue_count')}>
        {atCap ? `${queuedMessages.length}/${QUEUE_MAX}` : `${queuedMessages.length}`}
      </Tag>
    </span>
  )

  const headerRight = (
    <Button
      size="sm"
      design="tertiary"
      icon={<PauseToggleIcon />}
      onClick={handleTogglePaused}
      aria-label={
        queuePaused
          ? t('builder_chatinput_queue_resume')
          : t('builder_chatinput_queue_pause')
      }
      aria-pressed={queuePaused}
      data-testid="queue-pause-toggle"
    />
  )

  return (
    <div className="px-2 sm:px-3 md:px-0 mb-1" data-testid="queued-messages-strip">
      <div className="rounded-xl shadow-sm bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor px-1 pt-0.5 pb-0">
        <CollapsibleChatInputSection
          title={headerTitle}
          headerRight={headerRight}
          expanded={isExpanded}
          onExpandedChange={setIsExpanded}
        >
          <div className="flex flex-col mb-0.5">
            {queuedMessages.map((item, idx) => (
              <QueuedMessageRow
                key={item.id}
                item={item}
                index={idx}
                isDragging={draggedIndex === idx}
                isDropTarget={
                  dropTargetIndex === idx && draggedIndex !== null && draggedIndex !== idx
                }
                onEdit={handleEdit}
                onRemove={handleRemove}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
              />
            ))}
            {queuePaused && (
              <div
                className="text-xs text-intents-ux-textCritical-foregroundColor p-1"
                data-testid="queue-paused-notice"
                role="status"
              >
                {t('builder_chatinput_queue_paused')}
              </div>
            )}
            {atCap && (
              <div
                className="text-xs text-intents-ux-textWarning-foregroundColor px-1"
                role="status"
                data-testid="queue-cap-warning"
              >
                {t('builder_chatinput_queue_full')}
              </div>
            )}
          </div>
        </CollapsibleChatInputSection>
      </div>
    </div>
  )
}
