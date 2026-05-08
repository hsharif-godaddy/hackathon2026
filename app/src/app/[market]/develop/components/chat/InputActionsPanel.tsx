'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import CollapsibleChatInputSection, { CollapseChevron } from '@/app/[market]/develop/components/chat/CollapsibleChatInputSection'
import FontThemePreviewInputPanel from '@/app/[market]/develop/components/chat/FontThemePreviewInputPanel'
import ThemePreviewInputPanel from '@/app/[market]/develop/components/chat/ThemePreviewInputPanel'
import { useLatestNBAs } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import ThinkingIndicator from '@/app/[market]/develop/components/ThinkingIndicator'
import AskQuestionToolRenderer from '@/app/[market]/develop/components/tool-renderers/AskQuestionToolRenderer'
import OptionButton from '@/app/[market]/develop/components/tool-renderers/OptionButton'
import OptionInput from '@/app/[market]/develop/components/tool-renderers/OptionInput'
import RebuildPageSelectorToolRenderer from '@/app/[market]/develop/components/tool-renderers/RebuildPageSelectorToolRenderer'
import { useNumberKeySelection } from '@/app/[market]/develop/components/tool-renderers/useNumberKeySelection'
import { ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { findLatestAppliedColorScheme } from '@/app/[market]/develop/components/utils/findLatestAppliedColorScheme'
import { findLatestAppliedFontTheme } from '@/app/[market]/develop/components/utils/findLatestAppliedFontTheme'
import type { ActiveColorSchemeSuggest } from '@/app/[market]/develop/components/utils/findLatestColorSchemeSuggest'
import type { ActiveFontThemeSuggest } from '@/app/[market]/develop/components/utils/findLatestFontThemeSuggest'
import { previewFontInIframe } from '@/app/[market]/develop/components/utils/previewFontInIframe'
import { previewThemeInIframe } from '@/app/[market]/develop/components/utils/previewThemeInIframe'
import { useNextActions } from '@/app/[market]/develop/hooks/useNextActions'
import { useRebuildPages } from '@/app/[market]/develop/hooks/useRebuildPages'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { todoListService } from '@/services/TodoListService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useIsActivelyStreaming, useIsLoading, useMessages } from '@/stores/useStreamingConversationStore'
import type { TodoItem, TodoList } from '@/stores/useTodoListStore'
import { useCurrentList, useTodoListStore, useViewState } from '@/stores/useTodoListStore'

const MAX_COMBINED_ITEMS = 4


/**
 * InputActionsPanel
 *
 * Unified "Up next" panel rendered at the top of the chat input card.
 * Combines Next Best Actions (NBAs) and Plan/Todo list into one experience.
 *
 * Modes:
 * - Nothing to show → returns null (UI unchanged)
 * - Agent idle + data → "Up next" list (max 4 items) with "View plan" expand
 * - Agent working → compact "thinking..." row with plan count expand
 */
type InputActionsPanelProps = {
  activeColorSchemeSuggest?: ActiveColorSchemeSuggest | null
  activeFontThemeSuggest?: ActiveFontThemeSuggest | null
}

function isAskQuestionToolResult(toolResult: unknown): boolean {
  if (!toolResult || typeof toolResult !== 'object') return false

  const resultObj = toolResult as { output?: unknown; widgetData?: unknown }
  const output = resultObj.output && typeof resultObj.output === 'object' ? resultObj.output : resultObj
  const outputObj = output as { widgetData?: unknown }
  const widgetData = outputObj.widgetData
  const questions = (widgetData as { questions?: unknown } | undefined)?.questions

  return !!(
    widgetData &&
    typeof widgetData === 'object' &&
    Array.isArray(questions) &&
    questions.length > 0
  )
}

function isAskQuestionNBA(nbaData: ReturnType<typeof useLatestNBAs>): boolean {
  return nbaData?.source === 'askQuestion' || isAskQuestionToolResult(nbaData?.toolResult)
}


/** @deprecated Remove when `airo-builder-theme-selection-chat` is permanently on */
function InputActionsPanelLegacy() {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const nbaData = useLatestNBAs()
  const currentList = useCurrentList()
  const viewState = useViewState()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  const [fullPlanExpanded, setFullPlanExpanded] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [otherValue, setOtherValue] = useState('')

  const items = currentList?.items ?? []
  const uncompletedItems = items.filter(item => !item.completed)
  const completedItems = items.filter(item => item.completed)
  const hasPlan = !!currentList && items.length > 0
  const totalItems = items.length
  const completedCount = completedItems.length

  // NBAs are only shown when agent is idle
  const hasNBAs = !isProcessing && !!nbaData && nbaData.suggestions.length > 0

  // Client-side dedup: strip NBAs that overlap with uncompleted plan items.
  // The agent prompt discourages this, but older responses or edge cases can
  // still produce duplicates like "Build the about page" ≈ "About page".
  const dedupedNBASuggestions = hasNBAs
    ? nbaData!.suggestions.filter(suggestion => {
        const nbaText = suggestion.text.toLowerCase()
        return !uncompletedItems.some(item => {
          const planText = item.title.toLowerCase()
          // Match if one contains the other, or they share the same key words
          return nbaText.includes(planText) || planText.includes(nbaText)
        })
      })
    : []

  // Build combined "Up next" list (max 4 items):
  // - Always reserve at least 1 slot for a plan item if a plan exists
  // - NBAs fill first; plan items fill the rest
  // When expanded, plan preview items disappear and the full plan section takes over.
  const maxNBASlots = hasPlan ? MAX_COMBINED_ITEMS - 1 : MAX_COMBINED_ITEMS
  const nbaSuggestions = dedupedNBASuggestions.slice(0, maxNBASlots)
  const remainingSlots = MAX_COMBINED_ITEMS - nbaSuggestions.length
  const planPreviewItems = uncompletedItems.slice(0, remainingSlots)

  const hasCombinedItems = nbaSuggestions.length > 0 || planPreviewItems.length > 0

  // Track which list ID we last auto-revealed, so a new list triggers again.
  const revealedListIdRef = useRef<string | null>(currentList?.id ?? null)
  // Track whether the current expansion was triggered by us (auto) so we know
  // whether to auto-collapse. If the user opened it manually, leave it alone.
  const autoExpandedRef = useRef(false)
  // Ref-based timer so it survives effect re-runs without being cleared
  const autoCollapseTimerRef = useRef<NodeJS.Timeout | null>(null)

  function startAutoCollapseTimer() {
    if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current)
    autoCollapseTimerRef.current = setTimeout(() => {
      if (autoExpandedRef.current) {
        setFullPlanExpanded(false)
        autoExpandedRef.current = false
      }
      autoCollapseTimerRef.current = null
    }, 5000)
  }

  // Clean up auto-collapse timer on unmount only
  useEffect(() => {
    return () => {
      if (autoCollapseTimerRef.current) {
        clearTimeout(autoCollapseTimerRef.current)
      }
    }
  }, [])

  // Collapse full plan when agent starts working — but not if we just
  // auto-revealed a new list (let the 5s timer handle that instead).
  useEffect(() => {
    if (isProcessing && !autoExpandedRef.current) {
      setFullPlanExpanded(false)
    }
  }, [isProcessing])

  // Auto-expand plan when first created (new list ID) or when an item is
  // checked off (viewState === 'update'). Auto-collapse after 5s.
  // First null→id transition (async load on mount) sets baseline without expanding.
  const currentListId = currentList?.id ?? null

  useEffect(() => {
    if (!hasPlan) return

    if (revealedListIdRef.current === null) {
      revealedListIdRef.current = currentListId
      return
    }

    const isNewList = currentListId !== revealedListIdRef.current
    const isItemUpdate = viewState === 'update'
    if (!isNewList && !isItemUpdate) return

    revealedListIdRef.current = currentListId

    // If already open by user, leave it — don't auto-collapse
    if (fullPlanExpanded && !autoExpandedRef.current) return

    // Open it and start auto-collapse timer.
    // startAutoCollapseTimer() clears any prior timer, so no cleanup needed here.
    autoExpandedRef.current = true
    setFullPlanExpanded(true)
    startAutoCollapseTimer()

  }, [viewState, hasPlan, currentListId])

  // When all items in the current list are completed, auto-switch to another
  // list that has undone items. If none exist, keep the completed list showing.
  const allCompleted = hasPlan && uncompletedItems.length === 0
  const lastCompletedListIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!allCompleted || !currentList?.appId) {
      // Reset when switching away from a completed list
      if (!allCompleted) lastCompletedListIdRef.current = null
      return
    }
    // Only check once per completed list
    if (lastCompletedListIdRef.current === currentList.id) return
    lastCompletedListIdRef.current = currentList.id

    const appId = currentList.appId
    const completedListId = currentList.id
    async function switchToIncompleteList() {
      try {
        const allLists = await todoListService.getAllLists(appId)
        const listWithUndone = allLists.find(
          list => list.id !== completedListId && list.items?.some(item => !item.completed)
        )
        if (listWithUndone) {
          // Guard: if user navigated to a different app while fetch was in-flight, bail
          const currentStoreList = useTodoListStore.getState().currentList
          if (currentStoreList?.appId !== appId) return

          // Reset revealed ref so the new list triggers an auto-reveal
          revealedListIdRef.current = null
          useTodoListStore.getState().setCurrentList(listWithUndone)
          logger.debug('input-actions-panel.auto-switch-list', {
            fromListId: completedListId,
            toListId: listWithUndone.id,
            toListName: listWithUndone.name,
          })
        }
        // If no list with undone items, keep current (completed) list
      } catch (error) {
        logger.warn('input-actions-panel.auto-switch-list-failed', {
          appId,
          completedListId,
          error,
        })
      }
    }
    switchToIncompleteList()
  }, [allCompleted, currentListId])

  function handleSuggestionClick(suggestion: { text: string; value?: string }) {
    if (isProcessing || !sendUserMessage) return
    const messageText = suggestion.value || suggestion.text
    sendUserMessage(messageText, { isActionRequest: true })
    setOtherValue('')
  }

  function handleOtherSubmit() {
    if (isProcessing || !sendUserMessage || !otherValue.trim()) return
    sendUserMessage(otherValue.trim(), { isActionRequest: true })
    setOtherValue('')
  }

  function handleOtherKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      handleOtherSubmit()
    }
  }

  const showOtherInput = nbaData?.source === 'askQuestion' && nbaData?.allowOther
  const isAskQuestionActive = isAskQuestionNBA(nbaData) && !!nbaData?.toolResult

  useNumberKeySelection({
    itemCount: isAskQuestionActive ? 0 : nbaSuggestions.length,
    disabled: isProcessing,
    onSelect: useCallback((index: number) => {
      if (!sendUserMessage || index >= nbaSuggestions.length) return
      const suggestion = nbaSuggestions[index]
      sendUserMessage(suggestion.value || suggestion.text, { isActionRequest: true })
      setOtherValue('')
    }, [nbaSuggestions, sendUserMessage]),
  })

  function handlePlanItemClick(item: TodoItem) {
    if (isProcessing || !sendUserMessage) return

    sendUserMessage(item.title, {
      isActionRequest: true,
      customContext: {
        type: 'plan_item',
        data: {
          action: 'execute',
          itemId: item.id,
          listId: item.listId,
          title: item.title,
          description: item.description || null,
          steps: [
            `Execute the work for "${item.title}". Do not ask for clarification — build or implement it now.`,
            item.description ? `Use these details: ${item.description}` : null,
            `When done, call todoList({ operation: 'mark_done', itemIds: ['${item.id}'] })`,
            'If the work is already done (page/feature exists), verify and call mark_done immediately.',
            'If ALL items in the list are now complete, call todoList({ operation: \'list_all\' }) then todoList({ operation: \'select_list\', listId: \'<id>\' }) to switch to the next incomplete list.',
          ].filter(Boolean),
        },
        persistence: 'ephemeral',
        source: 'plan-item',
      },
    })
  }

  // ── Mode C: Agent working ────────────────────────────────────────────────
  if (isProcessing) {
    return (
      <>
        <div className="flex items-center justify-between px-1 py-0.5 mb-1 min-h-[22px]">
          <ThinkingIndicator active={true} inline={true} />
          {hasPlan && !fullPlanExpanded && (
            <button
              type="button"
              className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-2"
              onClick={() => setFullPlanExpanded(true)}
            >
              <span>{t('builder_todo_view_plan', { completed: completedCount, total: totalItems })}</span>
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
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {hasPlan && fullPlanExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              {/* Separator between thinking row and expanded plan */}
              <div className="-mx-1.5 border-b border-border mb-1" />
              <FullPlanSection
                list={currentList}
                completedItems={completedItems}
                uncompletedItems={uncompletedItems}
                completedCount={completedCount}
                totalItems={totalItems}
                isProcessing={isProcessing}
                onItemClick={handlePlanItemClick}
                onOpenModal={() => setIsModalOpen(true)}
                onCollapse={() => setFullPlanExpanded(false)}
                t={t}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Separator between panel and input content */}
        <div className="-mx-1.5 border-b border-border mb-1" />

        <TodoListModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          list={currentList}
          t={t}
        />
      </>
    )
  }

  // ── Mode A: Agent idle, nothing to show ──────────────────────────────────
  if (!hasCombinedItems && !hasPlan) {
    return null
  }

  // ── Mode B: Agent idle, has data ─────────────────────────────────────────
  return (
    <>
      <div className="flex flex-col gap-0.5 mb-1">
        {/* When no NBAs: single row with "Continue building" on left + "View plan" on right.
            When NBAs present: header question above, NBAs, then "View plan" as separator.
            When expanded with no NBAs: hide header since plan name serves as heading. */}
        {nbaSuggestions.length === 0 && hasPlan ? (
          // Plan-only: combined row (hidden when expanded — plan name takes over)
          !fullPlanExpanded && (
            <div className="flex items-center justify-between px-1 py-0.5">
              <span className="text-sm font-medium text-muted-foreground">{t('builder_todo_continue_building')}</span>
              <button
                type="button"
                className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setFullPlanExpanded(prev => !prev)}
              >
                <PlanToggleLabel
                  completedCount={completedCount}
                  totalItems={totalItems}
                  fullPlanExpanded={fullPlanExpanded}
                  viewState={viewState}
                  t={t}
                />
              </button>
            </div>
          )
        ) : (
          // NBAs present: header + NBA buttons + "View plan" separator
          <>
            {!(fullPlanExpanded && nbaSuggestions.length === 0) && (
              <div className="px-1 py-0.5 text-sm font-medium text-muted-foreground text-left">
                {nbaSuggestions.length > 0 && nbaData?.question ? nbaData.question : t('builder_todo_continue_building')}
              </div>
            )}

            {nbaSuggestions.map((suggestion, index) => (
              <OptionButton
                key={`nba-${index}`}
                text={suggestion.text}
                disabled={isProcessing}
                onClick={() => handleSuggestionClick(suggestion)}
                animationDelay={index * 0.1}
                isSelectable={true}
                keyboardShortcut={index + 1}
              />
            ))}

            {showOtherInput && (
              <OptionInput
                value={otherValue}
                disabled={isProcessing}
                placeholder={t('builder_tools_askquestion_other_placeholder')}
                ariaLabel={t('builder_tools_askquestion_other_aria_label')}
                submitLabel={t('builder_common_submit')}
                onChange={setOtherValue}
                onSubmit={handleOtherSubmit}
                onKeyDown={handleOtherKeyDown}
                keyboardShortcut={nbaSuggestions.length + 1}
              />
            )}

            {!isAskQuestionActive && nbaSuggestions.length === 0 && hasPlan && !fullPlanExpanded && (
              <div className="flex items-center justify-end px-1 py-0.5">
                <button
                  type="button"
                  className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setFullPlanExpanded(true)}
                >
                  <PlanToggleLabel
                    completedCount={completedCount}
                    totalItems={totalItems}
                    fullPlanExpanded={false}
                    viewState={viewState}
                    t={t}
                  />
                </button>
              </div>
            )}
          </>
        )}

        {/* Collapsed: plan preview items; hidden when expanded or when NBAs are active */}
        {!isAskQuestionActive && nbaSuggestions.length === 0 && !fullPlanExpanded && planPreviewItems.map((item, index) => (
          <OptionButton
            key={item.id}
            text={item.title}
            disabled={isProcessing}
            onClick={() => handlePlanItemClick(item)}
            animationDelay={(nbaSuggestions.length + index) * 0.1}
            isSelectable={true}
          />
        ))}

        {/* Expanded: full plan section replaces preview items */}
        <AnimatePresence initial={false}>
          {hasPlan && fullPlanExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <FullPlanSection
                list={currentList}
                completedItems={completedItems}
                uncompletedItems={uncompletedItems}
                completedCount={completedCount}
                totalItems={totalItems}
                isProcessing={isProcessing}
                onItemClick={handlePlanItemClick}
                onOpenModal={() => setIsModalOpen(true)}
                onCollapse={() => setFullPlanExpanded(false)}
                t={t}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Separator between panel and input content */}
      <div className="-mx-1.5 border-b border-border mb-1" />

      <TodoListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        list={currentList}
        t={t}
      />
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * Shared label content for the "View plan (X/Y)" toggle button
 */
function PlanToggleLabel({
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

/**
 * Plan-sourced OptionButton with a list icon on the right to distinguish from NBAs
 */
type PlanOptionsListOrientation = 'vertical' | 'horizontal'

function PlanOptionsList({
  items,
  disabled,
  onItemClick,
  orientation = 'vertical',
  maxKeyboardShortcuts = 4,
  animationIndexOffset = 0,
}: {
  items: TodoItem[]
  disabled: boolean
  onItemClick: (item: TodoItem) => void
  orientation?: PlanOptionsListOrientation
  maxKeyboardShortcuts?: number
  animationIndexOffset?: number
}) {
  const isHorizontal = orientation === 'horizontal'

  return (
    <div
      className={
        isHorizontal
          ? 'flex flex-row gap-1.5 overflow-x-auto p-1.5 rounded-md'
          : 'flex flex-col gap-1'
      }
    >
      {items.map((item, index) => (
        <OptionButton
          key={item.id}
          text={item.title}
          disabled={disabled}
          onClick={() => onItemClick(item)}
          animationDelay={(animationIndexOffset + index) * 0.1}
          keyboardShortcut={index < maxKeyboardShortcuts ? index + 1 : undefined}
          compact={isHorizontal}
          isSelectable={true}
        />
      ))}
    </div>
  )
}


/**
 * Circular checkbox for completed items
 */
function CircularCheckbox({ checked }: { checked: boolean }) {
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
function FullPlanSection({
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
            {/* Uncompleted items — actionable, with plan icon */}
            {uncompletedItems.map((item, index) => (
              <OptionButton
                key={item.id}
                text={item.title}
                disabled={isProcessing}
                onClick={() => onItemClick(item)}
                animationDelay={index * 0.05}
                isSelectable={true}
              />
            ))}
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
function TodoListModal({
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

function InputActionsPanelThemeSelection({
  activeColorSchemeSuggest = null,
  activeFontThemeSuggest = null,
}: InputActionsPanelProps) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const sendUserMessage = useSendUserMessage()
  const nbaData = useLatestNBAs()
  const currentList = useCurrentList()
  const viewState = useViewState()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const messages = useMessages()
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const appId = useAppIdFromParams()
  const isMobile = useIsMobile()
  const mayBeRebuildApp = useMemo(() =>
    messages.some(msg =>
      msg.role === 'assistant' &&
      msg.toolCalls?.some(tc =>
        tc.name === 'rebuildPageSelector' || tc.name === 'websiteScraper'
      )
    ),
    [messages]
  )
  const { data: rebuildPagesData, isError: isRebuildError, error: rebuildError } = useRebuildPages(appId, mayBeRebuildApp)
  if (isRebuildError) logger.warn('input-actions-panel.rebuild-pages-error', { appId }, { error: rebuildError as Error })
  const hasRebuildPages = rebuildPagesData?.availablePages?.some(p => !p.isBuilt) ?? false

  const items = currentList?.items ?? []
  const uncompletedItems = useMemo(() => items.filter(item => !item.completed), [items])
  const completedItems = useMemo(() => items.filter(item => item.completed), [items])
  const hasPendingPlanItems = uncompletedItems.length > 0

  const hasNoBAs = !nbaData || nbaData.suggestions.length === 0
  const hasConversationHistory = messages.length > 0
  const { data: nextActionsData, isError: isNextActionsError, error: nextActionsError } = useNextActions(appId, hasNoBAs && !isProcessing && hasConversationHistory && !hasPendingPlanItems)
  if (isNextActionsError) logger.warn('input-actions-panel.next-actions-error', { appId }, { error: nextActionsError as Error })
  const nextActionSuggestions = nextActionsData?.suggestions ?? []

  // Get the currently applied theme to prepend to suggestions
  const currentAppliedTheme = useMemo(() => findLatestAppliedColorScheme(messages), [messages])
  const currentAppliedFont = useMemo(() => findLatestAppliedFontTheme(messages), [messages])

  const [fullPlanExpanded, setFullPlanExpanded] = useState(false)
  const [continueBuildingExpanded, setContinueBuildingExpanded] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [dismissedColorSuggestId, setDismissedColorSuggestId] = useState<string | null>(null)
  const [dismissedFontSuggestId, setDismissedFontSuggestId] = useState<string | null>(null)
  const [selectedThemeIndex, setSelectedThemeIndex] = useState<number>(0)
  const [selectedFontIndex, setSelectedFontIndex] = useState<number>(0)
  const [askQuestionCompleted, setAskQuestionCompleted] = useState(false)
  const [currentAskQuestionText, setCurrentAskQuestionText] = useState<string | null>(null)
  useEffect(() => { setAskQuestionCompleted(false); setCurrentAskQuestionText(null) }, [nbaData?.toolResult])
  const hasPlan = !!currentList && items.length > 0
  const totalItems = items.length
  const completedCount = completedItems.length

  // NBAs are only shown when agent is idle
  const hasNBAs = !isProcessing && !!nbaData && nbaData.suggestions.length > 0

  // Client-side dedup: strip NBAs that overlap with uncompleted plan items.
  // The agent prompt discourages this, but older responses or edge cases can
  // still produce duplicates like "Build the about page" ≈ "About page".
  const dedupedNBASuggestions = hasNBAs
    ? nbaData!.suggestions.filter(suggestion => {
        const nbaText = suggestion.text.toLowerCase()
        return !uncompletedItems.some(item => {
          const planText = item.title.toLowerCase()
          // Match if one contains the other, or they share the same key words
          return nbaText.includes(planText) || planText.includes(nbaText)
        })
      })
    : []

  // Build combined "Up next" list (max 4 items):
  // - Always reserve at least 1 slot for a plan item if a plan exists
  // - NBAs fill first; plan items fill the rest
  // When expanded, plan preview items disappear and the full plan section takes over.
  const maxNBASlots = hasPlan ? MAX_COMBINED_ITEMS - 1 : MAX_COMBINED_ITEMS
  const nbaSuggestions = dedupedNBASuggestions.slice(0, maxNBASlots)
  const remainingSlots = MAX_COMBINED_ITEMS - nbaSuggestions.length
  const planPreviewItems = useMemo(
    () => uncompletedItems.slice(0, remainingSlots),
    [uncompletedItems, remainingSlots]
  )

  const hasNextActions = nextActionSuggestions.length > 0
  const hasCombinedItems = nbaSuggestions.length > 0 || planPreviewItems.length > 0 || hasNextActions
  const showColor = Boolean(activeColorSchemeSuggest) && dismissedColorSuggestId !== activeColorSchemeSuggest?.toolCallId
  const showFont = Boolean(activeFontThemeSuggest) && dismissedFontSuggestId !== activeFontThemeSuggest?.toolCallId
  const showAnySuggest = showColor || showFont
  const isPreviewMode = viewMode === ViewMode.PREVIEW || viewMode === ViewMode.EDIT
  const isAskQuestionActive = isAskQuestionNBA(nbaData) && !!nbaData?.toolResult && !askQuestionCompleted

  // Prepend the current applied theme to the suggestions if it exists, filtering duplicates by name
  const palettesWithCurrent = useMemo(
    () =>
      activeColorSchemeSuggest && currentAppliedTheme
        ? [currentAppliedTheme, ...activeColorSchemeSuggest.palettes].filter(
            (palette, index, arr) => arr.findIndex(p => p.name === palette.name) === index
          )
        : activeColorSchemeSuggest?.palettes ?? [],
    [activeColorSchemeSuggest, currentAppliedTheme]
  )

  // Prepend the current applied font theme to the suggestions if it exists, filtering duplicates by font names
  const themesWithCurrent = useMemo(
    () =>
      activeFontThemeSuggest && currentAppliedFont
        ? [currentAppliedFont, ...activeFontThemeSuggest.themes].filter(
            (theme, index, arr) =>
              arr.findIndex(
                t =>
                  t.headerFont.name === theme.headerFont.name &&
                  t.bodyFont.name === theme.bodyFont.name
              ) === index
          )
        : activeFontThemeSuggest?.themes ?? [],
    [activeFontThemeSuggest, currentAppliedFont]
  )

  // Auto-open "Continue Building" when content is available (including askQuestion NBAs e.g. post-publish pre-launch)
  useEffect(() => {
    if (hasCombinedItems || hasPlan || showAnySuggest || hasRebuildPages || isAskQuestionActive) {
      setContinueBuildingExpanded(true)
    }
  }, [showAnySuggest, hasCombinedItems, hasPlan, hasRebuildPages, isAskQuestionActive])

  // Reset dismissed state and theme selection when color suggest changes
  useEffect(() => {
    if (activeColorSchemeSuggest?.toolCallId) {
      setDismissedColorSuggestId(null)
      setSelectedThemeIndex(0)
    }
  }, [activeColorSchemeSuggest?.toolCallId])

  useEffect(() => {
    if (activeFontThemeSuggest?.toolCallId) {
      setDismissedFontSuggestId(null)
      setSelectedFontIndex(0)
    }
  }, [activeFontThemeSuggest?.toolCallId])

  // Track selected theme index in a ref to avoid effect over-firing
  const selectedThemeIndexRef = useRef(selectedThemeIndex)
  useEffect(() => {
    selectedThemeIndexRef.current = selectedThemeIndex
  }, [selectedThemeIndex])

  // Handle theme selection when switching view modes
  useEffect(() => {
    // If switching TO Brand Book mode (which resets the iframe), reset selection
    if (viewMode === ViewMode.BRAND) {
      setSelectedThemeIndex(0)
    }

    // If in preview/edit mode and have a selection, apply it
    if (isPreviewMode && selectedThemeIndexRef.current > 0 && palettesWithCurrent[selectedThemeIndexRef.current]) {
      const palette = palettesWithCurrent[selectedThemeIndexRef.current]
      previewThemeInIframe(palette.name, palette.palette)
    }
  }, [viewMode, palettesWithCurrent, isPreviewMode])

  const selectedFontIndexRef = useRef(selectedFontIndex)
  useEffect(() => {
    selectedFontIndexRef.current = selectedFontIndex
  }, [selectedFontIndex])

  // Handle font theme selection when switching view modes
  useEffect(() => {
    if (viewMode === ViewMode.BRAND) {
      setSelectedFontIndex(0)
    }
    if (!isPreviewMode || selectedFontIndexRef.current === 0) return
    const th = themesWithCurrent[selectedFontIndexRef.current]
    if (th) {
      previewFontInIframe({ bodyFont: th.bodyFont, headerFont: th.headerFont })
    }
  }, [viewMode, themesWithCurrent, isPreviewMode])

  // Track which list ID we last auto-revealed, so a new list triggers again.
  const revealedListIdRef = useRef<string | null>(currentList?.id ?? null)
  // Track whether the current expansion was triggered by us (auto) so we know
  // whether to auto-collapse. If the user opened it manually, leave it alone.
  const autoExpandedRef = useRef(false)
  // Ref-based timer so it survives effect re-runs without being cleared
  const autoCollapseTimerRef = useRef<NodeJS.Timeout | null>(null)
  // Ref to track fullPlanExpanded state without triggering effect re-runs
  const fullPlanExpandedRef = useRef(fullPlanExpanded)

  // Keep fullPlanExpandedRef in sync with state
  useEffect(() => {
    fullPlanExpandedRef.current = fullPlanExpanded
  }, [fullPlanExpanded])

  // Clean up auto-collapse timer on unmount only
  useEffect(() => {
    return () => {
      if (autoCollapseTimerRef.current) {
        clearTimeout(autoCollapseTimerRef.current)
      }
    }
  }, [])

  function startAutoCollapseTimer() {
    if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current)
    autoCollapseTimerRef.current = setTimeout(() => {
      if (autoExpandedRef.current) {
        setFullPlanExpanded(false)
        autoExpandedRef.current = false
      }
      autoCollapseTimerRef.current = null
    }, 5000)
  }

  // Collapse full plan when agent starts working — but not if we just
  // auto-revealed a new list (let the 5s timer handle that instead).
  useEffect(() => {
    if (isProcessing && !autoExpandedRef.current) {
      setFullPlanExpanded(false)
    }
  }, [isProcessing])

  // Auto-expand plan when first created (new list ID) or when an item is
  // checked off (viewState === 'update'). Auto-collapse after 5s.
  // First null→id transition (async load on mount) sets baseline without expanding.
  const currentListId = currentList?.id ?? null

  useEffect(() => {
    if (!hasPlan) return

    // Don't auto-expand plan when there's an active color or font suggestion panel
    if (activeColorSchemeSuggest || activeFontThemeSuggest) {
      // Only collapse if it was auto-expanded, don't touch user-opened plans
      if (autoExpandedRef.current && fullPlanExpandedRef.current) {
        setFullPlanExpanded(false)
        autoExpandedRef.current = false
      }
      return
    }

    if (revealedListIdRef.current === null) {
      revealedListIdRef.current = currentListId
      return
    }

    const isNewList = currentListId !== revealedListIdRef.current
    const isItemUpdate = viewState === 'update'
    // Trigger on: new list (even during processing), or item checked off (even during processing)
    if (!isNewList && !isItemUpdate) return

    revealedListIdRef.current = currentListId

    // If already open by user, leave it — don't auto-collapse
    if (fullPlanExpandedRef.current && !autoExpandedRef.current) return

    // Open it and start auto-collapse timer
    autoExpandedRef.current = true
    setFullPlanExpanded(true)
    startAutoCollapseTimer()
  }, [activeColorSchemeSuggest, activeFontThemeSuggest, viewState, hasPlan, isProcessing, currentListId])

  // When all items in the current list are completed, auto-switch to another
  // list that has undone items. If none exist, keep the completed list showing.
  const allCompleted = hasPlan && uncompletedItems.length === 0
  const lastCompletedListIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!allCompleted || !currentList?.appId) {
      // Reset when switching away from a completed list
      if (!allCompleted) lastCompletedListIdRef.current = null
      return
    }
    // Only check once per completed list
    if (lastCompletedListIdRef.current === currentList.id) return
    lastCompletedListIdRef.current = currentList.id

    const appId = currentList.appId
    const completedListId = currentList.id
    async function switchToIncompleteList() {
      try {
        const allLists = await todoListService.getAllLists(appId)
        const listWithUndone = allLists.find(
          list => list.id !== completedListId && list.items?.some(item => !item.completed)
        )
        if (listWithUndone) {
          // Guard: if user navigated to a different app while fetch was in-flight, bail
          const currentStoreList = useTodoListStore.getState().currentList
          if (currentStoreList?.appId !== appId) return

          // Reset revealed ref so the new list triggers an auto-reveal
          revealedListIdRef.current = null
          useTodoListStore.getState().setCurrentList(listWithUndone)
          logger.debug('input-actions-panel.auto-switch-list', {
            fromListId: completedListId,
            toListId: listWithUndone.id,
            toListName: listWithUndone.name,
          })
        }
        // If no list with undone items, keep current (completed) list
      } catch (error) {
        logger.warn('input-actions-panel-theme-selection.auto-switch-list-failed', {
          appId,
          completedListId,
          error,
        })
      }
    }
    switchToIncompleteList()
  }, [allCompleted, currentListId])

  function handleSuggestionClick(suggestion: { text: string; value?: string } | string) {
    if (isProcessing || !sendUserMessage) return
    const text = typeof suggestion === 'string' ? suggestion : (suggestion.value || suggestion.text)
    queryClient.removeQueries({ queryKey: ['next-actions', appId] })
    sendUserMessage(text, { isActionRequest: true })
  }

  // Keyboard shortcuts: press 1-4 to select plan items or NBA suggestions
  const MAX_KEYBOARD_SHORTCUTS = 4
  const keyboardEnabledItems = useMemo(
    () => planPreviewItems.slice(0, MAX_KEYBOARD_SHORTCUTS),
    [planPreviewItems]
  )

  const handlePlanItemClickCallback = useCallback(
    (item: TodoItem) => {
      if (isProcessing || !sendUserMessage) return

      sendUserMessage(item.title, {
        isActionRequest: true,
        customContext: {
          type: 'plan_item',
          data: {
            action: 'execute',
            itemId: item.id,
            listId: item.listId,
            title: item.title,
            description: item.description || null,
            steps: [
              `Execute the work for "${item.title}". Do not ask for clarification — build or implement it now.`,
              item.description ? `Use these details: ${item.description}` : null,
              `When done, call todoList({ operation: 'mark_done', itemIds: ['${item.id}'] })`,
              'If the work is already done (page/feature exists), verify and call mark_done immediately.',
              'If ALL items in the list are now complete, call todoList({ operation: \'list_all\' }) then todoList({ operation: \'select_list\', listId: \'<id>\' }) to switch to the next incomplete list.',
            ].filter(Boolean),
          },
          persistence: 'ephemeral',
          source: 'plan-item',
        },
      })
    },
    [isProcessing, sendUserMessage]
  )

  const nbaSuggestionsRef = useRef(nbaSuggestions)
  nbaSuggestionsRef.current = nbaSuggestions

  useEffect(() => {
    if (isProcessing || isModalOpen || showColor || isAskQuestionActive) return

    const hasNBAShortcuts = nbaSuggestions.length > 0
    const itemCount = hasNBAShortcuts ? Math.min(nbaSuggestions.length, MAX_KEYBOARD_SHORTCUTS) : keyboardEnabledItems.length
    if (itemCount === 0) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const activeEl = document.activeElement as HTMLElement | null
      if (activeEl) {
        const tagName = activeEl.tagName
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          activeEl.isContentEditable ||
          activeEl.closest?.('[contenteditable="true"]')
        ) {
          return
        }
      }

      const keyNum = parseInt(e.key, 10)
      if (isNaN(keyNum) || keyNum < 1 || keyNum > itemCount) return

      e.preventDefault()
      if (hasNBAShortcuts) {
        const suggestion = nbaSuggestionsRef.current[keyNum - 1]
        if (!suggestion) return
        const text = suggestion.value || suggestion.text
        queryClient.removeQueries({ queryKey: ['next-actions', appId] })
        sendUserMessage(text, { isActionRequest: true })
      } else {
        handlePlanItemClickCallback(keyboardEnabledItems[keyNum - 1])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isProcessing, isModalOpen, showColor, isAskQuestionActive, keyboardEnabledItems, handlePlanItemClickCallback, nbaSuggestions.length, queryClient, appId, sendUserMessage])

  function handleColorCancel() {
    if (activeColorSchemeSuggest) {
      setDismissedColorSuggestId(activeColorSchemeSuggest.toolCallId)
    }
    setSelectedThemeIndex(0)
  }

  function handleFontCancel() {
    if (activeFontThemeSuggest) {
      setDismissedFontSuggestId(activeFontThemeSuggest.toolCallId)
    }
    setSelectedFontIndex(0)
  }


  // ── Mode C: Agent working ────────────────────────────────────────────────
  if (isProcessing) {
    return (
      <>

        {/* Thinking indicator with optional plan toggle (hide plan when applying theme) */}
        <div className="flex items-center justify-between px-1 py-0.5 mb-1 min-h-[22px]">
          <ThinkingIndicator active={true} inline={true} />
          {hasPlan && !showAnySuggest && (
            <button
              type="button"
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-2"
              onClick={() => {
                setFullPlanExpanded(v => !v)
                autoExpandedRef.current = false
              }}
            >
              <span>{currentList.name}</span>
              <CollapseChevron expanded={fullPlanExpanded} />
            </button>
          )}
        </div>

        {/* Nested plan details when expanded (hide when applying theme) */}
        <AnimatePresence initial={false}>
          {hasPlan && fullPlanExpanded && !showAnySuggest && (
            <motion.div
              key="full-plan-processing"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden mb-1"
            >
              <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5 px-1">
                {[...completedItems, ...uncompletedItems].length > 0 ? (
                  <>
                    {completedItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg"
                      >
                        <CircularCheckbox checked />
                        <span className="text-sm line-through text-muted-foreground truncate">{item.title}</span>
                      </div>
                    ))}
                    {uncompletedItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg opacity-50"
                      >
                        <CircularCheckbox checked={false} />
                        <span className="text-sm text-muted-foreground truncate">{item.title}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-1">
                    {t('builder_common_todo_no_items')}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="-mx-1.5 border-b border-border mb-1" />

        <TodoListModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          list={currentList}
          t={t}
        />
      </>
    )
  }

  // ── Mode A: Agent idle, nothing to show ──────────────────────────────────
  if (!hasCombinedItems && !hasPlan && !showAnySuggest && !hasRebuildPages) {
    return null
  }

  const continueBuildingTitleText = showColor
    ? t('builder_theme_preview_panel_title', undefined, 'Choose a color scheme')
    : showFont
      ? `${t('builder_tools_font_theme', undefined, 'Font Theme')}: ${t('builder_tools_font_theme_options', undefined, 'Options')}`
      : nbaSuggestions.length > 0 && nbaData?.question
      ? nbaData.question
      : t('builder_todo_continue_building')

  const continueBuildingTitle = continueBuildingTitleText

  const progressButton = hasPlan && !showColor ? (
    <button
      type="button"
      className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        setIsModalOpen(true)
      }}
      aria-label={t('builder_todo_view_plan', { completed: completedCount, total: totalItems })}
    >
      ({completedCount}/{totalItems})
    </button>
  ) : null

  const continueBuildingTodoBody = (
    <div className="flex flex-col gap-1 my-1">
      {isAskQuestionActive ? (
        <AskQuestionToolRenderer
          toolName="askQuestion"
          toolStatus="completed"
          result={nbaData.toolResult as Record<string, unknown>}
          isLastAssistantMessage={true}
          onComplete={() => setAskQuestionCompleted(true)}
          onQuestionChange={setCurrentAskQuestionText}
          hideQuestion={true}
        />
      ) : nbaSuggestions.length > 0 ? (
        nbaSuggestions.map((suggestion, index) => (
          <OptionButton
            key={`nba-${index}`}
            text={suggestion.text}
            disabled={isProcessing}
            onClick={() => handleSuggestionClick(suggestion)}
            animationDelay={index * 0.1}
            isSelectable={true}
            keyboardShortcut={index + 1}
          />
        ))
      ) : !hasPendingPlanItems ? (
        nextActionSuggestions.map((suggestion, index) => (
          <OptionButton
            key={`next-${index}`}
            text={suggestion.text}
            disabled={isProcessing}
            onClick={() => handleSuggestionClick(suggestion.text)}
            animationDelay={index * 0.1}
            isSelectable={true}
            keyboardShortcut={index + 1}
          />
        ))
      ) : null}

      {hasRebuildPages && rebuildPagesData && nbaData?.source !== 'askQuestion' && (
        <RebuildPageSelectorToolRenderer
          toolName="rebuildPageSelector"
          toolStatus="completed"
          result={{ widget: { widgetType: 'rebuild-page-selector', widgetData: { appId: appId!, ...rebuildPagesData } } }}
          isLastAssistantMessage={true}
          size="small"
        />
      )}

      {!isAskQuestionActive && nbaSuggestions.length === 0 && planPreviewItems.length > 0 && (
        <PlanOptionsList
          items={planPreviewItems}
          disabled={isProcessing}
          onItemClick={handlePlanItemClickCallback}
          orientation={isMobile ? 'horizontal' : 'vertical'}
          maxKeyboardShortcuts={MAX_KEYBOARD_SHORTCUTS}
        />
      )}
    </div>
  )

  // ── Mode B: Agent idle, has data ─────────────────────────────────────────
  return (
    <>
      {(hasCombinedItems || hasPlan || showAnySuggest || hasRebuildPages) && (
        <>
          {showColor && activeColorSchemeSuggest ? (
            <ThemePreviewInputPanel
              key={activeColorSchemeSuggest.toolCallId}
              toolCallId={activeColorSchemeSuggest.toolCallId}
              palettes={palettesWithCurrent}
              onCancel={handleColorCancel}
              selectedIndex={selectedThemeIndex}
              onSelectedIndexChange={setSelectedThemeIndex}
              disabled={!isPreviewMode}
            >
              {({ body, footer }) => (
                <CollapsibleChatInputSection
                  title={continueBuildingTitle}
                  expanded={continueBuildingExpanded}
                  onExpandedChange={setContinueBuildingExpanded}
                  footer={footer}
                >
                  {body}
                </CollapsibleChatInputSection>
              )}
            </ThemePreviewInputPanel>
          ) : showFont && activeFontThemeSuggest ? (
            <FontThemePreviewInputPanel
              key={activeFontThemeSuggest.toolCallId}
              disabled={!isPreviewMode}
              onCancel={handleFontCancel}
              selectedIndex={selectedFontIndex}
              themes={themesWithCurrent}
              toolCallId={activeFontThemeSuggest.toolCallId}
              onSelectedIndexChange={setSelectedFontIndex}
            >
              {({ body, footer }) => (
                <CollapsibleChatInputSection
                  title={continueBuildingTitle}
                  expanded={continueBuildingExpanded}
                  footer={footer}
                  onExpandedChange={setContinueBuildingExpanded}
                >
                  {body}
                </CollapsibleChatInputSection>
              )}
            </FontThemePreviewInputPanel>
          ) : isAskQuestionActive ? (
            <CollapsibleChatInputSection
              title={<span className="text-foreground">{currentAskQuestionText || nbaData.question}</span>}
              expanded={continueBuildingExpanded}
              onExpandedChange={setContinueBuildingExpanded}
            >
              {continueBuildingTodoBody}
            </CollapsibleChatInputSection>
          ) : (
            <CollapsibleChatInputSection
              title={continueBuildingTitle}
              expanded={continueBuildingExpanded}
              onExpandedChange={setContinueBuildingExpanded}
              headerRight={progressButton}
            >
              {continueBuildingTodoBody}
            </CollapsibleChatInputSection>
          )}
          <div className="-mx-1.5 mb-1 border-b border-border" />
        </>
      )}

      <TodoListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        list={currentList}
        t={t}
      />
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

export default function InputActionsPanel({
  activeColorSchemeSuggest = null,
  activeFontThemeSuggest = null,
}: InputActionsPanelProps) {
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat')
  const isFontSelectionChatEnabled = useSwitchboard('airo-builder-font-selection-chat')
  if (isThemeSelectionChatEnabled || isFontSelectionChatEnabled) {
    return (
      <InputActionsPanelThemeSelection
        activeColorSchemeSuggest={activeColorSchemeSuggest}
        activeFontThemeSuggest={activeFontThemeSuggest}
      />
    )
  }
  return <InputActionsPanelLegacy />
}
