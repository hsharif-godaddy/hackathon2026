'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useSendUserMessage } from '@/app/develop/components/chat/ChatContext'
import { useLatestNBAs } from '@/app/develop/components/chat/useLatestNBAs'
import OptionButton from '@/app/develop/components/tool-renderers/OptionButton'
import RebuildPageSelectorToolRenderer from '@/app/develop/components/tool-renderers/RebuildPageSelectorToolRenderer'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import type { TodoItem, TodoList } from '@/stores/useTodoListStore'
import { useCurrentList, useViewState } from '@/stores/useTodoListStore'

/**
 * InputActionsPanel
 *
 * Combines Next Best Actions (NBAs) and Plan/Todo list into a unified panel
 * rendered at the top of the chat input card.
 */
export default function InputActionsPanel() {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const nbaData = useLatestNBAs()
  const currentList = useCurrentList()
  const viewState = useViewState()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  const [nbaExpanded, setNbaExpanded] = useState(true)
  const [planExpanded, setPlanExpanded] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Track previous NBA presence to auto-expand when NBAs first appear
  const prevHadNBAs = useRef(false)

  // showNBAs gates rendering; nbaData gates the early-return so the component
  // stays mounted long enough for AnimatePresence to run the exit animation.
  const showNBAs = !isProcessing && !!nbaData
  const items = currentList?.items || []
  const uncompletedItems = items.filter(item => !item.completed)
  const completedItems = items.filter(item => item.completed)
  const hasPlan = !!currentList && items.length > 0
  const completedCount = completedItems.length
  const totalItems = items.length

  // Auto-expand NBAs when they first appear
  useEffect(() => {
    if (showNBAs && !prevHadNBAs.current) {
      setNbaExpanded(true)
      setPlanExpanded(false)
    }
    prevHadNBAs.current = showNBAs
  }, [showNBAs])

  // Auto-expand plan on update from agent tool result
  useEffect(() => {
    if (viewState === 'update' && hasPlan) {
      setPlanExpanded(true)
      if (showNBAs) {
        setNbaExpanded(false)
      }
    }
  }, [viewState, hasPlan, showNBAs])

  // Collapse plan and clean up when agent starts working
  useEffect(() => {
    if (isProcessing) {
      setPlanExpanded(false)
    }
  }, [isProcessing])

  if (!nbaData && !hasPlan) {
    return null
  }

  function toggleNba() {
    if (!nbaExpanded) {
      setNbaExpanded(true)
      setPlanExpanded(false)
    } else {
      setNbaExpanded(false)
    }
  }

  function togglePlan() {
    if (!planExpanded) {
      setPlanExpanded(true)
      if (showNBAs) {
        setNbaExpanded(false)
      }
    } else {
      setPlanExpanded(false)
    }
  }

  function handleSuggestionClick(text: string) {
    if (isProcessing || !sendUserMessage) return
    sendUserMessage(text, { isActionRequest: true })
  }

  function handlePlanItemClick(item: TodoItem) {
    if (isProcessing || !sendUserMessage) return
    sendUserMessage(item.title, { isActionRequest: true })
  }

  const showRebuildWidget = nbaData?.rebuildWidget?.widgetData?.availablePages?.length > 0

  return (
    <>
      <div className="flex flex-col gap-0.5 mb-1">
        {/* NBAs Section — outer AnimatePresence handles enter/exit of the whole section */}
        <AnimatePresence>
          {showNBAs && (
            <motion.div
              key="nba-section"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <button
                type="button"
                onClick={toggleNba}
                className="w-full flex items-center justify-between px-1 py-0.5 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
              >
                <span>{nbaData.question}</span>
                <svg
                  className="w-2 h-2 text-muted-foreground transition-transform duration-200 flex-shrink-0"
                  style={{ transform: nbaExpanded ? 'rotate(180deg)' : undefined }}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <AnimatePresence initial={false}>
                {nbaExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-col gap-0.5 px-1 pb-1">
                      {showRebuildWidget && (
                        <div className="mb-0.5">
                          <RebuildPageSelectorToolRenderer
                            toolName="rebuildPageSelector"
                            toolStatus="completed"
                            result={{ widget: nbaData.rebuildWidget }}
                            size="small"
                          />
                        </div>
                      )}
                      {nbaData.suggestions.map((suggestion, index) => (
                        <OptionButton
                          key={index}
                          text={suggestion.text}
                          disabled={isProcessing}
                          onClick={() => handleSuggestionClick(suggestion.text)}
                          animationDelay={index * 0.15}
                          isSelectable={true}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Plan Section */}
        {hasPlan && (
          <div>
            <button
              type="button"
              onClick={togglePlan}
              className="w-full flex items-center justify-between px-1 py-0.5 text-sm hover:bg-intents-ux-boxLowContrast-backgroundColor rounded transition-colors"
            >
              <span className="font-medium text-foreground truncate">{currentList.name}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {viewState === 'update' && (
                  <span className="text-xs text-intents-info-color font-medium">
                    {t('builder_todo_updated')}
                  </span>
                )}
                <span className="text-muted-foreground text-xs">
                  {completedCount}/{totalItems}
                </span>
                <svg
                  className="w-2 h-2 text-muted-foreground transition-transform duration-200"
                  style={{ transform: planExpanded ? 'rotate(180deg)' : undefined }}
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

            <AnimatePresence initial={false}>
              {planExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  className="overflow-hidden"
                >
                  <div className="max-h-48 overflow-y-auto px-1 pb-1">
                    {items.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {/* Completed items — read-only */}
                        {completedItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg"
                          >
                            <CircularCheckbox checked />
                            <span className="text-sm line-through text-muted-foreground">{item.title}</span>
                          </div>
                        ))}
                        {/* Uncompleted items — actionable */}
                        {uncompletedItems.map((item, index) => (
                          <OptionButton
                            key={item.id}
                            text={item.title}
                            disabled={isProcessing}
                            onClick={() => handlePlanItemClick(item)}
                            animationDelay={index * 0.15}
                            isSelectable={true}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground text-center py-1">
                        {t('builder_common_todo_no_items')}
                      </div>
                    )}
                    <button
                      type="button"
                      className="text-xs text-intents-info-color hover:text-foreground mt-1 px-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        setIsModalOpen(true)
                      }}
                    >
                      {t('builder_todo_details')}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Separator between panel and input content — negative margins cancel the card's p-1.5 */}
      {(showNBAs || hasPlan) && (
        <div className="-mx-1.5 border-b border-border mb-1" />
      )}

      <TodoListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        list={currentList}
      />
    </>
  )
}

/**
 * Circular Checkbox Component
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
  list: TodoList | null
}) {
  const t = useTranslations()
  const dialogRef = useRef<HTMLDivElement>(null)

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    // Move focus into the dialog on open
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  if (!isOpen || !list) return null

  const items: TodoItem[] = list.items || []
  const totalItems = items.length
  const completedCount = items.filter((item) => item.completed).length

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-intents-ux-boxHighContrastOverlay-backgroundColor z-[60]"
            onClick={onClose}
          />

          <div className="fixed inset-0 z-[60] flex items-center justify-center p-2">
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="todo-modal-title"
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-2xl w-full bg-intents-ux-box-backgroundColor rounded-lg shadow-xl max-h-[80vh] flex flex-col focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 border-b border-border">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h2 id="todo-modal-title" className="text-lg font-semibold text-foreground">{list.name}</h2>
                    {list.description && (
                      <p className="text-sm text-muted-foreground mt-0.5">{list.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      {completedCount}/{totalItems}
                    </span>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label={t('builder_common_close', undefined, 'Close')}
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

              <div className="flex-1 overflow-y-auto px-3 py-2">
                {items.length > 0 ? (
                  <div className="space-y-1.5">
                    {items.map((item) => (
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
