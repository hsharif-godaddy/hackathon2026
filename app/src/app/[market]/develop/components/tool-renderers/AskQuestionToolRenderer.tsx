'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChoiceList } from '@airo/components/input/choice-list'

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
// enhancer step detects that sentinel to commit to concrete choices. We
// surface it as the ChoiceList skip button instead of a list item, so it
// never renders as a chip.
const DECIDE_SENTINEL = '__decide__'

function isDecideSuggestion(s: Suggestion): boolean {
  return s.value === DECIDE_SENTINEL
}

// User-facing text for the decide chip — emitted in the assembled message
// instead of the raw `__decide__` sentinel value, since the message renders
// in chat. The enhancer prompt matches on this text (case-insensitive) to
// decide which fields to commit to.
function getDecideText(q: Question): string | undefined {
  const d = q.suggestions.find(isDecideSuggestion)
  return d?.text
}

function visibleSuggestions(q: Question): Suggestion[] {
  return q.suggestions.filter(s => !isDecideSuggestion(s))
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
  onQuestionChange,
  hideQuestion,
}: DefaultToolRendererProps & {
  onComplete?: () => void
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
    widgetDataPeek?.questions?.[activeStepIndex]
      ? visibleSuggestions(widgetDataPeek.questions[activeStepIndex]).length
      : 0
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
  // @airo/components ChoiceList tracks `children` through useMemo → activeStep
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
            const visible = visibleSuggestions(q)
            return (
              <ChoiceList.Step
                key={i}
                id={String(i)}
                title={titleNode}
                ariaLabel={q.question}
                selectionMode={isMultiSelectQuestion(q) ? 'multiple' : 'single'}
                {...(q.placeholder ? { otherPlaceholder: q.placeholder } : {})}
              >
                {visible.map((s, idx) => (
                  <ChoiceList.Item key={idx} value={chipValue(idx)}>
                    {s.text}
                  </ChoiceList.Item>
                ))}
              </ChoiceList.Step>
            )
          })
        : null,
    [peekQuestions, hideQuestion],
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
  // are per-step via ChoiceList.Step (@airo/components >= 4.0). The root
  // `otherPlaceholder` is the fallback that ChoiceList uses on any step
  // that doesn't set its own — so it must be a generic default. Earlier
  // versions of this code seeded the root from the first question with a
  // placeholder for back-compat with components 3.3, but that bleeds one
  // step's hint onto every other step in a multi-question call (e.g. a
  // brand-name placeholder showing on a "what should shoppers do" step).
  const allowOtherGlobal = questions.every(q => q.allowOther !== false)
  const rootOtherPlaceholder = t('builder_tools_askquestion_other_placeholder')

  // Use the decide sentinel as the skip label when every chip step offers it.
  // `skipLabel` is a root-level ChoiceList prop — it applies to every step
  // including text-type ones. That's intentional for the prompt-enhancer
  // flow, where the agent designs the whole form (chips + optional trailing
  // text questions like LOCATION / KEY DETAILS / NAMING) around "Decide for
  // me" semantics. We submit the same "Decide for me" string for skipped
  // text steps too (see handleCompleteSelections) so the enhancer's
  // decide-for-me rule kicks in for those fields rather than the
  // omit-skipped-fields rule — matches the button's promise to the user.
  const chipQuestions = questions.filter(q => q.type !== 'text')
  const useDecideAsSkip =
    chipQuestions.length > 0 && chipQuestions.every(q => getDecideText(q) !== undefined)
  // Derive the label from the actual sentinel suggestion rather than a
  // magic string, so renaming "Decide for me" in prompts doesn't silently
  // leave the skip button on the old copy. Text questions don't carry a
  // decide chip themselves; the chip-side text is the source of truth and
  // applies to every step.
  const decideText = useDecideAsSkip
    ? (chipQuestions[0].suggestions.find(isDecideSuggestion)?.text ?? 'Decide for me')
    : undefined
  const skipLabel = decideText

  function handleStepChange(stepId: string, value: string | string[] | null) {
    pingUserActivity()
    const idx = parseInt(stepId, 10)
    const values = Array.isArray(value) ? value : value ? [value] : []
    const visible = visibleSuggestions(questions[idx])
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
    if (isProcessing || !sendUserMessage || submitted) return
    setSubmitted(true)
    pingUserActivity()

    // Skip emits the "Decide for me" display text only when the skip button
    // is acting as "Decide for me" (useDecideAsSkip). The same text is
    // emitted for every step type — including text-only steps that don't
    // carry a decide chip of their own — so the enhancer's decide-for-me
    // rule fires for the LOCATION / KEY DETAILS / NAMING fields rather than
    // the omit-skipped-fields rule. Otherwise the button's "Decide for me"
    // promise wouldn't be kept on those steps.
    // When the label is the default "Skip", a skipped step means the user
    // omitted an optional answer — record blank so the enhancer omits that
    // dimension instead of silently treating it as decide-for-me.
    const perQuestion = questions.map((q, i) => {
      const sel = selections[String(i)]
      const visible = visibleSuggestions(q)
      if (sel == null) {
        return useDecideAsSkip ? (decideText ?? '') : ''
      }
      if (Array.isArray(sel)) {
        return sel.map(v => resolveSelection(v, visible)).join(', ')
      }
      return resolveSelection(sel, visible)
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

    if (questions.length === 1) {
      sendUserMessage(perQuestion[0] ?? '', { isActionRequest: true })
    } else {
      const msg = questions
        .map((q, i) => `${i + 1}) ${q.question}\n${perQuestion[i]}`)
        .filter((_, i) => perQuestion[i])
        .join('\n\n')
      sendUserMessage(msg, { isActionRequest: true })
    }

    if (onComplete) onComplete()
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
        {...(skipLabel ? { skipLabel } : {})}
      >
        {stepChildren}
      </ChoiceList>
    </div>
  )
}
