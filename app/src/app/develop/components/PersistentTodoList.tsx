'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

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
  const setViewState = useTodoListStore((state) => state.setViewState)
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

  // Don't render if no list or loading or invalid list
  const isValidList = currentList && listAppIdRef.current === appId
  if (isLoading || !isValidList) {
    return null
  }

  const items = currentList.items || []
  const completedItems = items.filter(item => item.completed)
  const totalItems = items.length
  const completedCount = completedItems.length

  /**
   * Render header bar - shared across all states
   */
  function renderHeader() {
    return (
      <div
        className="px-2 py-1 cursor-pointer hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors"
        onClick={toggleViewState}
      >
        <div className="flex items-center justify-between text-sm min-w-0">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <span className="font-medium text-foreground truncate">{currentList.name}</span>
            {viewState === 'update' && (
              <span className="text-xs text-intents-info-color font-medium flex-shrink-0">
                {t('builder_todo_updated')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {viewState === 'open' && (
              <button
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                onClick={(e) => {
                  e.stopPropagation()
                  setViewState('closed')
                }}
                title={t('builder_common_collapse')}
              >
                <svg
                  className="w-2 h-2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <title>{t('builder_common_collapse')}</title>
                  <path d="M5 15l7-7 7 7" />
                </svg>
              </button>
            )}
            <span className="text-muted-foreground text-xs">
              {completedCount}/{totalItems}
            </span>
          </div>
        </div>
      </div>
    )
  }

  /**
   * Render closed state - compact single line
   */
  function renderClosedState() {
    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="bg-intents-ux-box-backgroundColor border-b border-border"
      >
        {renderHeader()}
      </motion.div>
    )
  }

  /**
   * Render update state - shows 1 item before, updated item, and 2 items after
   */
  function renderUpdateState() {
    // Find the first updated item
    const firstUpdatedIndex = items.findIndex(item => updatedItemIds.has(item.id))

    let itemsToShow = items
    let remainingCount = 0

    if (firstUpdatedIndex !== -1) {
      // Show 1 item before, the updated item, and 2 items after (total 4 items)
      const startIndex = Math.max(0, firstUpdatedIndex - 1)
      const endIndex = Math.min(items.length, firstUpdatedIndex + 3)
      itemsToShow = items.slice(startIndex, endIndex)
      remainingCount = items.length - itemsToShow.length
    } else {
      // Fallback: show first 4 items if no updated item found
      itemsToShow = items.slice(0, 4)
      remainingCount = items.length - 4
    }

    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="bg-intents-ux-box-backgroundColor border-b border-border"
      >
        {renderHeader()}

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
      </motion.div>
    )
  }

  /**
   * Render open state - shows all items
   */
  function renderOpenState() {
    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="bg-intents-ux-box-backgroundColor border-b border-border"
      >
        {renderHeader()}

        <div className="px-2 py-1">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-muted-foreground">
              {t('builder_todo_count_completed', { completedCount, totalItems })}
            </div>
            <button
              className="text-xs text-intents-info-color hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
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
      </motion.div>
    )
  }

  return (
    <>
      <AnimatePresence mode="wait">
        {viewState === 'closed' && renderClosedState()}
        {viewState === 'update' && renderUpdateState()}
        {viewState === 'open' && renderOpenState()}
      </AnimatePresence>

      <TodoListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
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
        <CircularCheckbox checked={item.completed} />
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
function CircularCheckbox({ checked }: { checked: boolean }) {
  return (
    <div className="relative w-2.5 h-2.5">
      <div className={`
        w-2.5 h-2.5 rounded-full border-2 transition-all duration-200
        ${checked ? 'border-intents-success-borderColor bg-intents-success-backgroundColor' : 'border-border bg-intents-ux-box-backgroundColor'}
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
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-intents-ux-boxHighContrastOverlay-backgroundColor z-[60]"
            onClick={onClose}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-2">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-2xl w-full bg-intents-ux-box-backgroundColor rounded-lg shadow-xl max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-3 py-2 border-b border-border">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-foreground">{list.name}</h2>
                    {list.description && (
                      <p className="text-sm text-muted-foreground mt-0.5">{list.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      {completedCount}/{totalItems}
                    </span>
                    <button
                      onClick={onClose}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <svg
                        className="w-2.5 h-2.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-3 py-2">
                {items.length > 0 ? (
                  <div className="space-y-1.5">
                    {items.map((item: any) => (
                      <div
                        key={item.id}
                        className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-1.5"
                      >
                        <div className="flex items-start gap-1.5">
                          <div className="flex-shrink-0">
                            <CircularCheckbox checked={item.completed} />
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
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
