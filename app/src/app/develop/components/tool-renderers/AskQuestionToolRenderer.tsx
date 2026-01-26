'use client'

import { useEffect, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import TextInput from '@ux/text-input'

import { useSendUserMessage } from '@/app/develop/components/chat/ChatContext'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { useTranslations } from '@/hooks/useTranslations'

// Constant for "Other" option value
const OTHER_VALUE = '__other__' as const

interface Suggestion {
  text: string
  value?: string
}

interface Question {
  question: string
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

export default function AskQuestionToolRenderer({
  toolName: _toolName,
  toolStatus,
  result,
  isLastAssistantMessage
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  // Local state for question progression
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [selectedValue, setSelectedValue] = useState<string>('') // For single-select
  const [selectedValues, setSelectedValues] = useState<string[]>([]) // For multi-select
  const [otherValue, setOtherValue] = useState('')

  // Reset state when result changes (new tool invocation)
  useEffect(() => {
    setCurrentQuestionIndex(0)
    setAnswers([])
    setSelectedValue('')
    setSelectedValues([])
    setOtherValue('')
  }, [result])

  if (toolStatus !== 'completed' || !result) {
    return null
  }

  const resultObj = result as ToolResult
  const output = resultObj?.output || resultObj
  const widgetData = output?.widgetData

  if (!widgetData || !widgetData.questions || widgetData.questions.length === 0) {
    return null
  }

  const { questions } = widgetData
  const currentQuestion = questions[currentQuestionIndex]
  const totalQuestions = questions.length
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1
  const isMultiSelect = currentQuestion?.multiSelect === true
  const isSubmitted = currentQuestionIndex >= totalQuestions

  function handleSuggestionSelect(suggestion: Suggestion) {
    if (isProcessing) return
    const value = suggestion.value || suggestion.text

    if (isMultiSelect) {
      // Toggle value in multi-select mode
      setSelectedValues(prev =>
        prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
      )
    } else {
      // Replace value in single-select mode
      setSelectedValue(value)
    }
  }

  function handleOtherChange(value: string) {
    setOtherValue(value)
    if (isMultiSelect) {
      // In multi-select, add OTHER_VALUE when text is provided, remove when empty
      setSelectedValues(prev => {
        const hasOther = prev.includes(OTHER_VALUE)
        if (value.trim() && !hasOther) {
          return [...prev, OTHER_VALUE]
        } else if (!value.trim() && hasOther) {
          return prev.filter(v => v !== OTHER_VALUE)
        }
        return prev
      })
    } else {
      setSelectedValue(OTHER_VALUE)
    }
  }

  function handleOtherKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (canSubmit) {
        handleSubmit()
      }
    }
  }

  function handleSubmit() {
    if (isProcessing || !sendUserMessage) return

    let answer: string

    if (isMultiSelect) {
      // Multi-select mode: format multiple answers
      const values = [...selectedValues]

      // Replace OTHER_VALUE with actual other text
      const finalValues = values.map(v => v === OTHER_VALUE ? otherValue.trim() : v).filter(v => v)

      if (finalValues.length === 0) return
      answer = finalValues.join(', ')
    } else {
      // Single-select mode: single answer
      if (selectedValue === OTHER_VALUE) {
        if (!otherValue.trim()) return
        answer = otherValue.trim()
      } else {
        if (!selectedValue) return
        answer = selectedValue
      }
    }

    const newAnswers = [...answers, answer]
    setAnswers(newAnswers)

    // Always move to next question (or past the last one)
    setCurrentQuestionIndex(currentQuestionIndex + 1)
    setSelectedValue('')
    setSelectedValues([])
    setOtherValue('')

    if (isLastQuestion) {
      // All questions answered - send formatted message to agent after state update
      const formattedMessage = questions
        .map((q, idx) => `Question ${idx + 1}: ${q.question}\nAnswer: ${newAnswers[idx]}`)
        .join('\n\n')

      sendUserMessage(formattedMessage, { isActionRequest: true })
    }
  }

  const canSubmit = isMultiSelect
    ? selectedValues.length > 0 && (selectedValues.includes(OTHER_VALUE) ? otherValue.trim().length > 0 : true)
    : selectedValue === OTHER_VALUE ? otherValue.trim().length > 0 : selectedValue.length > 0

  function handleEditAnswer(questionIndex: number) {
    // Go back to that question to edit it
    setCurrentQuestionIndex(questionIndex)

    // Pre-populate the answer
    const existingAnswer = answers[questionIndex]
    const question = questions[questionIndex]

    if (question.multiSelect) {
      // Multi-select: parse comma-separated values
      const answerParts = existingAnswer.split(',').map(a => a.trim())
      const values: string[] = []
      let otherText = ''

      answerParts.forEach(part => {
        const matchingSuggestion = question.suggestions.find(
          s => (s.value || s.text) === part || s.text === part
        )

        if (matchingSuggestion) {
          values.push(matchingSuggestion.value || matchingSuggestion.text)
        } else {
          // It's an "Other" answer
          values.push(OTHER_VALUE)
          otherText = part
        }
      })

      setSelectedValues(values)
      setOtherValue(otherText)
      setSelectedValue('')
    } else {
      // Single-select: check if matches a suggestion
      const matchingSuggestion = question.suggestions.find(
        s => (s.value || s.text) === existingAnswer || s.text === existingAnswer
      )

      if (matchingSuggestion) {
        setSelectedValue(matchingSuggestion.value || matchingSuggestion.text)
        setOtherValue('')
      } else {
        // It's an "Other" answer
        setSelectedValue(OTHER_VALUE)
        setOtherValue(existingAnswer)
      }
      setSelectedValues([])
    }

    // Remove this answer and all subsequent answers
    setAnswers(answers.slice(0, questionIndex))
  }

  // Hide the component if:
  // 1. Questions have been submitted in current session (isSubmitted)
  // 2. This is not the last assistant message (user already responded when loading from history)
  if (isSubmitted || isLastAssistantMessage === false) {
    return null
  }

  return (
    <Box gap="sm" className="my-2">
      {/* Progress indicator */}
      {totalQuestions > 1 && currentQuestion && (
        <div className="text-xs text-intents-ux-textSubtle-textColor mb-0.5" role="status" aria-live="polite">
          {t('builder_tools_askquestion_progress', { current: currentQuestionIndex + 1, total: totalQuestions }, `Question ${currentQuestionIndex + 1} of ${totalQuestions}`)}
        </div>
      )}

      {/* Previously answered questions */}
      {answers.length > 0 && (
        <ul className="list-none space-y-0" role="list">
          {answers.map((answer, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => handleEditAnswer(idx)}
                disabled={isProcessing}
                aria-label={t('builder_tools_askquestion_edit_answer', { question: questions[idx].question }, `Edit answer for: ${questions[idx].question}`)}
                className="w-full flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor py-0.5 px-1 rounded hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                <span className="font-medium">{questions[idx].question}</span>
                <span className="text-intents-ux-textSubtle-textColor" aria-hidden="true">→</span>
                <span>{answer}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Current question */}
      {currentQuestion && (
        <>
          {/* Fieldset for semantic radio group */}
          <fieldset className="mb-1">
            <legend className="text-sm leading-relaxed break-words font-medium mb-1">
              {currentQuestion.question}
            </legend>

            {/* Compact radio/checkbox list */}
            <div className="space-y-0.5" {...(!isMultiSelect && { role: "radiogroup" })}>
              {currentQuestion.suggestions.map((suggestion, index) => {
                const value = suggestion.value || suggestion.text
                const isSelected = isMultiSelect
                  ? selectedValues.includes(value)
                  : selectedValue === value
                const inputId = `question-${currentQuestionIndex}-option-${index}`

                return (
                  <label
                    key={index}
                    htmlFor={inputId}
                    className="w-full flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors cursor-pointer"
                  >
                    <input
                      type={isMultiSelect ? "checkbox" : "radio"}
                      id={inputId}
                      name={`question-${currentQuestionIndex}`}
                      value={value}
                      checked={isSelected}
                      onChange={() => handleSuggestionSelect(suggestion)}
                      disabled={isProcessing}
                      className="sr-only"
                    />
                    <div className="flex-shrink-0" aria-hidden="true">
                      {isMultiSelect ? (
                        // Checkbox style
                        isSelected ? (
                          <div className="w-3 h-3 rounded border border-primary bg-primary flex items-center justify-center">
                            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-3 h-3 rounded border border-intents-ux-border-borderColor" />
                        )
                      ) : (
                        // Radio button style
                        isSelected ? (
                          <div className="w-3 h-3 rounded-full border border-primary flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                          </div>
                        ) : (
                          <div className="w-3 h-3 rounded-full border border-intents-ux-border-borderColor" />
                        )
                      )}
                    </div>
                    <span className="text-xs">{suggestion.text}</span>
                  </label>
                )
              })}

              {/* Other option - always visible */}
              {currentQuestion.allowOther !== false && (
                <div className="flex items-center gap-1.5 px-1 py-0.5">
                  <label
                    htmlFor={`question-${currentQuestionIndex}-other-input`}
                    className="flex-shrink-0 cursor-pointer"
                  >
                    <input
                      type={isMultiSelect ? "checkbox" : "radio"}
                      id={`question-${currentQuestionIndex}-other-input`}
                      name={`question-${currentQuestionIndex}`}
                      value={OTHER_VALUE}
                      checked={isMultiSelect
                        ? selectedValues.includes(OTHER_VALUE) || otherValue.trim().length > 0
                        : selectedValue === OTHER_VALUE}
                      onChange={() => {
                        if (isMultiSelect) {
                          setSelectedValues(prev => {
                            const hasOther = prev.includes(OTHER_VALUE)
                            if (hasOther) {
                              // Unchecking: clear text and remove from array
                              setOtherValue('')
                              return prev.filter(v => v !== OTHER_VALUE)
                            } else {
                              // Checking: add to array (text can be added later)
                              return [...prev, OTHER_VALUE]
                            }
                          })
                        } else {
                          setSelectedValue(OTHER_VALUE)
                        }
                      }}
                      disabled={isProcessing}
                      className="sr-only"
                    />
                    <div aria-hidden="true">
                      {isMultiSelect ? (
                        // Checkbox style for Other
                        (selectedValues.includes(OTHER_VALUE) || otherValue.trim().length > 0) ? (
                          <div className="w-3 h-3 rounded border border-primary bg-primary flex items-center justify-center">
                            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-3 h-3 rounded border border-intents-ux-border-borderColor" />
                        )
                      ) : (
                        // Radio button style for Other
                        selectedValue === OTHER_VALUE ? (
                          <div className="w-3 h-3 rounded-full border border-primary flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                          </div>
                        ) : (
                          <div className="w-3 h-3 rounded-full border border-intents-ux-border-borderColor" />
                        )
                      )}
                    </div>
                    <span className="sr-only">{t('builder_tools_askquestion_other_label', undefined, 'Other (type your answer)')}</span>
                  </label>
                  <div className="flex-1">
                    <TextInput
                      value={otherValue}
                      onChange={handleOtherChange}
                      onKeyDown={handleOtherKeyDown}
                      placeholder={t('builder_tools_askquestion_other_placeholder', undefined, 'Other...')}
                      disabled={isProcessing}
                      visualSize="sm"
                      label={null}
                      aria-label={t('builder_tools_askquestion_other_aria_label', undefined, 'Other answer')}
                    />
                  </div>
                </div>
              )}
            </div>
          </fieldset>

          {/* Submit/Next button */}
          <div className="flex justify-end">
            <Button
              text={isLastQuestion
                ? t('builder_common_submit', undefined, 'Submit')
                : t('builder_common_next', undefined, 'Next')}
              design="primary"
              size="sm"
              disabled={isProcessing || !canSubmit}
              onClick={handleSubmit}
            />
          </div>
        </>
      )}
    </Box>
  )
}
