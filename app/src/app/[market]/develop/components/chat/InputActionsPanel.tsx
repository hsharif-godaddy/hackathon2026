'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Thinker } from '@airo-ux/pattern-library/chat/thinker'
import { ChoiceList } from '@airo-ux/pattern-library/input/choice-list'
import { useQueryClient } from '@tanstack/react-query'
import Box from '@ux/box'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import CollapsibleChatInputSection, { CollapseChevron } from '@/app/[market]/develop/components/chat/CollapsibleChatInputSection'
import { FirstBuildFeedbackPanel } from '@/app/[market]/develop/components/chat/FirstBuildFeedbackPanel'
import FontThemePreviewInputPanel from '@/app/[market]/develop/components/chat/FontThemePreviewInputPanel'
import { CircularCheckbox, FullPlanSection, PlanOptionsList, PlanToggleLabel, TodoListModal } from '@/app/[market]/develop/components/chat/InputActionsPanelPlanViews'
import { useSecretsComposerTakeover } from '@/app/[market]/develop/components/chat/secrets/useSecretsComposerTakeover'
import { PanelSectionTitle } from '@/app/[market]/develop/components/chat/StepProgressTag'
import ThemePreviewInputPanel from '@/app/[market]/develop/components/chat/ThemePreviewInputPanel'
import ThinkingTip from '@/app/[market]/develop/components/chat/ThinkingTip'
import { useFirstBuildFeedback } from '@/app/[market]/develop/components/chat/useFirstBuildFeedback'
import { type LatestNBAData, useLatestNBAs } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import { useThinkerIndicator } from '@/app/[market]/develop/components/chat/useThinkerIndicator'
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
import { manualRebuildSelectorPages, useRebuildPages } from '@/app/[market]/develop/hooks/useRebuildPages'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { cn } from '@/lib/utils'
import { todoListService } from '@/services/TodoListService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useIsActivelyStreaming, useIsLoading, useMessages } from '@/stores/useStreamingConversationStore'
import type { TodoItem } from '@/stores/useTodoListStore'
import { useCurrentList, useTodoListStore, useViewState } from '@/stores/useTodoListStore'
import { useUpfrontRebuildBuildQueueStore } from '@/stores/useUpfrontRebuildBuildQueueStore'
import { safeGetItem } from '@/utils/localStorage'

const MAX_COMBINED_ITEMS = 4

function InputActionsPanelCard({
  children,
  headerOnly = false,
}: {
  children: ReactNode
  /** When true, only the header row is visible — drop bottom card padding. */
  headerOnly?: boolean
}) {
  return (
    <Box
      data-testid="input-actions-panel-card"
      displayType="flex"
      elevation="raised"
      orientation="vertical"
      blockPadding="sm"
      inlinePadding="sm"
      className={cn(headerOnly && '[padding-block-end:0!important]')}
    >
      {children}
    </Box>
  )
}

/**
 * InputActionsPanel
 *
 * Unified "Up next" panel rendered in its own card above the chat input.
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
   * Fired when in-turn Initial/Follow-up askQuestion UI (before first build
   * completes) should replace the free-text PromptBox (true), or when the
   * composer prompt should return (false). Idle Continue Building NBAs —
   * including post-build design feedback askQuestion — do not hide the prompt.
   */
  onHideComposerPromptChange?: (hidden: boolean) => void
  // FBF props (internal, passed from wrapper to variants)
  feedbackActive?: boolean
  feedback?: import('./useFirstBuildFeedback').UseFirstBuildFeedbackResult | null
}

function shouldHideComposerForAskQuestion(
  isAskQuestionActive: boolean,
  initialBuildComplete: boolean | undefined,
): boolean {
  return isAskQuestionActive && initialBuildComplete !== true
}

function usePublishHideComposerPrompt(
  hidden: boolean,
  onHideComposerPromptChange?: (hidden: boolean) => void,
) {
  useLayoutEffect(() => {
    onHideComposerPromptChange?.(hidden)
  }, [hidden, onHideComposerPromptChange])
  useEffect(() => {
    if (!onHideComposerPromptChange) return
    return () => onHideComposerPromptChange(false)
  }, [onHideComposerPromptChange])
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

function isAskQuestionNBA(nbaData: LatestNBAData | null | undefined): boolean {
  return nbaData?.source === 'askQuestion' || isAskQuestionToolResult(nbaData?.toolResult)
}

function isActionableNbaData(nbaData: LatestNBAData | null | undefined): nbaData is LatestNBAData {
  if (!nbaData) {
    return false
  }
  if (nbaData.suggestions.length > 0) {
    return true
  }
  return isAskQuestionNBA(nbaData) && !!nbaData.toolResult
}

function askQuestionStepCount(toolResult: unknown): number {
  if (!toolResult || typeof toolResult !== 'object') return 1
  const resultObj = toolResult as { output?: { widgetData?: { questions?: unknown[] } }; widgetData?: { questions?: unknown[] } }
  const widgetData = resultObj.output?.widgetData ?? resultObj.widgetData
  return Array.isArray(widgetData?.questions) && widgetData.questions.length > 0
    ? widgetData.questions.length
    : 1
}


/**
 * @deprecated Remove when `airo-builder-theme-selection-chat` is permanently on
 * @param shouldCollapse - Accepted but ignored. Legacy component does not implement collapse behavior.
 */
function InputActionsPanelLegacy({
  shouldCollapse: _shouldCollapse,
  feedbackActive = false,
  onHideComposerPromptChange,
}: InputActionsPanelProps) {
  const t = useTranslations()
  const thinkerLabel = useThinkerLabel()
  const thinkerIndicator = useThinkerIndicator()
  const sendUserMessage = useSendUserMessage()
  const nbaData = useLatestNBAs(feedbackActive)
  const currentList = useCurrentList()
  const viewState = useViewState()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const initialBuildComplete = useDevelopPageStore((state) => state.app?.initialBuildComplete)

  const [fullPlanExpanded, setFullPlanExpanded] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [otherValue, setOtherValue] = useState('')
  const [askQuestionCompleted, setAskQuestionCompleted] = useState(false)

  useEffect(() => {
    setAskQuestionCompleted(false)
    setOtherValue('')
  }, [nbaData?.toolResult])

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
  const isAskQuestionActive = isAskQuestionNBA(nbaData) && !!nbaData?.toolResult && !askQuestionCompleted

  usePublishHideComposerPrompt(
    shouldHideComposerForAskQuestion(isAskQuestionActive, initialBuildComplete),
    onHideComposerPromptChange,
  )

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

  // ── Mode C: Agent working ────────────────────────────────────────────────
  if (isProcessing) {
    const thinkingHeaderOnly = !(hasPlan && fullPlanExpanded)
    return (
      <InputActionsPanelCard headerOnly={thinkingHeaderOnly}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 px-1 py-0.5 my-[4px] min-h-[22px]">
            <Thinker label={thinkerLabel} indicator={thinkerIndicator} className="shrink-0" />
            {hasPlan && !fullPlanExpanded && (
              <button
                type="button"
                className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground transition-colors min-w-0"
                onClick={() => setFullPlanExpanded(true)}
              >
                <span className="truncate">{t('builder_todo_view_plan', { completed: completedCount, total: totalItems })}</span>
                <svg
                  className="w-2 h-2 shrink-0 transition-transform duration-200"
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
          {initialBuildComplete && <ThinkingTip />}

          <AnimatePresence initial={false}>
            {hasPlan && fullPlanExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
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
        </div>

        <TodoListModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          list={currentList}
          t={t}
        />
      </InputActionsPanelCard>
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
    <InputActionsPanelCard>
      <div className="flex flex-col gap-0.5 mb-1">
        {/* When no NBAs: single row with "Continue building" on left + "View plan" on right.
            When NBAs present: header question above, NBAs, then "View plan" as separator.
            When expanded with no NBAs: hide header since plan name serves as heading. */}
        {nbaSuggestions.length === 0 && hasPlan ? (
          // Plan-only: combined row (hidden when expanded — plan name takes over)
          !fullPlanExpanded && (
            <div className="flex items-center justify-between px-1 py-0.5 my-[4px] min-h-[22px]">
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
            {!(fullPlanExpanded && nbaSuggestions.length === 0 && !isAskQuestionActive) && (
              <div className="px-1 py-0.5 text-sm font-medium text-muted-foreground text-left">
                {(isAskQuestionActive || nbaSuggestions.length > 0) && nbaData?.question
                  ? nbaData.question
                  : t('builder_todo_continue_building')}
              </div>
            )}

            {isAskQuestionActive ? (
              <AskQuestionToolRenderer
                toolName="askQuestion"
                toolStatus="completed"
                result={nbaData.toolResult as Record<string, unknown>}
                isLastAssistantMessage={true}
                hideQuestion={true}
                onComplete={() => setAskQuestionCompleted(true)}
              />
            ) : nbaSuggestions.length > 0 ? (
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
                  suppressLastRowBottomBorder={!showOtherInput}
                >
                  {nbaSuggestions.map((suggestion, index) => (
                    <ChoiceList.Item key={index} value={String(index)}>
                      {suggestion.text}
                    </ChoiceList.Item>
                  ))}
                </ChoiceList>
              </div>
            ) : null}

            {showOtherInput && !isAskQuestionActive && (
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
            suppressLastRowBottomBorder
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

      <TodoListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        list={currentList}
        t={t}
      />
    </InputActionsPanelCard>
  )
}

function InputActionsPanelThemeSelection({
  activeColorSchemeSuggest = null,
  activeFontThemeSuggest = null,
  shouldCollapse = false,
  onHideComposerPromptChange,
  feedbackActive = false,
  feedback = null,
}: InputActionsPanelProps) {
  const t = useTranslations()
  const thinkerLabel = useThinkerLabel()
  const thinkerIndicator = useThinkerIndicator()
  const queryClient = useQueryClient()
  const sendUserMessage = useSendUserMessage()
  const [askQuestionDismissed, setAskQuestionDismissed] = useState(false)
  const currentList = useCurrentList()
  const viewState = useViewState()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const secretsComposerTakeover = useSecretsComposerTakeover()
  const messages = useMessages()
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const initialBuildComplete = useDevelopPageStore((state) => state.app?.initialBuildComplete)
  const appId = useAppIdFromParams()

  const nbaDataRaw = useLatestNBAs(feedbackActive)
  const nbaData = askQuestionDismissed ? null : nbaDataRaw

  const isRebuildMultipageEnabled = useSwitchboard('appbuilder-rebuild-multipage')
  const mayBeRebuildApp = useMemo(() =>
    messages.some(msg =>
      msg.role === 'assistant' &&
      msg.toolCalls?.some(tc =>
        tc.name === 'rebuildPageSelector' || tc.name === 'websiteScraper' || tc.name === 'websiteRebuild'
      )
    ),
    [messages]
  )
  const upfrontPlanEntry = useUpfrontRebuildBuildQueueStore(state =>
    appId != null ? state.queues[appId] : undefined,
  )
  const rebuildPlanInProgress = useUpfrontRebuildBuildQueueStore(state =>
    appId != null && state.isPlanInProgress(appId) && (state.queues[appId]?.planSlugs.length ?? 0) > 1,
  )
  const { data: rebuildPagesData, isError: isRebuildError, error: rebuildError } = useRebuildPages(
    appId,
    mayBeRebuildApp && !!isRebuildMultipageEnabled,
    rebuildPlanInProgress ? 5000 : false,
  )
  if (isRebuildError) logger.warn('input-actions-panel.rebuild-pages-error', { appId }, { error: rebuildError as Error })
  const manualRebuildPages = useMemo(
    () => manualRebuildSelectorPages(rebuildPagesData?.availablePages ?? [], upfrontPlanEntry),
    [rebuildPagesData?.availablePages, upfrontPlanEntry],
  )
  const hasManualRebuildPages = manualRebuildPages.length > 0
  const hasRebuildPages = rebuildPlanInProgress || hasManualRebuildPages

  const items = currentList?.items ?? []
  const uncompletedItems = useMemo(() => items.filter(item => !item.completed), [items])
  const completedItems = useMemo(() => items.filter(item => item.completed), [items])
  const hasPendingPlanItems = uncompletedItems.length > 0

  const hasNoBAs = !isActionableNbaData(nbaData)
  const hasConversationHistory = messages.length > 0
  const { data: nextActionsData, isError: isNextActionsError, error: nextActionsError } = useNextActions(
    appId,
    hasNoBAs && !isProcessing && hasConversationHistory && !hasPendingPlanItems,
  )
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
  const [askQuestionProgress, setAskQuestionProgress] = useState<{ current: number; total: number } | null>(null)
  const nbaChoiceShortcutsRef = useRef<HTMLDivElement>(null)
  const planPreviewShortcutsRef = useRef<HTMLDivElement>(null)
  const nextActionShortcutsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setAskQuestionDismissed(false)
    setAskQuestionCompleted(false)
    setCurrentAskQuestionText(null)
  }, [nbaDataRaw?.toolResult])
  const handleAskQuestionStepProgress = useCallback((current: number, total: number) => {
    setAskQuestionProgress({ current, total })
  }, [])
  const hasPlan = !!currentList && items.length > 0
  const totalItems = items.length
  const completedCount = completedItems.length

  const hasNBAs = !isProcessing && !!nbaData && nbaData.suggestions.length > 0

  // Client-side dedup: strip NBAs that overlap with uncompleted plan items.
  // The agent prompt discourages this, but older responses or edge cases can
  // still produce duplicates like "Build the about page" ≈ "About page".
  const dedupedNBASuggestions = hasNBAs
    ? nbaData.suggestions.filter(suggestion => {
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

  useEffect(() => {
    if (!isAskQuestionActive) {
      setAskQuestionProgress(null)
      return
    }
    setAskQuestionProgress({ current: 1, total: askQuestionStepCount(nbaData?.toolResult) })
  }, [isAskQuestionActive, nbaData?.toolResult])

  const hideComposerPrompt =
    shouldHideComposerForAskQuestion(isAskQuestionActive, initialBuildComplete) &&
    continueBuildingExpanded &&
    !showColor &&
    !showFont
  usePublishHideComposerPrompt(hideComposerPrompt, onHideComposerPromptChange)

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
    const thinkingHeaderOnly = !(hasPlan && fullPlanExpanded && !showAnySuggest)
    return (
      <InputActionsPanelCard headerOnly={thinkingHeaderOnly}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 px-1 py-0.5 my-[4px] min-h-[22px]">
            <Thinker label={thinkerLabel} indicator={thinkerIndicator} className="shrink-0" />
            {hasPlan && !showAnySuggest && (
              <button
                type="button"
                className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-0"
                onClick={() => {
                  setFullPlanExpanded(v => !v)
                  autoExpandedRef.current = false
                }}
              >
                <span className="truncate">{currentList.name}</span>
                <CollapseChevron expanded={fullPlanExpanded} />
              </button>
            )}
          </div>
          {initialBuildComplete && <ThinkingTip />}

          <AnimatePresence initial={false}>
            {hasPlan && fullPlanExpanded && !showAnySuggest && (
              <motion.div
                key="full-plan-processing"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
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
        </div>

        <TodoListModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          list={currentList}
          t={t}
        />
      </InputActionsPanelCard>
    )
  }

  // ── Mode A: Agent idle, nothing to show ──────────────────────────────────
  if (secretsComposerTakeover != null) {
    return null
  }

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

  // Long, user-facing question text (askQuestion prompt or an NBA question) must
  // wrap so the full question stays readable; short static titles (color/font,
  // "continue building") keep the compact single-line truncate behavior.
  const isQuestionTitle = isAskQuestionActive || (nbaSuggestions.length > 0 && !!nbaData?.question)
  const continueBuildingTitle = (
    <PanelSectionTitle
      progress={isAskQuestionActive ? askQuestionProgress : null}
      multiline={isQuestionTitle}
    >
      {isAskQuestionActive ? (
        <span className="text-foreground">{currentAskQuestionText || nbaData?.question}</span>
      ) : (
        continueBuildingTitleText
      )}
    </PanelSectionTitle>
  )

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
          onSkip={() => setAskQuestionDismissed(true)}
          onQuestionChange={setCurrentAskQuestionText}
          onStepProgressChange={handleAskQuestionStepProgress}
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
            suppressLastRowBottomBorder
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
            suppressLastRowBottomBorder
          >
            {nextActionSuggestions.map((suggestion, index) => (
              <ChoiceList.Item key={index} value={String(index)}>
                {suggestion.text}
              </ChoiceList.Item>
            ))}
          </ChoiceList>
        </div>
      ) : null}

      {!!isRebuildMultipageEnabled && hasRebuildPages && nbaData?.source !== 'askQuestion' && rebuildPagesData && (
        <RebuildPageSelectorToolRenderer
          toolName="rebuildPageSelector"
          toolStatus="completed"
          result={{
            widget: {
              widgetType: 'rebuild-page-selector',
              widgetData: {
                appId: appId!,
                sourceUrl: rebuildPagesData.sourceUrl,
                availablePages: rebuildPlanInProgress
                  ? rebuildPagesData.availablePages
                  : manualRebuildPages,
                totalPages: rebuildPagesData.totalPages,
                builtPages: rebuildPagesData.builtPages,
              },
            },
          }}
          isLastAssistantMessage={true}
          size="small"
        />
      )}

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
    </div>
  )

  const askQuestionCollapsible = (
    <CollapsibleChatInputSection
      title={continueBuildingTitle}
      expanded={continueBuildingExpanded}
      onExpandedChange={setContinueBuildingExpanded}
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
      data-testid="collapsible-section-continue-building"
    >
      {continueBuildingTodoBody}
    </CollapsibleChatInputSection>
  )

  const showInlinePanel =
    hasCombinedItems || hasPlan || showAnySuggest || hasRebuildPages || isAskQuestionActive

  // ── Mode B: Agent idle, has data ─────────────────────────────────────────
  return (
    <InputActionsPanelCard headerOnly={showInlinePanel && !continueBuildingExpanded}>
      {feedback ? (
        <FirstBuildFeedbackPanel feedback={feedback} appId={appId ?? ''} />
      ) : showInlinePanel && (
        <>
          {showColor && activeColorSchemeSuggest ? (
            <ThemePreviewInputPanel
              key={activeColorSchemeSuggest.toolCallId}
              toolCallId={activeColorSchemeSuggest.toolCallId}
              palettes={palettesWithCurrent}
              onCancel={handleColorCancel}
              selectedIndex={selectedThemeIndex}
              onSelectedIndexChange={setSelectedThemeIndex}
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
        </>
      )}

      <TodoListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        list={currentList}
        t={t}
      />
    </InputActionsPanelCard>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

export default function InputActionsPanel({
  activeColorSchemeSuggest = null,
  activeFontThemeSuggest = null,
  shouldCollapse = false,
  onHideComposerPromptChange,
}: InputActionsPanelProps) {
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat')
  const isFontSelectionChatEnabled = useSwitchboard('airo-builder-font-selection-chat')

  // FBF lives here so it runs regardless of which variant (Legacy or ThemeSelection) is active.
  const appId = useAppIdFromParams()
  const messages = useMessages()
  const feedback = useFirstBuildFeedback(appId ?? '')
  const feedbackActive = feedback !== null

  // After FBF is answered/skipped, suppress stale askQuestion NBAs (e.g. the initial
  // build interview) so they do not snap back when the user picks a close chip.
  // Color/font chip replies use colorScheme/fontTheme panels and bypass this gate.
  const initialBuildComplete = useDevelopPageStore(
    (s) => s.app?.id === appId ? s.app?.initialBuildComplete : undefined,
  )
  const feedbackResolved = Boolean(
    safeGetItem(`fbf_answered_${appId}`) || safeGetItem(`fbf_skipped_${appId}`),
  )

  // Baseline message count at FBF resolve (includes the chip user message — send runs
  // before dismiss). Suppression lifts once the agent reply adds a message above it.
  const [fbfConsumedMessageCount, setFbfConsumedMessageCount] = useState<number | null>(null)
  useEffect(() => {
    if (feedbackResolved && fbfConsumedMessageCount === null) {
      setFbfConsumedMessageCount(messages.length)
    } else if (!feedbackResolved) {
      setFbfConsumedMessageCount(null)
    }
  }, [feedbackResolved, messages.length, fbfConsumedMessageCount])

  // Suppress askQuestion NBAs at or below the resolve baseline (chip in flight).
  // Lifts when the agent response lands so writing-tone askQuestion can render.
  const fbfNBASuppressed = !!initialBuildComplete && feedbackResolved &&
    (fbfConsumedMessageCount === null || messages.length <= fbfConsumedMessageCount)
  const suppressNBA = feedbackActive || fbfNBASuppressed

  // Chatted-past: dismiss if the user sends a message AFTER the panel first appears.
  // feedbackJustActivatedRef gates the first run: when feedback becomes non-null we
  // calibrate the baseline to the current count instead of comparing against a stale
  // mount-time count (which would fire immediately since messages arrived during the build).
  const userMessageCountRef = useRef(messages.filter((m) => m.role === 'user').length)
  const feedbackJustActivatedRef = useRef(false)
  useEffect(() => {
    if (!feedback) {
      feedbackJustActivatedRef.current = false
      return
    }
    const currentCount = messages.filter((m) => m.role === 'user').length
    if (!feedbackJustActivatedRef.current) {
      // First render with feedback active — calibrate baseline to now, do not dismiss.
      feedbackJustActivatedRef.current = true
      userMessageCountRef.current = currentCount
      return
    }
    if (currentCount > userMessageCountRef.current) {
      feedback.dismiss('chatted-past')
    }
    userMessageCountRef.current = currentCount
  }, [messages, feedback])

  if (isThemeSelectionChatEnabled || isFontSelectionChatEnabled) {
    return (
      <InputActionsPanelThemeSelection
        activeColorSchemeSuggest={activeColorSchemeSuggest}
        activeFontThemeSuggest={activeFontThemeSuggest}
        shouldCollapse={shouldCollapse}
        onHideComposerPromptChange={onHideComposerPromptChange}
        feedbackActive={suppressNBA}
        feedback={feedback}
      />
    )
  }
  // Legacy path: shouldCollapse passed but not implemented (component is deprecated)
  return (
    <>
      {feedback && <FirstBuildFeedbackPanel feedback={feedback} appId={appId ?? ''} />}
      <InputActionsPanelLegacy
        shouldCollapse={shouldCollapse}
        onHideComposerPromptChange={onHideComposerPromptChange}
        feedbackActive={suppressNBA}
      />
    </>
  )
}
