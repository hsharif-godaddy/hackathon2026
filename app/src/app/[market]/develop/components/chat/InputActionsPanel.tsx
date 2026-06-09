'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Thinker } from '@airo-ux/pattern-library/chat/thinker'
import { ChoiceList } from '@airo-ux/pattern-library/input/choice-list'
import { ThinkingIndicator } from '@airo-ux/pattern-library/primitives/thinking-indicator'
import { useQueryClient } from '@tanstack/react-query'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import CollapsibleChatInputSection, { CollapseChevron } from '@/app/[market]/develop/components/chat/CollapsibleChatInputSection'
import FontThemePreviewInputPanel from '@/app/[market]/develop/components/chat/FontThemePreviewInputPanel'
import ThemePreviewInputPanel from '@/app/[market]/develop/components/chat/ThemePreviewInputPanel'
import ThinkingTip from '@/app/[market]/develop/components/chat/ThinkingTip'
import { useLatestNBAs } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import { useThinkerLabel } from '@/app/[market]/develop/components/chat/useThinkerLabel'
import AskQuestionToolRenderer from '@/app/[market]/develop/components/tool-renderers/AskQuestionToolRenderer'
import { parseChoiceListIndex } from '@/app/[market]/develop/components/tool-renderers/choiceListIndex'
import { focusChoiceListOptionByIndex } from '@/app/[market]/develop/components/tool-renderers/focusChoiceListOptionByIndex'
import OptionInput from '@/app/[market]/develop/components/tool-renderers/OptionInput'
import RebuildPageSelectorToolRenderer from '@/app/[market]/develop/components/tool-renderers/RebuildPageSelectorToolRenderer'
import {
  isNonChatTextEntryActive,
  shouldAllowChoiceListDigitShortcut,
} from '@/app/[market]/develop/components/tool-renderers/shortcutFocus'
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
import { unbuiltRebuildPages, useRebuildPages } from '@/app/[market]/develop/hooks/useRebuildPages'
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
  /** External trigger to collapse the panel (e.g., when chat input grows) */
  shouldCollapse?: boolean
  /**
   * When true, the active choicelist surface is hoisted up to ChatInput (via
   * {@link onChoiceSurfaceChange}) so it can be swapped INTO the PromptBox slot
   * instead of rendered inline above it. Gated by the
   * `airo-builder-chat-choice-swap` Switchboard flag. Default false →
   * byte-identical to the pre-swap behavior.
   */
  choiceSwapEnabled?: boolean
  /**
   * Reports the active choicelist surface (or null when none is active) and a
   * stable key identifying the turn, so ChatInput can render it inside the
   * PromptStage swap slot. Only fired when {@link choiceSwapEnabled}.
   */
  onChoiceSurfaceChange?: (node: ReactNode | null, surfaceKey: string | null) => void
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


/**
 * @deprecated Remove when `airo-builder-theme-selection-chat` is permanently on
 * @param shouldCollapse - Accepted but ignored. Legacy component does not implement collapse behavior.
 */
function InputActionsPanelLegacy({ shouldCollapse: _shouldCollapse }: { shouldCollapse?: boolean }) {
  const t = useTranslations()
  const thinkerLabel = useThinkerLabel()
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

  const nbaCombinedChoiceListRef = useRef<HTMLDivElement>(null)
  const focusNBAChoiceOptionByIndex = useCallback(
    (index: number) => focusChoiceListOptionByIndex(nbaCombinedChoiceListRef.current, index),
    [],
  )

  useNumberKeySelection({
    itemCount: isAskQuestionActive ? 0 : nbaSuggestions.length,
    disabled: isProcessing,
    onSelect: focusNBAChoiceOptionByIndex,
    choiceListContainerRef: nbaCombinedChoiceListRef,
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

  function handleModalPlanItemClick(item: TodoItem) {
    handlePlanItemClick(item)
    setIsModalOpen(false)
  }

  // ── Mode C: Agent working ────────────────────────────────────────────────
  if (isProcessing) {
    return (
      <>
        <div className="flex items-center justify-between px-1 py-0.5 mb-1 min-h-[22px]">
          <Thinker label={thinkerLabel} indicator={<ThinkingIndicator variant="spinner" />} />
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
        <div className="w-full px-1">
          <ThinkingTip />
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
              <div className="-mx-1 border-b border-border mb-1" />
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
        <div className="-mx-1 border-b border-border mb-1" />

        <TodoListModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          list={currentList}
          t={t}
          onItemClick={handleModalPlanItemClick}
          disabled={isProcessing}
        />
      </>
    )
  }

  // ── Mode A: Agent idle, nothing to show ──────────────────────────────────
  // Text-only askQuestion (e.g. URL prompt for rebuild) has no chip suggestions,
  // so hasCombinedItems is false — keep the panel mounted so the text input renders.
  if (!hasCombinedItems && !hasPlan && !isAskQuestionActive) {
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

            {nbaSuggestions.length > 0 && (
              <div ref={nbaCombinedChoiceListRef}>
                <ChoiceList
                  onDecision={(value) => {
                    const index = parseChoiceListIndex(value, 'input-actions-panel.nba-combined')
                    if (index === null) return
                    const s = nbaSuggestions[index]
                    if (s) handleSuggestionClick(s)
                  }}
                  ariaLabel={nbaData?.question ?? t('builder_todo_continue_building')}
                  disabled={isProcessing}
                  optionDividers
                >
                  {nbaSuggestions.map((suggestion, index) => (
                    <ChoiceList.Item key={index} value={String(index)}>
                      {suggestion.text}
                    </ChoiceList.Item>
                  ))}
                </ChoiceList>
              </div>
            )}

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
        {!isAskQuestionActive && nbaSuggestions.length === 0 && !fullPlanExpanded && planPreviewItems.length > 0 && (
          <ChoiceList
            onDecision={(value) => {
              const index = parseChoiceListIndex(value, 'input-actions-panel.plan-preview')
              if (index === null) return
              const item = planPreviewItems[index]
              if (item) handlePlanItemClick(item)
            }}
            ariaLabel={t('builder_todo_continue_building')}
            disabled={isProcessing}
            optionDividers
          >
            {planPreviewItems.map((item, index) => (
              <ChoiceList.Item key={item.id} value={String(index)}>
                {item.title}
              </ChoiceList.Item>
            ))}
          </ChoiceList>
        )}

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
      <div className="-mx-1 border-b border-border mb-1" />

      <TodoListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        list={currentList}
        t={t}
        onItemClick={handleModalPlanItemClick}
        disabled={isProcessing}
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

type PlanOptionsListOrientation = 'vertical' | 'horizontal'

function PlanOptionsList({
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
function TodoListModal({
  isOpen,
  onClose,
  list,
  t,
  onItemClick,
  disabled = false,
}: {
  isOpen: boolean
  onClose: () => void
  list: TodoList | null
  t: (key: string, values?: Record<string, unknown>, fallback?: string) => string
  onItemClick?: (item: TodoItem) => void
  disabled?: boolean
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
                    {items.map((item, index) => {
                      const rowContent = (
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
                      )

                      if (!item.completed && onItemClick) {
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={disabled}
                            className="w-full bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-1.5 text-left transition-colors hover:bg-intents-ux-box-backgroundColor disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => {
                              onItemClick(item)
                              onClose()
                            }}
                          >
                            {rowContent}
                          </button>
                        )
                      }

                      return (
                        <div
                          key={item.id}
                          className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-1.5"
                        >
                          {rowContent}
                        </div>
                      )
                    })}
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
  shouldCollapse = false,
  choiceSwapEnabled = false,
  onChoiceSurfaceChange,
}: InputActionsPanelProps) {
  const t = useTranslations()
  const thinkerLabel = useThinkerLabel()
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
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const appId = useAppIdFromParams()
  const mayBeRebuildApp = useMemo(() =>
    messages.some(msg =>
      msg.role === 'assistant' &&
      msg.toolCalls?.some(tc =>
        tc.name === 'rebuildPageSelector' || tc.name === 'websiteScraper' || tc.name === 'websiteRebuild'
      )
    ),
    [messages]
  )
  const { data: rebuildPagesData, isError: isRebuildPagesError, error: rebuildPagesError } = useRebuildPages(appId, mayBeRebuildApp)
  if (isRebuildPagesError) logger.warn('input-actions-panel.rebuild-pages-error', { appId }, { error: rebuildPagesError as Error })
  // Mirror the selector's homepage-alias filter so an alias-only unbuilt set doesn't
  // mount an empty, dead selector card.
  const hasRebuildPages = rebuildPagesData ? unbuiltRebuildPages(rebuildPagesData.availablePages).length > 0 : false

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

  // Track previous shouldCollapse to detect rising edge (false → true transition)
  const prevShouldCollapseRef = useRef(shouldCollapse)

  // Collapse when external trigger fires (e.g., chat input grows beyond 3 lines)
  // Only collapse on the rising edge (false → true), not continuously while true
  // This allows user to manually re-expand even when input is still >3 lines
  useEffect(() => {
    const risingEdge = !prevShouldCollapseRef.current && shouldCollapse
    prevShouldCollapseRef.current = shouldCollapse

    if (risingEdge && continueBuildingExpanded) {
      setContinueBuildingExpanded(false)
    }
  }, [shouldCollapse, continueBuildingExpanded])
  const [selectedThemeIndex, setSelectedThemeIndex] = useState<number>(0)
  const [selectedFontIndex, setSelectedFontIndex] = useState<number>(0)
  const [askQuestionCompleted, setAskQuestionCompleted] = useState(false)
  const [currentAskQuestionText, setCurrentAskQuestionText] = useState<string | null>(null)
  const nbaChoiceShortcutsRef = useRef<HTMLDivElement>(null)
  const planPreviewShortcutsRef = useRef<HTMLDivElement>(null)
  const nextActionShortcutsRef = useRef<HTMLDivElement>(null)
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

  // ── PromptBox swap (flag: airo-builder-chat-choice-swap) ─────────────────
  // A "choicelist surface" is the body that renders a ChoiceList/AskQuestion —
  // NOT the color/font preview panels (which take over the whole collapsible)
  // nor the plan-only PlanOptionsList. These are exactly the conditions under
  // which `continueBuildingTodoBody` renders a choicelist.
  const isChoiceSurfaceActive =
    !showColor &&
    !showFont &&
    (isAskQuestionActive ||
      nbaSuggestions.length > 0 ||
      (!hasPendingPlanItems && nextActionSuggestions.length > 0))
  const choiceSwapActive = choiceSwapEnabled && isChoiceSurfaceActive
  // Stable per-turn key: changes when the agent presents a different surface.
  const choiceSurfaceKey = isAskQuestionActive
    ? `askq:${nbaData?.question ?? ''}`
    : nbaSuggestions.length > 0
      ? `nba:${nbaData?.question ?? ''}:${nbaSuggestions.length}`
      : `next:${nextActionSuggestions.length}`
  // The choicelist occupies the input slot (is "hoisted" up to ChatInput) while
  // it is expanded. The header X collapses it (expanded → false): it then drops
  // out of the slot and renders inline above the PromptBox as a normal
  // collapsible. Expanding again (the chevron) swaps it back into the slot.
  const hoistChoice = choiceSwapActive && continueBuildingExpanded
  const collapseChoiceFromSlot = useCallback(() => {
    setContinueBuildingExpanded(false)
  }, [])
  // Holds the latest hoisted node so the publish effect can read the current
  // JSX without putting the (always-new) element in its dependency array.
  // Assigned during render below, once the collapsible nodes exist.
  const choiceSurfaceNodeRef = useRef<ReactNode>(null)
  // Re-publish only when something that changes the hoisted node changes, or
  // when it stops/starts being hoisted — not on every parent re-render, which
  // would loop. We fold in the *values* the published collapsible closes over
  // (not just counts), so an equal-count change still re-publishes: NBA /
  // next-action suggestion text, the plan-progress counter rendered in the
  // default collapsible's header, the async rebuild-pages data, and isMobile
  // (PlanOptionsList orientation). Each is derived from stable store/query
  // data, so it only changes when the underlying surface actually changes.
  const choiceSurfaceSignature = hoistChoice
    ? [
        choiceSurfaceKey,
        currentAskQuestionText ?? '',
        isProcessing,
        isMobile,
        JSON.stringify(nbaSuggestions.map(s => s.text)),
        JSON.stringify(nextActionSuggestions.map(s => s.text)),
        `${completedCount}/${totalItems}`,
        rebuildPagesData?.availablePages?.length ?? 0,
      ].join('|')
    : null
  useLayoutEffect(() => {
    if (!choiceSwapEnabled) return
    onChoiceSurfaceChange?.(
      hoistChoice ? choiceSurfaceNodeRef.current : null,
      hoistChoice ? choiceSurfaceKey : null,
    )
  }, [choiceSwapEnabled, hoistChoice, choiceSurfaceKey, choiceSurfaceSignature, onChoiceSurfaceChange])
  // Tell ChatInput to drop the hoisted surface on unmount so the PromptBox
  // swaps back in if the panel disappears entirely.
  useEffect(() => {
    if (!choiceSwapEnabled) return
    return () => onChoiceSurfaceChange?.(null, null)
  }, [choiceSwapEnabled, onChoiceSurfaceChange])

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

  const handleModalPlanItemClick = useCallback(
    (item: TodoItem) => {
      handlePlanItemClickCallback(item)
      setIsModalOpen(false)
    },
    [handlePlanItemClickCallback]
  )

  useEffect(() => {
    if (isProcessing || isModalOpen || showColor || isAskQuestionActive) return

    // Priority order matches the JSX render branches in the composer body:
    // NBAs win over plan-preview items, which win over next-action
    // suggestions ("continue building" mode when no NBAs and no pending plan
    // items exist). Without the third branch, pressing a digit while only
    // next-action suggestions are visible silently no-ops.
    const hasNBAShortcuts = nbaSuggestions.length > 0
    const hasPlanShortcuts = !hasNBAShortcuts && keyboardEnabledItems.length > 0
    const hasNextActionShortcuts =
      !hasNBAShortcuts && !hasPlanShortcuts && !hasPendingPlanItems && nextActionSuggestions.length > 0
    const itemCount = hasNBAShortcuts
      ? Math.min(nbaSuggestions.length, MAX_KEYBOARD_SHORTCUTS)
      : hasPlanShortcuts
        ? keyboardEnabledItems.length
        : hasNextActionShortcuts
          ? Math.min(nextActionSuggestions.length, MAX_KEYBOARD_SHORTCUTS)
          : 0
    if (itemCount === 0) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const activeEl = document.activeElement as HTMLElement | null
      if (isNonChatTextEntryActive(activeEl)) return

      const listRoot = hasNBAShortcuts
        ? nbaChoiceShortcutsRef.current
        : hasPlanShortcuts
          ? planPreviewShortcutsRef.current
          : nextActionShortcutsRef.current
      if (!shouldAllowChoiceListDigitShortcut(activeEl, { current: listRoot })) return

      const keyNum = parseInt(e.key, 10)
      if (isNaN(keyNum) || keyNum < 1 || keyNum > itemCount) return

      e.preventDefault()
      focusChoiceListOptionByIndex(listRoot, keyNum - 1)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isProcessing, isModalOpen, showColor, isAskQuestionActive, keyboardEnabledItems, nbaSuggestions.length, nextActionSuggestions.length, hasPendingPlanItems])

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
          <Thinker label={thinkerLabel} indicator={<ThinkingIndicator variant="spinner" />} />
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
        <div className="w-full px-1">
          <ThinkingTip />
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

        <div className="-mx-1 border-b border-border mb-1" />

        <TodoListModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          list={currentList}
          t={t}
          onItemClick={handleModalPlanItemClick}
          disabled={isProcessing}
        />
      </>
    )
  }

  // ── Mode A: Agent idle, nothing to show ──────────────────────────────────
  // Text-only askQuestion (e.g. URL prompt for rebuild) has no chip suggestions,
  // so hasCombinedItems is false — keep the panel mounted so the text input renders.
  if (!hasCombinedItems && !hasPlan && !showAnySuggest && !hasRebuildPages && !isAskQuestionActive) {
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
        <div ref={nbaChoiceShortcutsRef}>
          <ChoiceList
            onDecision={(value) => {
              const index = parseChoiceListIndex(value, 'input-actions-panel.nba-theme')
              if (index === null) return
              const s = nbaSuggestions[index]
              if (s) handleSuggestionClick(s)
            }}
            ariaLabel={nbaData?.question ?? t('builder_todo_continue_building')}
            disabled={isProcessing}
            optionDividers
          >
            {nbaSuggestions.map((suggestion, index) => (
              <ChoiceList.Item key={index} value={String(index)}>
                {suggestion.text}
              </ChoiceList.Item>
            ))}
          </ChoiceList>
        </div>
      ) : !hasPendingPlanItems && nextActionSuggestions.length > 0 ? (
        <div ref={nextActionShortcutsRef}>
          <ChoiceList
            onDecision={(value) => {
              const index = parseChoiceListIndex(value, 'input-actions-panel.next-actions-theme')
              if (index === null) return
              const s = nextActionSuggestions[index]
              if (s) handleSuggestionClick(s.text)
            }}
            ariaLabel={t('builder_todo_continue_building')}
            disabled={isProcessing}
            optionDividers
          >
            {nextActionSuggestions.map((suggestion, index) => (
              <ChoiceList.Item key={index} value={String(index)}>
                {suggestion.text}
              </ChoiceList.Item>
            ))}
          </ChoiceList>
        </div>
      ) : null}


      {!isAskQuestionActive && nbaSuggestions.length === 0 && planPreviewItems.length > 0 && (
        <PlanOptionsList
          ariaLabel={t('builder_todo_continue_building')}
          disabled={isProcessing}
          items={planPreviewItems}
          listContainerRef={planPreviewShortcutsRef}
          onItemClick={handlePlanItemClickCallback}
          orientation={isMobile ? 'horizontal' : 'vertical'}
        />
      )}

      {hasRebuildPages && rebuildPagesData && !isAskQuestionActive && (
        <RebuildPageSelectorToolRenderer
          toolName="rebuildPageSelector"
          toolStatus="completed"
          result={{ widget: { widgetType: 'rebuild-page-selector', widgetData: { appId: appId!, ...rebuildPagesData } } }}
          isLastAssistantMessage={true}
          size="small"
        />
      )}
    </div>
  )

  // The two choicelist-bearing collapsibles, extracted so the same node is used
  // both for inline rendering (swap off) and for hoisting into ChatInput's
  // PromptStage slot (swap on). Built unconditionally — only one is ever
  // rendered, and they are cheap element descriptors.
  // While hoisted into the input slot the header shows a dismiss (X) that
  // collapses the choicelist back out of the slot (revealing the PromptBox);
  // when rendered inline it falls back to the normal collapse chevron.
  const slotDismiss = hoistChoice ? collapseChoiceFromSlot : undefined
  const askQuestionCollapsible = (
    <CollapsibleChatInputSection
      title={<span className="text-foreground">{currentAskQuestionText || nbaData?.question}</span>}
      expanded={continueBuildingExpanded}
      onExpandedChange={setContinueBuildingExpanded}
      onDismiss={slotDismiss}
      dismissLabel={t('builder_common_close', undefined, 'Close')}
      data-testid="collapsible-section-continue-building"
    >
      {continueBuildingTodoBody}
    </CollapsibleChatInputSection>
  )
  const defaultCollapsible = (
    <CollapsibleChatInputSection
      title={continueBuildingTitle}
      expanded={continueBuildingExpanded}
      onExpandedChange={setContinueBuildingExpanded}
      headerRight={progressButton}
      onDismiss={slotDismiss}
      dismissLabel={t('builder_common_close', undefined, 'Close')}
      data-testid="collapsible-section-continue-building"
    >
      {continueBuildingTodoBody}
    </CollapsibleChatInputSection>
  )
  // Publish the active choicelist surface to ChatInput (read by the layout
  // effect above). Assigned during render so the effect always sees the latest
  // node; null when it is not hoisted into the slot.
  choiceSurfaceNodeRef.current = hoistChoice
    ? isAskQuestionActive
      ? askQuestionCollapsible
      : defaultCollapsible
    : null

  // ── Mode B: Agent idle, has data ─────────────────────────────────────────
  return (
    <>
      {(hasCombinedItems || hasPlan || showAnySuggest || hasRebuildPages || isAskQuestionActive) && !hoistChoice && (
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
                  data-testid="collapsible-section-continue-building"
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
                  data-testid="collapsible-section-continue-building"
                >
                  {body}
                </CollapsibleChatInputSection>
              )}
            </FontThemePreviewInputPanel>
          ) : isAskQuestionActive ? (
            askQuestionCollapsible
          ) : (
            defaultCollapsible
          )}
          <div className="-mx-1 mb-1 border-b border-border" />
        </>
      )}

      <TodoListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        list={currentList}
        t={t}
        onItemClick={handleModalPlanItemClick}
        disabled={isProcessing}
      />
    </>
  )
}

export default function InputActionsPanel({
  activeColorSchemeSuggest = null,
  activeFontThemeSuggest = null,
  shouldCollapse = false,
  choiceSwapEnabled = false,
  onChoiceSurfaceChange,
}: InputActionsPanelProps) {
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat')
  const isFontSelectionChatEnabled = useSwitchboard('airo-builder-font-selection-chat')
  // NB: both the queue *driver* and the multi-page progress/Stop UI (RebuildQueueProgress)
  // are mounted in ChatInput — always rendered, flag-independent — so the chat-plans-off
  // cohort can still see/stop a running batch. Don't mount either here.
  if (isThemeSelectionChatEnabled || isFontSelectionChatEnabled) {
    return (
      <InputActionsPanelThemeSelection
        activeColorSchemeSuggest={activeColorSchemeSuggest}
        activeFontThemeSuggest={activeFontThemeSuggest}
        shouldCollapse={shouldCollapse}
        choiceSwapEnabled={choiceSwapEnabled}
        onChoiceSurfaceChange={onChoiceSurfaceChange}
      />
    )
  }
  // Legacy path: shouldCollapse passed but not implemented (component is deprecated)
  return <InputActionsPanelLegacy shouldCollapse={shouldCollapse} />
}
