'use client'

import { useEffect,useState } from 'react'
import Box from '@ux/box'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import OptionButton from '@/app/[market]/develop/components/tool-renderers/OptionButton'
import OptionInput from '@/app/[market]/develop/components/tool-renderers/OptionInput'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { logAiroHQEvent } from '@/utils/instrumentation'

interface Suggestion {
  text: string
  value?: string
}

interface Question {
  question: string
  suggestions: Suggestion[]
  allowOther?: boolean
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
  toolName,
  toolStatus,
  input,
  result,
  error,
  isLastAssistantMessage,
  onComplete,
  hideQuestion,
}: DefaultToolRendererProps & { onComplete?: () => void; hideQuestion?: boolean }) {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [otherValue, setOtherValue] = useState('')
  const [isOtherFocused, setIsOtherFocused] = useState(false)

  useEffect(() => {
    setCurrentQuestionIndex(0)
    setAnswers([])
    setOtherValue('')
    setIsOtherFocused(false)
  }, [result])

  const parsedQuestions = ((result as any)?.output ?? result as any)?.widgetData?.questions as unknown[] | undefined
  const totalQuestionsForHooks = parsedQuestions?.length ?? 0
  const isSubmittedForHooks = totalQuestionsForHooks > 0 && currentQuestionIndex >= totalQuestionsForHooks

  useEffect(() => {
    if (toolStatus !== 'completed' || !result || isLastAssistantMessage === false) return
    if (!parsedQuestions || currentQuestionIndex >= parsedQuestions.length) return
    logAiroHQEvent({
      category: 'impression',
      recommendation_task: 'builder_askquestion_shown',
      recommendation_type: 'askquestion_question',
      recommendation_id: `q${currentQuestionIndex}`,
    })()
  }, [currentQuestionIndex, toolStatus, result, isLastAssistantMessage])

  useEffect(() => {
    if (isSubmittedForHooks && onComplete) onComplete()
  }, [isSubmittedForHooks, onComplete])

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
  const totalQuestions = questions.length
  const isSubmitted = currentQuestionIndex >= totalQuestions

  if (isSubmitted || isLastAssistantMessage === false) {
    return null
  }

  const currentQuestion = questions[currentQuestionIndex]
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1

  function submitAnswer(answer: string) {
    if (isProcessing || !sendUserMessage) return

    const newAnswers = [...answers]
    newAnswers[currentQuestionIndex] = answer
    setAnswers(newAnswers)
    setOtherValue('')
    setIsOtherFocused(false)

    if (isLastQuestion) {
      setCurrentQuestionIndex(totalQuestions)

      if (totalQuestions === 1) {
        sendUserMessage(answer, { isActionRequest: true })
      } else {
        const formattedMessage = questions
          .map((q, idx) => `${idx + 1}) ${q.question}\n${newAnswers[idx]}`)
          .filter((_, idx) => newAnswers[idx])
          .join('\n\n')
        sendUserMessage(formattedMessage, { isActionRequest: true })
      }
    } else {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
    }
  }

  function handleSuggestionClick(suggestion: Suggestion, suggestionIndex: number) {
    if (isProcessing) return
    logAiroHQEvent({
      category: 'click',
      recommendation_task: 'builder_askquestion_suggestion_click',
      recommendation_type: 'askquestion_suggestion',
      recommendation_id: `q${currentQuestionIndex}_s${suggestionIndex}`,
    })()
    submitAnswer(suggestion.value || suggestion.text)
  }

  function handleOtherSubmit() {
    if (!otherValue.trim()) return
    logAiroHQEvent({
      category: 'click',
      recommendation_task: 'builder_askquestion_other_submit',
      recommendation_type: 'askquestion_other',
      recommendation_id: `q${currentQuestionIndex}`,
    })()
    submitAnswer(otherValue.trim())
  }

  function handleOtherKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      handleOtherSubmit()
    }
  }

  return (
    <Box gap="sm" className="my-2">
      {!hideQuestion && (
        <div className="text-sm font-medium leading-relaxed break-words mb-1">
          {totalQuestions > 1 && (
            <span className="text-xs text-intents-ux-textSubtle-textColor mr-1">
              {currentQuestionIndex + 1}/{totalQuestions}
            </span>
          )}
          {currentQuestion.question}
        </div>
      )}

      <Box orientation="vertical" gap="sm">
        {currentQuestion.suggestions.map((suggestion, index) => (
          <OptionButton
            key={index}
            text={suggestion.text}
            disabled={isProcessing}
            onClick={() => handleSuggestionClick(suggestion, index)}
            animationDelay={index * 0.2}
            isSelectable={true}
          />
        ))}

        {currentQuestion.allowOther !== false && (
          <OptionInput
            value={otherValue}
            isSelected={isOtherFocused}
            disabled={isProcessing}
            placeholder={t('builder_tools_askquestion_other_placeholder')}
            ariaLabel={t('builder_tools_askquestion_other_aria_label')}
            submitLabel={isLastQuestion ? t('builder_common_submit') : t('builder_common_next')}
            onChange={(value) => { setOtherValue(value); setIsOtherFocused(true) }}
            onFocus={() => setIsOtherFocused(true)}
            onSubmit={handleOtherSubmit}
            onKeyDown={handleOtherKeyDown}
          />
        )}
      </Box>

    </Box>
  )
}
