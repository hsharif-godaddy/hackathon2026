'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { type RefObject, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChoiceList } from '@airo-ux/pattern-library/input/choice-list'

import { parseChoiceListIndex } from '@/app/[market]/develop/components/tool-renderers/choiceListIndex'
import type { TodoItem, TodoList } from '@/stores/useTodoListStore'

/**
 * Shared label content for the "View plan (X/Y)" toggle button
 */
export function PlanToggleLabel({
  completedCount,
  totalItems,
  fullPlanExpanded,
  viewState,
  t,
}: {
  completedCount: number
  totalItems: number
  fullPlanExpanded: boolean
  viewState: string
  t: (key: string, values?: Record<string, unknown>, fallback?: string) => string
}) {
  return (
    <>
      <span>
        {t('builder_todo_view_plan', { completed: completedCount, total: totalItems })}
        {!fullPlanExpanded && viewState === 'update' && (
          <span className="ml-1 text-intents-info-color font-medium">
            {t('builder_todo_updated')}
          </span>
        )}
      </span>
      <svg
        className="w-2 h-2 transition-transform duration-200"
        style={{ transform: fullPlanExpanded ? 'rotate(180deg)' : undefined }}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path d="M19 9l-7 7-7-7" />
      </svg>
    </>
  )
}

type PlanOptionsListOrientation = 'vertical' | 'horizontal'

export function PlanOptionsList({
  ariaLabel,
  disabled = false,
  items,
  listContainerRef,
  onItemClick,
  orientation = 'vertical',
}: {
  ariaLabel: string
  disabled?: boolean
  items: TodoItem[]
  listContainerRef?: RefObject<HTMLDivElement | null>
  onItemClick: (item: TodoItem) => void
  orientation?: PlanOptionsListOrientation
}) {
  const isHorizontal = orientation === 'horizontal'
  const list = (
    <ChoiceList
      onDecision={(value) => {
        const index = parseChoiceListIndex(value, 'input-actions-panel.plan-options')
        if (index === null) return
        const item = items[index]
        if (item) onItemClick(item)
      }}
      ariaLabel={ariaLabel}
      disabled={disabled}
      optionDividers
      suppressLastRowBottomBorder
    >
      {items.map((item, index) => (
        <ChoiceList.Item key={item.id} value={String(index)}>
          {item.title}
        </ChoiceList.Item>
      ))}
    </ChoiceList>
  )
  if (!isHorizontal) {
    return (
      <div ref={listContainerRef} className="contents">
        {list}
      </div>
    )
  }
  return (
    <div ref={listContainerRef} className="overflow-x-auto rounded-md p-1.5 [&_[role=listbox]]:flex [&_[role=listbox]]:min-h-0 [&_[role=listbox]]:flex-row [&_[role=listbox]]:flex-nowrap [&_[role=listbox]]:gap-1.5 [&_[role=option]]:min-w-0 [&_[role=option]]:flex-shrink-0">
      {list}
    </div>
  )
}


/**
 * Circular checkbox for completed items
 */
export function CircularCheckbox({ checked }: { checked: boolean }) {
  return (
    <div className="relative w-2.5 h-2.5 flex-shrink-0">
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
 * Expanded plan view showing title, completed items, and all uncompleted items
 */
export function FullPlanSection({
  list,
  completedItems,
  uncompletedItems,
  completedCount,
  totalItems,
  isProcessing,
  onItemClick,
  onOpenModal,
  onCollapse,
  t,
}: {
  list: TodoList
  completedItems: TodoItem[]
  uncompletedItems: TodoItem[]
  completedCount: number
  totalItems: number
  isProcessing: boolean
  onItemClick: (item: TodoItem) => void
  onOpenModal: () => void
  onCollapse: () => void
  t: (key: string, values?: Record<string, unknown>, fallback?: string) => string
}) {
  return (
    <div className="flex flex-col gap-0.5 pt-0.5 pb-1">
      {/* Plan title row: name + [i] on left, "View plan" collapse on right */}
      <div className="flex items-center justify-between py-0.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate">{list.name}</span>
          <button
            type="button"
            aria-label={t('builder_todo_details')}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              onOpenModal()
            }}
          >
            <svg className="w-2 h-2" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-2"
          onClick={onCollapse}
        >
          <span>{t('builder_todo_view_plan', { completed: completedCount, total: totalItems })}</span>
          <svg
            className="w-2 h-2"
            style={{ transform: 'rotate(180deg)' }}
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
      </div>

      <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
        {[...completedItems, ...uncompletedItems].length > 0 ? (
          <>
            {/* Completed items — read-only */}
            {completedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg"
              >
                <CircularCheckbox checked />
                <span className="text-sm line-through text-muted-foreground truncate">{item.title}</span>
              </div>
            ))}
            {/* Uncompleted items — actionable */}
            {uncompletedItems.length > 0 && (
              <ChoiceList
                onDecision={(value) => {
                  const index = parseChoiceListIndex(value, 'input-actions-panel.plan-full')
                  if (index === null) return
                  const item = uncompletedItems[index]
                  if (item) onItemClick(item)
                }}
                ariaLabel={t('builder_todo_continue_building')}
                disabled={isProcessing}
                optionDividers
                suppressLastRowBottomBorder
              >
                {uncompletedItems.map((item, index) => (
                  <ChoiceList.Item key={item.id} value={String(index)}>
                    {item.title}
                  </ChoiceList.Item>
                ))}
              </ChoiceList>
            )}
          </>
        ) : (
          <div className="text-xs text-muted-foreground text-center py-1">
            {t('builder_common_todo_no_items')}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Full-screen modal showing complete todo list with descriptions
 */
export function TodoListModal({
  isOpen,
  onClose,
  list,
  t,
}: {
  isOpen: boolean
  onClose: () => void
  list: TodoList | null
  t: (key: string, values?: Record<string, unknown>, fallback?: string) => string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }

    // Focus trap: constrain Tab/Shift+Tab to focusable elements within the dialog
    if (e.key === 'Tab' && dialogRef.current) {
      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
  }, [onClose])

  useEffect(() => {
    if (!isOpen || !list) return
    document.addEventListener('keydown', handleKeyDown)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, list, handleKeyDown])

  if (!list) return null

  const items: TodoItem[] = list.items || []
  const totalItems = items.length
  const completedCount = items.filter((item) => item.completed).length

  // Portal to document.body to escape stacking context of the chat pane.
  // Keep the component mounted so AnimatePresence can run exit animations.
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-intents-ux-boxHighContrastOverlay-backgroundColor z-[100]"
            onClick={onClose}
          />

          <div className="fixed inset-0 z-[100] flex items-center justify-center p-2">
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
                    {items.map((item, index) => (
                      <div
                        key={item.id}
                        className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-1.5"
                      >
                        <div className="flex items-start gap-1.5">
                          <span
                            className={`flex-shrink-0 size-3 rounded text-xs font-medium flex items-center justify-center ${
                              item.completed
                                ? 'bg-intents-success-backgroundColor text-intents-success-color'
                                : 'bg-intents-ux-box-backgroundColor border border-border text-muted-foreground'
                            }`}
                          >
                            {item.completed ? (
                              <svg className="w-2 h-2" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 6l3 3 5-5" />
                              </svg>
                            ) : (
                              index + 1
                            )}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                              {item.title}
                            </div>
                            {item.description && (
                              <div className={`text-xs mt-0.5 ${item.completed ? 'line-through text-muted-foreground' : 'text-muted-foreground'}`}>
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
    </AnimatePresence>,
    document.body
  )
}
