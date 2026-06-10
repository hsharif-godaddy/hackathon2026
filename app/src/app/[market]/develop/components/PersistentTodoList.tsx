'use client'

import { useEffect, useRef, useState } from 'react'
import Flyout from '@ux/flyout'
import Modal from '@ux/modal'

import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { todoListService } from '@/services/TodoListService'
import { useCurrentAppId } from '@/stores/useStreamingConversationStore'
import { useCurrentList, useTodoListStore, useUpdatedItemIds, useViewState } from '@/stores/useTodoListStore'

/**
 * Persistent Todo List Component
 *
 * Displays a compact, persistent todo list at the top of the chat interface
 * with three states: closed, update, and open
 */
export default function PersistentTodoList() {
  const t = useTranslations()
  const currentList = useCurrentList()
  const viewState = useViewState()
  const updatedItemIds = useUpdatedItemIds()
  const appId = useCurrentAppId()
  const setCurrentList = useTodoListStore((state) => state.setCurrentList)
  const toggleViewState = useTodoListStore((state) => state.toggleViewState)

  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const updateContainerRef = useRef<HTMLDivElement>(null)
  // Track which appId the currentList belongs to
  const listAppIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (listAppIdRef.current !== appId) {
      setCurrentList(null)
      listAppIdRef.current = null
    }
  }, [appId, setCurrentList])

  /**
   * Load the current list when the app changes
   */
  useEffect(() => {
    async function load() {
      if (!appId) return

      setIsLoading(true)

      try {
        const list = await todoListService.getCurrentList(appId)
        setCurrentList(list)
        listAppIdRef.current = appId // Track that this list belongs to this appId
        logger.debug('persistent-todo-list.load.success', {
          appId,
          hasCurrentList: !!list,
          listName: list?.name
        })
      } catch (error) {
        logger.error('persistent-todo-list.load.failure', {
          appId,
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [appId, setCurrentList])

  /**
   * Scroll to updated items when in update state
   */
  useEffect(() => {
    if (viewState === 'update' && updateContainerRef.current && updatedItemIds.size > 0) {
      const firstUpdatedId = Array.from(updatedItemIds)[0]
      const element = updateContainerRef.current.querySelector(`[data-item-id="${firstUpdatedId}"]`)

      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 100)
      }
    }
  }, [viewState, updatedItemIds])

  const buttonRef = useRef<HTMLButtonElement>(null)

  // Don't render if no list or loading or invalid list
  const isValidList = currentList && listAppIdRef.current === appId
  if (isLoading || !isValidList) {
    return null
  }

  const items = currentList.items || []
  const completedItems = items.filter(item => item.completed)
  const totalItems = items.length
  const completedCount = completedItems.length

  function renderExpandedContent() {
    if (viewState === 'update') {
      const firstUpdatedIndex = items.findIndex(item => updatedItemIds.has(item.id))

      let itemsToShow = items
      let remainingCount = 0

      if (firstUpdatedIndex !== -1) {
        const startIndex = Math.max(0, firstUpdatedIndex - 1)
        const endIndex = Math.min(items.length, firstUpdatedIndex + 3)
        itemsToShow = items.slice(startIndex, endIndex)
        remainingCount = items.length - itemsToShow.length
      } else {
        itemsToShow = items.slice(0, 4)
        remainingCount = items.length - 4
      }

      return (
        <div
          ref={updateContainerRef}
          className="max-h-16 overflow-y-auto px-2 py-1 space-y-0.5"
        >
          {itemsToShow.map((item) => {
            const isUpdated = updatedItemIds.has(item.id)
            return (
              <TodoItemRow
                key={item.id}
                item={item}
                isHighlighted={isUpdated}
              />
            )
          })}
          {remainingCount > 0 && (
            <div className="text-xs text-muted-foreground text-center pt-0.5">
              {t('builder_todo_count_more_items', { count: remainingCount })}
            </div>
          )}
        </div>
      )
    }

    if (viewState === 'open') {
      return (
        <>
          <div className="px-2 py-1">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-muted-foreground">
                {t('builder_todo_count_completed', { completedCount, totalItems })}
              </div>
              <button
                className="text-xs text-intents-info-color hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleViewState() // Close flyout first
                  setIsModalOpen(true)
                }}
              >
                {t('builder_todo_details')}
              </button>
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto px-2 pb-2">
            {items.length > 0 ? (
              <div className="space-y-0.5">
                {items.map((item) => (
                  <TodoItemRow key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-2">
                {t('builder_common_todo_no_items')}
              </div>
            )}
          </div>
        </>
      )
    }

    return null
  }

  const isExpanded = viewState === 'open' || viewState === 'update'

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggleViewState}
        aria-expanded={isExpanded}
        aria-label={`${currentList.name} todo list`}
        className={`w-full px-2 py-1 flex items-center justify-between gap-1 text-sm bg-intents-ux-box-backgroundColor border border-border shadow-sm hover:shadow-md transition-shadow duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-intents-info-borderColor rounded-lg`}
      >
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <span className="font-medium text-foreground truncate">{currentList.name}</span>
          {viewState === 'update' && (
            <span className="text-xs text-intents-info-color font-medium flex-shrink-0">
              {t('builder_todo_updated')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-muted-foreground text-xs">
            {completedCount}/{totalItems}
          </span>
          <svg
            className="w-2 h-2 text-muted-foreground transition-transform duration-200"
            style={{ transform: isExpanded ? 'rotate(180deg)' : undefined }}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && !isModalOpen && (
        <Flyout
          anchorRef={buttonRef}
          portalElem={document.body}
          onClose={toggleViewState}
          placement="bottom"
          stretch
        >
          {renderExpandedContent()}
        </Flyout>
      )}

      <TodoListModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          // Ensure flyout stays closed after modal closes
          if (viewState !== 'closed') {
            toggleViewState()
          }
        }}
        list={currentList}
      />
    </>
  )
}

/**
 * Todo Item Row Component
 *
 * Renders a single todo item with circular checkbox
 */
function TodoItemRow({
  item,
  isHighlighted = false
}: {
  item: any
  isHighlighted?: boolean
}) {
  return (
    <div
      data-item-id={item.id}
      className={`
        flex items-start gap-1 text-xs px-1 rounded transition-all duration-300
        ${isHighlighted ? 'bg-intents-info-backgroundColor border border-intents-info-borderColor' : ''}
      `}
    >
      <div className="flex-shrink-0">
        <CircularCheckbox checked={item.completed} inProgress={item.inProgress} />
      </div>
      <div className={`flex-1 ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
        {item.title}
      </div>
    </div>
  )
}

/**
 * Circular Checkbox Component
 *
 * Modern circular checkbox with smooth animation
 */
function CircularCheckbox({ checked, inProgress }: { checked: boolean; inProgress?: boolean }) {
  return (
    <div className="relative w-2.5 h-2.5">
      <div className={`
        w-2.5 h-2.5 rounded-full border-2 transition-all duration-200
        ${checked ? 'border-intents-success-borderColor bg-intents-success-backgroundColor' : inProgress ? 'border-intents-info-borderColor' : 'border-border bg-intents-ux-box-backgroundColor'}
      `}>
        {checked && (
          <svg
            className="w-full h-full text-intents-success-color"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M6 10L9 13L14 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {!checked && inProgress && (
          <svg
            className="w-full h-full text-intents-info-color"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10 3 A7 7 0 0 1 10 17"
              fill="currentColor"
            />
          </svg>
        )}
      </div>
    </div>
  )
}

/**
 * Todo List Modal Component
 *
 * Full-screen modal showing complete todo list with descriptions
 */
function TodoListModal({
  isOpen,
  onClose,
  list
}: {
  isOpen: boolean
  onClose: () => void
  list: any
}) {
  const t = useTranslations()

  if (!isOpen || !list) return null

  const items = list.items || []
  const totalItems = items.length
  const completedCount = items.filter((item: any) => item.completed).length

  return (
    <Modal
      title={`${list.name} (${completedCount}/${totalItems})`}
      id='todo-list-modal'
      onClose={onClose}
    >
      <div className="text-left">
        <div className="overflow-y-auto py-2">
        {items.length > 0 ? (
          <div className="space-y-1.5">
            {items.map((item: any) => (
              <div
                key={item.id}
                className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-1.5"
              >
                <div className="flex items-start gap-1.5">
                  <div className="flex-shrink-0">
                    <CircularCheckbox checked={item.completed} inProgress={item.inProgress} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                      {item.title}
                    </div>
                    {item.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {item.description}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-4">
            {t('builder_common_todo_no_items')}
          </div>
        )}
        </div>
      </div>
    </Modal>
  )
}
