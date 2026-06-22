'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { ChoiceList, ChoiceListOtherRow } from '@airo-ux/pattern-library/input/choice-list'
import Button from '@ux/button'
import ArrowLeftIcon from '@ux/icon/arrow-left'
import ArrowRightIcon from '@ux/icon/arrow-right'

import StepProgressTag from '@/app/[market]/develop/components/chat/StepProgressTag'

interface Suggestion {
  text: string
  value?: string
  testId?: string
}

export interface AskQuestionChoiceQuestion {
  question: string
  subtitle?: string
  type?: 'chips_single' | 'chips_multi' | 'text'
  placeholder?: string
  suggestions: Suggestion[]
  allowOther?: boolean
  multiSelect?: boolean
  metadata?: Record<string, unknown>
}

interface AskQuestionChoicePanelProps {
  questions: AskQuestionChoiceQuestion[]
  allowOtherGlobal: boolean
  isInitialQuestionsFlow?: boolean
  rootOtherPlaceholder: string
  otherAriaLabel: string
  skipLabel?: string
  backLabel: string
  submitLabel: string
  disabled: boolean
  hideQuestion?: boolean
  ariaLabel: string
  selectByIndexRef?: RefObject<((index: number) => void) | null>
  onStepChange: (stepId: string, value: string | string[] | null) => void
  onActiveStepChange: (stepId: string, index: number) => void
  onStepProgressChange?: (current: number, total: number) => void
  onComplete: (selections: Record<string, string | string[] | null>) => void
}

function isMultiSelectQuestion(q: AskQuestionChoiceQuestion): boolean {
  if (q.type === 'chips_multi') return true
  if (q.type === 'chips_single' || q.type === 'text') return false
  return q.multiSelect === true
}

export function chipValue(index: number): string {
  return String(index + 1)
}

const REDUNDANT_TEXT_STEP_SUGGESTION = /^(i'?ll type it in|i'?ll share it with you|i'?ll type it)$/i

/** Drops chip labels that duplicate the freeform name field (typed in the Other row). */
export function filterRedundantTextStepSuggestions(suggestions: Suggestion[]): Suggestion[] {
  return suggestions.filter(s => !REDUNDANT_TEXT_STEP_SUGGESTION.test(s.text.trim()))
}

function restoreMultiStepSelection(
  saved: string[],
  knownIds: ReadonlySet<string>,
  allowOther: boolean,
): { checked: string[]; otherDraft: string; otherChecked: boolean } {
  if (!allowOther) {
    return {
      checked: saved.filter((id) => knownIds.has(id)),
      otherDraft: '',
      otherChecked: false,
    }
  }
  if (saved.length === 0) {
    return { checked: [], otherDraft: '', otherChecked: false }
  }
  const last = saved[saved.length - 1]
  if (last != null && !knownIds.has(last)) {
    return {
      checked: saved.slice(0, -1).filter((id) => knownIds.has(id)),
      otherDraft: last,
      otherChecked: true,
    }
  }
  return {
    checked: saved.filter((id) => knownIds.has(id)),
    otherDraft: '',
    otherChecked: false,
  }
}

function buildMultiCommitValue(
  checked: string[],
  allowOther: boolean,
  otherChecked: boolean,
  otherDraft: string,
): string[] {
  const values = [...checked]
  const trimmedOther = otherDraft.trim()
  if (allowOther && otherChecked && trimmedOther && !values.includes(trimmedOther)) {
    values.push(trimmedOther)
  }
  return values
}

export default function AskQuestionChoicePanel({
  questions,
  allowOtherGlobal,
  rootOtherPlaceholder,
  otherAriaLabel,
  skipLabel,
  backLabel,
  submitLabel,
  disabled,
  hideQuestion,
  ariaLabel,
  selectByIndexRef,
  onStepChange,
  onActiveStepChange,
  onStepProgressChange,
  onComplete,
}: AskQuestionChoicePanelProps) {
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [collected, setCollected] = useState<Record<string, string | string[] | null>>({})
  const [pendingMulti, setPendingMulti] = useState<string[]>([])
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({})
  const [otherCheckedByStep, setOtherCheckedByStep] = useState<Record<string, boolean>>({})
  const mountedStepRef = useRef<number | null>(null)

  const activeQuestion = questions[activeStepIndex]
  const stepId = String(activeStepIndex)
  const isTextStep = activeQuestion?.type === 'text'
  const isMulti = activeQuestion ? isMultiSelectQuestion(activeQuestion) : false
  const visibleSuggestions = activeQuestion?.suggestions ?? []
  const textStepSuggestions = isTextStep
    ? filterRedundantTextStepSuggestions(visibleSuggestions)
    : []
  const textStepAsChipAndOther = isTextStep && textStepSuggestions.length > 0
  const singleSelectSuggestions = textStepAsChipAndOther
    ? textStepSuggestions
    : visibleSuggestions
  const allowOtherForStep = allowOtherGlobal && activeQuestion?.allowOther !== false && !isTextStep
  const effectiveAllowOther = textStepAsChipAndOther || allowOtherForStep
  const otherPlaceholder = activeQuestion?.placeholder || rootOtherPlaceholder
  const otherDraft = otherDrafts[stepId] ?? ''
  const otherChecked = otherCheckedByStep[stepId] ?? false

  useEffect(() => {
    if (mountedStepRef.current === activeStepIndex) return
    mountedStepRef.current = activeStepIndex
    onActiveStepChange(stepId, activeStepIndex)
    onStepProgressChange?.(activeStepIndex + 1, questions.length)
  }, [activeStepIndex, onActiveStepChange, onStepProgressChange, questions.length, stepId])

  useEffect(function restoreStepOnIndexChange() {
    const q = questions[activeStepIndex]
    if (!q) return

    const id = String(activeStepIndex)
    const saved = collected[id]
    const stepIsText = q.type === 'text'
    const stepIsMulti = isMultiSelectQuestion(q)
    const stepTextSuggestions = stepIsText
      ? filterRedundantTextStepSuggestions(q.suggestions)
      : q.suggestions
    const knownIds = new Set(stepTextSuggestions.map((_, index) => chipValue(index)))

    if (saved == null) {
      setPendingMulti([])
      setOtherDrafts(prev => ({ ...prev, [id]: '' }))
      setOtherCheckedByStep(prev => ({ ...prev, [id]: false }))
      return
    }

    if (stepIsText && !(stepIsText && stepTextSuggestions.length > 0)) {
      setPendingMulti([])
      setOtherCheckedByStep(prev => ({ ...prev, [id]: false }))
      setOtherDrafts(prev => ({
        ...prev,
        [id]: typeof saved === 'string' ? saved : '',
      }))
      return
    }

    if (stepIsMulti && Array.isArray(saved)) {
      const restored = restoreMultiStepSelection(
        saved,
        knownIds,
        allowOtherGlobal && q.allowOther !== false,
      )
      setPendingMulti(restored.checked)
      setOtherDrafts(prev => ({ ...prev, [id]: restored.otherDraft }))
      setOtherCheckedByStep(prev => ({ ...prev, [id]: restored.otherChecked }))
      return
    }

    if (typeof saved === 'string') {
      const n = parseInt(saved, 10)
      if (/^\d+$/.test(saved) && n >= 1 && n <= stepTextSuggestions.length) {
        setOtherDrafts(prev => ({ ...prev, [id]: '' }))
      } else {
        setOtherDrafts(prev => ({ ...prev, [id]: saved }))
      }
      setPendingMulti([])
      setOtherCheckedByStep(prev => ({ ...prev, [id]: false }))
    }
  }, [activeStepIndex, allowOtherGlobal, collected])

  const canSubmit = (function canSubmit() {
    if (disabled || !activeQuestion) return false
    if (isTextStep && !textStepAsChipAndOther) {
      return otherDraft.trim().length > 0
    }
    if (isMulti) {
      return buildMultiCommitValue(pendingMulti, allowOtherForStep, otherChecked, otherDraft).length > 0
    }
    return false
  })()

  function commitStepValue(value: string | string[] | null) {
    const nextCollected = { ...collected, [stepId]: value }
    setCollected(nextCollected)
    onStepChange(stepId, value)

    if (activeStepIndex < questions.length - 1) {
      setActiveStepIndex(activeStepIndex + 1)
      return
    }
    onComplete(nextCollected)
  }

  function currentCommitValue(): string | string[] | null {
    const values = buildMultiCommitValue(pendingMulti, allowOtherForStep, otherChecked, otherDraft)
    return values.length > 0 ? values : null
  }

  function handleSubmit() {
    if (!canSubmit) return
    commitStepValue(currentCommitValue())
  }

  function handleSkip() {
    commitStepValue(null)
  }

  function handleBack() {
    if (disabled || activeStepIndex === 0) return
    const prevIndex = activeStepIndex - 1
    setCollected(prev => {
      const next = { ...prev }
      for (let i = activeStepIndex; i < questions.length; i++) {
        delete next[String(i)]
      }
      return next
    })
    setActiveStepIndex(prevIndex)
  }

  const handleMultiToggle = useCallback((value: string) => {
    setPendingMulti(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value],
    )
  }, [])

  function handleOtherChange(value: string) {
    setOtherDrafts(prev => ({ ...prev, [stepId]: value }))
  }

  const selectOptionByIndex = useCallback(
    (index: number) => {
      if (disabled || index < 0 || index >= singleSelectSuggestions.length) return
      const value = chipValue(index)
      if (isMulti) {
        handleMultiToggle(value)
        return
      }
      commitStepValue(value)
    },
    [
      disabled,
      handleMultiToggle,
      isMulti,
      singleSelectSuggestions.length,
    ],
  )

  useEffect(() => {
    if (!selectByIndexRef) return
    selectByIndexRef.current = selectOptionByIndex
    return () => {
      selectByIndexRef.current = null
    }
  }, [selectByIndexRef, selectOptionByIndex])

  const suggestionItems = singleSelectSuggestions.map((suggestion, index) => (
    <ChoiceList.Item key={index} value={chipValue(index)}>
      {suggestion.text}
    </ChoiceList.Item>
  ))

  const showFooterNav =
    isMulti || (!effectiveAllowOther && !isTextStep && (skipLabel || activeStepIndex > 0))

  const singleSelectInlineProps = {
    showOptionChevron: false as const,
    showOptionArrowOnHover: true as const,
    suppressLastRowBottomBorder: true as const,
    commitBehavior: 'immediate' as const,
    showDeferredFooter: false as const,
    ...(effectiveAllowOther
      ? {
          inlineSkipLabel: skipLabel,
          onInlineSkip: handleSkip,
          inlineBackLabel: activeStepIndex > 0 ? backLabel : undefined,
          onInlineBack: activeStepIndex > 0 ? handleBack : undefined,
          inlineBackTestId: 'ask-question-back',
          inlineSkipOrSubmit: true as const,
          otherSubmitTestId: 'ask-question-submit',
          inlineSkipTestId: 'ask-question-skip',
          otherSubmitLabel: submitLabel,
          showOtherSubmitButton: false as const,
        }
      : {}),
  }

  return (
    <div className="flex flex-col gap-2">
      {!hideQuestion && activeQuestion && (
        <div>
          <div className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
            <p className="text-sm font-medium">{activeQuestion.question}</p>
            {questions.length > 1 ? (
              <StepProgressTag current={activeStepIndex + 1} total={questions.length} />
            ) : null}
          </div>
          {activeQuestion.subtitle && (
            <p className="text-xs text-intents-ux-textSubtle-textColor mt-1">
              {activeQuestion.subtitle}
            </p>
          )}
        </div>
      )}

      {isTextStep && !textStepAsChipAndOther ? (
        <div className="airo-input-choice-list airo-input-choice-list__surface">
          <ChoiceListOtherRow
            letter="1"
            otherPlaceholder={otherPlaceholder}
            otherAriaLabel={otherAriaLabel}
            disabled={disabled}
            optionDividers={false}
            suppressBottomBorder
            draft={otherDraft}
            onDraftChange={handleOtherChange}
            onSubmit={(trimmed) => commitStepValue(trimmed)}
            submitLabel={submitLabel}
            inlineSkipLabel={skipLabel}
            onInlineSkip={handleSkip}
            inlineBackLabel={activeStepIndex > 0 ? backLabel : undefined}
            onInlineBack={activeStepIndex > 0 ? handleBack : undefined}
            inlineBackTestId="ask-question-back"
            inlineSkipOrSubmit
            submitTestId="ask-question-submit"
            inlineSkipTestId="ask-question-skip"
          />
        </div>
      ) : isMulti ? (
        <ChoiceList
          key={`multi-${activeStepIndex}`}
          ariaLabel={activeQuestion?.question ?? ariaLabel}
          selectionMode="multiple"
          allowOther={allowOtherForStep}
          showDeferredFooter={false}
          disabled={disabled}
          numberKeyShortcuts={false}
          otherPlaceholder={otherPlaceholder}
          otherAriaLabel={otherAriaLabel}
          otherDraft={otherDraft}
          onOtherDraftChange={handleOtherChange}
          checked={pendingMulti}
          onCheckedChange={setPendingMulti}
          otherChecked={otherChecked}
          onOtherCheckedChange={(checked) => {
            setOtherCheckedByStep(prev => ({ ...prev, [stepId]: checked }))
          }}
        >
          {suggestionItems}
        </ChoiceList>
      ) : (
        <ChoiceList
          key={`single-${activeStepIndex}`}
          ariaLabel={activeQuestion?.question ?? ariaLabel}
          allowOther={effectiveAllowOther}
          disabled={disabled}
          numberKeyShortcuts={false}
          otherPlaceholder={otherPlaceholder}
          otherAriaLabel={otherAriaLabel}
          otherDraft={otherDraft}
          onOtherDraftChange={handleOtherChange}
          onDecision={(value) => commitStepValue(value)}
          {...singleSelectInlineProps}
        >
          {suggestionItems}
        </ChoiceList>
      )}

      {showFooterNav ? (
        <div className="flex justify-end items-center gap-2 pt-1">
          {skipLabel ? (
            <Button
              design="control"
              size="sm"
              text={skipLabel}
              disabled={disabled}
              onClick={handleSkip}
              data-testid="ask-question-skip"
            />
          ) : null}
          {activeStepIndex > 0 ? (
            <Button
              design="control"
              size="sm"
              icon={<ArrowLeftIcon className="rtl:scale-x-[-1]" />}
              aria-label={backLabel}
              disabled={disabled}
              onClick={handleBack}
              data-testid="ask-question-back"
            />
          ) : null}
          {isMulti ? (
            <Button
              design="primary"
              size="sm"
              icon={<ArrowRightIcon className="rtl:scale-x-[-1]" />}
              aria-label={submitLabel}
              disabled={disabled || !canSubmit}
              onClick={handleSubmit}
              data-testid="ask-question-submit"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
