'use client'

import { useEffect, useRef, useState } from 'react'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import AskQuestionChoicePanel, {
  filterRedundantTextStepSuggestions,
} from '@/app/[market]/develop/components/tool-renderers/AskQuestionChoicePanel'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { useNumberKeySelection } from '@/app/[market]/develop/components/tool-renderers/useNumberKeySelection'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { isInitialBuildComplete, isInitialBuildFunnelActive } from '@/hooks/shared/initialBuildFunnel'
import { useHivemind } from '@/hooks/useHivemind'
import { useTranslations } from '@/hooks/useTranslations'
import {
  type AskQuestionFlowContext,
  generateFlowId,
  trackFlowCompleted,
  trackFlowStarted,
  trackNavigatorClicked,
  trackQuestionAnswered,
  trackQuestionShown,
  trackQuestionSkipped,
} from '@/lib/askQuestionAnalytics'
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

const DECIDE_SENTINEL = '__decide__'
const DECIDE_CANONICAL_TEXT = 'Decide for me'

function isDecideSuggestion(s: Suggestion): boolean {
  return s.value === DECIDE_SENTINEL
}

function suggestionsForQuestion(q: Question): Suggestion[] {
  return q.type === 'text' ? filterRedundantTextStepSuggestions(q.suggestions) : q.suggestions
}

function resolveSelection(raw: string, suggestions: Suggestion[]): string {
  if (/^\d+$/.test(raw)) {
    const oneBased = parseInt(raw, 10)
    const index = oneBased - 1
    if (index >= 0 && index < suggestions.length) {
      const s = suggestions[index]
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
  onStepProgressChange,
  hideQuestion,
}: DefaultToolRendererProps & {
  onComplete?: () => void
  /** Fired when the user skips all steps — dismisses UI only; no chat message is sent. */
  onSkip?: () => void
  onQuestionChange?: (question: string) => void
  onStepProgressChange?: (current: number, total: number) => void
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

  const panelRef = useRef<HTMLDivElement>(null)
  const selectByIndexRef = useRef<((index: number) => void) | null>(null)

  const widgetDataPeek = ((result as ToolResult | undefined)?.output ?? (result as ToolResult | undefined))?.widgetData
  const activeQuestion = widgetDataPeek?.questions?.[activeStepIndex]
  const activeStepSuggestionCount = activeQuestion?.suggestions.length ?? 0
  const decideLabel = t('builder_tools_askquestion_decide_for_me', undefined, 'Decide for me')
  // `hideQuestion` only suppresses the title text inside each ChoiceList.Step —
  // the panel draws its own collapsible header above. The ChoiceList itself is
  // fully active and digit shortcuts must still work when hideQuestion is true.
  useNumberKeySelection({
    itemCount: activeStepSuggestionCount,
    disabled:
      isProcessing ||
      submitted ||
      isLastAssistantMessage === false ||
      toolStatus !== 'completed',
    onSelect: (index) => selectByIndexRef.current?.(index),
    choiceListContainerRef: panelRef,
  })

  const { cohort: endgameCohort } = useHivemind(EXPERIMENT_IDS.initialAgent)

  // One stable flow id per on-screen question set. `result` is the tool result for this
  // askQuestion call; when it changes the agent has asked a new set, so we regenerate.
  // All three flow-context fields (id, appCreation, endgameCohort) are snapshotted at that
  // moment and held constant for the life of the flow. app_creation is the same funnel state
  // that drives intent_category='new_build' (strongly correlated), but NOT strictly identical
  // — e.g. rebuild flows are app_creation=false yet intent_category='rebuild'.
  // endgameCohort is only stamped for initial-agent flows; develop-agent questions must not
  // carry the cohort or they pollute per-cohort initial-agent analytics.
  const flowBox = useRef<{ result: unknown; id: string; appCreation: boolean; endgameCohort: string | undefined } | null>(null)
  if (!flowBox.current || flowBox.current.result !== result) {
    const appCreation = isInitialBuildFunnelActive() && !isInitialBuildComplete()
    flowBox.current = {
      result,
      id: generateFlowId(),
      appCreation,
      endgameCohort: appCreation ? endgameCohort : undefined,
    }
  }
  const flowId = flowBox.current.id
  const flowContext: AskQuestionFlowContext = {
    flowId,
    appCreation: flowBox.current.appCreation,
    endgameCohort: flowBox.current.endgameCohort,
  }

  // Fire flow_started exactly once per question set, synchronously before the first question_shown.
  const totalQuestions = widgetDataPeek?.questions?.length ?? 0
  const flowStartedFiredRef = useRef<string | null>(null)
  function emitFlowStartedOnce() {
    if (flowStartedFiredRef.current === flowId) return
    flowStartedFiredRef.current = flowId
    trackFlowStarted(flowContext, totalQuestions)
  }

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

  const allowOtherGlobal = questions.every(q => q.allowOther !== false)
  const rootOtherPlaceholder = t('builder_tools_askquestion_other_placeholder')
  const submitLabel = t('builder_common_submit')
  const isInitialQuestionsFlow =
    !hideQuestion || (isInitialBuildFunnelActive() && !isInitialBuildComplete())

  function handleStepChange(stepId: string, value: string | string[] | null) {
    pingUserActivity()
    const idx = parseInt(stepId, 10)
    if (value === null) {
      trackQuestionSkipped(flowContext, idx + 1)
    } else {
      trackQuestionAnswered(flowContext, idx + 1)
    }
    const values = Array.isArray(value) ? value : value ? [value] : []
    const visible = suggestionsForQuestion(questions[idx])
    for (const v of values) {
      const oneBased = /^\d+$/.test(v) ? parseInt(v, 10) : NaN
      const isPick = oneBased >= 1 && oneBased <= visible.length
      if (isPick) {
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

  function pingUserActivity() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('airo:user-activity'))
    }
  }

  function handleActiveStepChange(_stepId: string, idx: number) {
    pingUserActivity()
    setActiveStepIndex(idx)
    emitFlowStartedOnce()
    trackQuestionShown(flowContext, idx + 1)
    const q = questions[idx]
    if (q && onQuestionChange) onQuestionChange(q.question)
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
    trackFlowCompleted(flowContext)
    pingUserActivity()

    const perQuestion = questions.map((q, i) => {
      const sel = selections[String(i)]
      if (sel == null) return ''
      if (Array.isArray(sel)) {
        return sel.map(v => resolveSelection(v, suggestionsForQuestion(q))).join(', ')
      }
      return resolveSelection(sel, suggestionsForQuestion(q))
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

  const panelQuestions = questions.map(q => ({
    ...q,
    suggestions: q.suggestions.map(s =>
      isDecideSuggestion(s) ? { ...s, text: decideLabel } : s,
    ),
  }))

  return (
    <div ref={panelRef}>
      <AskQuestionChoicePanel
        questions={panelQuestions}
        allowOtherGlobal={allowOtherGlobal}
        isInitialQuestionsFlow={isInitialQuestionsFlow}
        rootOtherPlaceholder={rootOtherPlaceholder}
        otherAriaLabel={t('builder_tools_askquestion_other_aria_label')}
        selectByIndexRef={selectByIndexRef}
        disabled={isProcessing}
        hideQuestion={hideQuestion}
        ariaLabel={questions[0].question}
        onStepChange={handleStepChange}
        onActiveStepChange={handleActiveStepChange}
        onNavigateBack={(fromIndex) => trackNavigatorClicked(flowContext, fromIndex + 1, 'back')}
        onNavigateForward={(fromIndex) => trackNavigatorClicked(flowContext, fromIndex + 1, 'forward')}
        onStepProgressChange={onStepProgressChange}
        onComplete={handleCompleteSelections}
        backLabel={t('builder_common_back')}
        skipLabel={t('builder_widgets_feedback_skip')}
        submitLabel={submitLabel}
      />
    </div>
  )
}
