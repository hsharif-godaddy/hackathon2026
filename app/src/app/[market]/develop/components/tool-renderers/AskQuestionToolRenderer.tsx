'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChoiceList } from '@airo-ux/pattern-library/input/choice-list'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { focusChoiceListOptionByIndex } from '@/app/[market]/develop/components/tool-renderers/focusChoiceListOptionByIndex'
import { useNumberKeySelection } from '@/app/[market]/develop/components/tool-renderers/useNumberKeySelection'
import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
import { prelaunchKindForUserMessage } from '@/lib/post-publish-prelaunch-ask-question'
import { logger } from '@/lib/request-context'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { logAiroHQEvent } from '@/utils/instrumentation'

interface Suggestion {
  text: string
  value?: string
  testId?: string
  trackingId?: string
}

interface Question {
  question: string
  subtitle?: string
  type?: 'chips_single' | 'chips_multi' | 'text'
  placeholder?: string
  suggestions: Suggestion[]
  allowOther?: boolean
  multiSelect?: boolean
  metadata?: Record<string, unknown>
}

interface AskQuestionData {
  questions: Question[]
  currentQuestionIndex: number
  answers: string[]
}

interface ToolResult {
  output?: {
    widgetData?: AskQuestionData
    widgetType?: string
  }
  widgetData?: AskQuestionData
}

function isMultiSelectQuestion(q: Question): boolean {
  // `type` is authoritative when present: `chips_single` → single,
  // `chips_multi` → multiple. A legacy `multiSelect` flag is honored
  // only when `type` is absent, so contradictory inputs like
  // `{ type: "chips_single", multiSelect: true }` don't accidentally
  // render as multi. The tool schema rejects that contradiction at
  // validation time — this function is the second line of defense.
  if (q.type === 'chips_multi') return true
  if (q.type === 'chips_single' || q.type === 'text') return false
  return q.multiSelect === true
}

// The agent emits "Decide for me" as a chip with value "__decide__". The
// enhancer step detects that sentinel to commit to concrete choices. The
// renderer swaps the chip's label for the localized translation at render
// time, and resolves a click on it to the canonical English "Decide for me"
// in the assembled chat message — so the enhancer's matching rule fires
// regardless of UI locale.
const DECIDE_SENTINEL = '__decide__'
const DECIDE_CANONICAL_TEXT = 'Decide for me'

function isDecideSuggestion(s: Suggestion): boolean {
  return s.value === DECIDE_SENTINEL
}

// Chip values are the suggestion's 1-based index as a string (`"1"`, `"2"`, …)
// so they line up with the keyboard-digit shortcut UX (press "1" → first
// option). `resolveSelection` decodes those back to the chip's `value || text`.
// A freeform "Other" answer that happens to be a bare digit in range gets
// the same treatment — typing "1" submits the same payload as clicking the
// first chip. Out-of-range numerics and non-numerics fall through as literal
// user text.
function chipValue(index: number): string {
  return String(index + 1)
}

function resolveSelection(raw: string, suggestions: Suggestion[]): string {
  if (/^\d+$/.test(raw)) {
    const oneBased = parseInt(raw, 10)
    const index = oneBased - 1
    if (index >= 0 && index < suggestions.length) {
      const s = suggestions[index]
      // The decide chip's value is the `__decide__` sentinel (unreadable in
      // chat) and its text is whatever locale the agent's prompt was
      // authored in (English today, but agents that fully localize their
      // prompts could produce a different language than the user's UI).
      // Pin to the canonical English string so the enhancer matches it.
      if (isDecideSuggestion(s)) return DECIDE_CANONICAL_TEXT
      return s.value || s.text
    }
  }
  return raw
}

export default function AskQuestionToolRenderer({
  toolName,
  toolStatus,
  input,
  result,
  error,
  isLastAssistantMessage,
  onComplete,
  onSkip,
  onQuestionChange,
  hideQuestion,
}: DefaultToolRendererProps & {
  onComplete?: () => void
  /** Fired when the user skips all steps — dismisses UI only; no chat message is sent. */
  onSkip?: () => void
  onQuestionChange?: (question: string) => void
  hideQuestion?: boolean
}) {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  const [submitted, setSubmitted] = useState(false)
  const [activeStepIndex, setActiveStepIndex] = useState(0)

  useEffect(() => {
    setSubmitted(false)
    setActiveStepIndex(0)
  }, [result])

  const choiceListRef = useRef<HTMLDivElement>(null)
  const focusChoiceOptionByIndex = useCallback(
    (index: number) => focusChoiceListOptionByIndex(choiceListRef.current, index),
    [],
  )

  // Active-step keyboard digit shortcuts. Computed up-front (defaults to 0
  // when widgetData is unavailable) so the hook always runs unconditionally —
  // the early `return null` paths below are after this call.
  const widgetDataPeek = ((result as ToolResult | undefined)?.output ?? (result as ToolResult | undefined))?.widgetData
  const activeStepSuggestionCount =
    widgetDataPeek?.questions?.[activeStepIndex]?.suggestions.length ?? 0
  // Localized label for the "Decide for me" chip — the agent emits it with
  // `value: "__decide__"` and a hardcoded English `text`, but we render the
  // translation so the chip reads correctly across the 62 supported locales.
  // `defaultMessage` is the belt-and-suspenders floor: if the key hasn't
  // propagated to a given locale's bundle yet, react-intl renders the literal
  // key string ("builder_tools_askquestion_decide_for_me") which would leak
  // into the UI. The default keeps the chip readable in English while
  // translations catch up.
  const decideLabel = t('builder_tools_askquestion_decide_for_me', undefined, 'Decide for me')
  // `hideQuestion` only suppresses the title text inside each ChoiceList.Step —
  // it does NOT mean the renderer is inert. InputActionsPanel passes
  // `hideQuestion={true}` when hoisting this component into the composer card
  // because the card draws its own collapsible header above; the ChoiceList
  // itself is fully active and the digit shortcuts must still work. Disabling
  // the keyboard listener on `hideQuestion` would be wrong (and was: the
  // composer-card path is the only path users actually see).
  useNumberKeySelection({
    itemCount: activeStepSuggestionCount,
    disabled:
      isProcessing ||
      submitted ||
      isLastAssistantMessage === false ||
      toolStatus !== 'completed',
    onSelect: focusChoiceOptionByIndex,
    choiceListContainerRef: choiceListRef,
  })

  // Memoize the step children so the array passed to ChoiceList is reference-
  // stable across parent re-renders (streaming/loading store ticks).
  // @airo-ux/pattern-library ChoiceList tracks `children` through useMemo → activeStep
  // / collected → a reset effect that clears the in-progress "Other" draft.
  // Without this memo, every parent render produces fresh `<ChoiceList.Step>`
  // elements and that effect fires on every tick, wiping whatever the user
  // has typed so far. ChoiceList iterates children with `Children.forEach` and
  // matches by `child.type === ChoiceListStep`, so the memoized value MUST be
  // a flat array of step elements (no wrapper component / Fragment around it).
  // Computed up-front from `widgetDataPeek` so the hook always runs unconditionally.
  const peekQuestions = widgetDataPeek?.questions
  const stepChildren = useMemo(
    () =>
      peekQuestions
        ? peekQuestions.map((q, i) => {
            const titleNode = hideQuestion ? null : q.subtitle ? (
              <>
                {q.question}
                <div className="text-xs text-intents-ux-textSubtle-textColor mt-1">
                  {q.subtitle}
                </div>
              </>
            ) : (
              q.question
            )
            return (
              <ChoiceList.Step
                key={i}
                id={String(i)}
                title={titleNode}
                ariaLabel={q.question}
                selectionMode={isMultiSelectQuestion(q) ? 'multiple' : 'single'}
                {...(q.placeholder ? { otherPlaceholder: q.placeholder } : {})}
              >
                {q.suggestions.map((s, idx) => (
                  <ChoiceList.Item key={idx} value={chipValue(idx)}>
                    {isDecideSuggestion(s) ? decideLabel : s.text}
                  </ChoiceList.Item>
                ))}
              </ChoiceList.Step>
            )
          })
        : null,
    [peekQuestions, hideQuestion, decideLabel],
  )

  if (toolStatus === 'error') {
    return (
      <DefaultToolRenderer
        toolName={toolName}
        toolStatus={toolStatus}
        input={input}
        result={result}
        error={error}
        isLastAssistantMessage={isLastAssistantMessage}
      />
    )
  }

  if (toolStatus !== 'completed' || !result) return null

  const widgetData = ((result as ToolResult)?.output ?? (result as ToolResult))?.widgetData
  if (!widgetData?.questions?.length) return null

  const { questions } = widgetData

  if (submitted || isLastAssistantMessage === false) return null

  // allowOther is root-level — disable globally if any question opts out so
  // freeform doesn't leak into authoritative-pick questions. Placeholders
  // are per-step via ChoiceList.Step (@airo-ux/pattern-library >= 4.0). The root
  // `otherPlaceholder` is the fallback that ChoiceList uses on any step
  // that doesn't set its own — so it must be a generic default. Earlier
  // versions of this code seeded the root from the first question with a
  // placeholder for back-compat with components 3.3, but that bleeds one
  // step's hint onto every other step in a multi-question call (e.g. a
  // brand-name placeholder showing on a "what should shoppers do" step).
  const allowOtherGlobal = questions.every(q => q.allowOther !== false)
  const rootOtherPlaceholder = t('builder_tools_askquestion_other_placeholder')

  function handleStepChange(stepId: string, value: string | string[] | null) {
    pingUserActivity()
    const idx = parseInt(stepId, 10)
    const values = Array.isArray(value) ? value : value ? [value] : []
    const visible = questions[idx].suggestions
    for (const v of values) {
      // 1-based numeric values in range are picks (chip click OR a bare-digit
      // freeform answer). Anything else is a freeform "Other" submit.
      const oneBased = /^\d+$/.test(v) ? parseInt(v, 10) : NaN
      const isPick = oneBased >= 1 && oneBased <= visible.length
      if (isPick) {
        // Prefer the suggestion's trackingId when set so a specific button
        // (e.g. "Build a website with this logo") keeps the same id across
        // prompt edits or option reordering. Falls back to the positional
        // q{idx}_s{i} id for untagged suggestions.
        const trackingId = visible[oneBased - 1].trackingId
        logAiroHQEvent({
          category: 'click',
          recommendation_task: 'builder_askquestion_suggestion_click',
          recommendation_type: 'askquestion_suggestion',
          recommendation_id: trackingId ?? `q${idx}_s${oneBased - 1}`,
        })()
      } else {
        logAiroHQEvent({
          category: 'click',
          recommendation_task: 'builder_askquestion_other_submit',
          recommendation_type: 'askquestion_other',
          recommendation_id: `q${idx}`,
        })()
      }
    }
  }

  // Signal to useInitialization that the user is still engaged. Multi-step
  // askQuestion flows keep the agent idle while the user answers, so the
  // 5-min failsafe would otherwise dismiss the "Building" overlay mid-flow.
  // Fired on mount / forward / back (via ChoiceList.onActiveStepChange) and
  // on final commit; the init hook re-enters `waitingForFirstEdit` to reset
  // its `after` timer.
  function pingUserActivity() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('airo:user-activity'))
    }
  }

  function handleActiveStepChange(_stepId: string, idx: number) {
    pingUserActivity()
    setActiveStepIndex(idx)
    const q = questions[idx]
    if (q && onQuestionChange) onQuestionChange(q.question)
    // Impression log per active step — fires on mount, forward, and back via
    // ChoiceList. Replaces the previous hard-coded `q0` mount log and the
    // `q${idx+1}` log in handleStepChange (which only caught forward advance).
    logAiroHQEvent({
      category: 'impression',
      recommendation_task: 'builder_askquestion_shown',
      recommendation_type: 'askquestion_question',
      recommendation_id: `q${idx}`,
    })()
  }

  function handleCompleteSelections(selections: Record<string, string | string[] | null>) {
    if (isProcessing || submitted) return
    setSubmitted(true)
    pingUserActivity()

    // A skipped step records blank — the enhancer's omit-skipped-fields
    // rule then drops that dimension from the brief. Users who want the
    // enhancer to fill in a field click the "Decide for me" chip instead,
    // which `resolveSelection` maps to the canonical English string the
    // enhancer matches on (see DECIDE_CANONICAL_TEXT).
    const perQuestion = questions.map((q, i) => {
      const sel = selections[String(i)]
      if (sel == null) return ''
      if (Array.isArray(sel)) {
        return sel.map(v => resolveSelection(v, q.suggestions)).join(', ')
      }
      return resolveSelection(sel, q.suggestions)
    })

    const rawResult = result as Record<string, unknown> | undefined
    const meta = rawResult?.metadata
    const postPublishAppId =
      typeof meta === 'object' && meta !== null && 'postPublishAnalyticsAppId' in meta
        ? String((meta as { postPublishAnalyticsAppId: string }).postPublishAnalyticsAppId)
        : undefined
    if (postPublishAppId) {
      const firstAnswer = perQuestion[0] ?? ''
      const kind = prelaunchKindForUserMessage(firstAnswer)
      if (kind) {
        logger.info(`go-live.chat.${kind}_check_requested`, { appId: postPublishAppId })
        shipAnalyticsLog(`go_live.chat.${kind}_check_requested`, { appId: postPublishAppId })
      }
    }

    const msg =
      questions.length === 1
        ? (perQuestion[0] ?? '')
        : questions
            .map((q, i) => `${i + 1}) ${q.question}\n${perQuestion[i]}`)
            .filter((_, i) => perQuestion[i])
            .join('\n\n')
    const trimmed = msg.trim()
    if (trimmed) {
      if (!sendUserMessage) return
      sendUserMessage(trimmed, { isActionRequest: true })
    } else {
      onSkip?.()
    }

    onComplete?.()
  }

  return (
    <div ref={choiceListRef}>
      <ChoiceList
        ariaLabel={questions[0].question}
        disabled={isProcessing}
        optionDividers
        allowOther={allowOtherGlobal}
        otherPlaceholder={rootOtherPlaceholder}
        otherAriaLabel={t('builder_tools_askquestion_other_aria_label')}
        onComplete={handleCompleteSelections}
        onStepChange={handleStepChange}
        onActiveStepChange={handleActiveStepChange}
        stepIndicatorLabel={(cur, tot) => `${cur}/${tot}`}
      >
        {stepChildren}
      </ChoiceList>
    </div>
  )
}
