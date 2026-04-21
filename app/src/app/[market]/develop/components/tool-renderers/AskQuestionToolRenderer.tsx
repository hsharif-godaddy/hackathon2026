'use client'

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import * as Accordion from '@radix-ui/react-accordion'
import Box from '@ux/box'
import Text from '@ux/text'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import DefaultToolRenderer, { type DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import OptionButton from '@/app/[market]/develop/components/tool-renderers/OptionButton'
import OptionInput from '@/app/[market]/develop/components/tool-renderers/OptionInput'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'

const OTHER_VALUE = '__other__' as const

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
  isLastAssistantMessage
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [selectedValue, setSelectedValue] = useState<string>('')
  const [otherValue, setOtherValue] = useState('')
  const [furthestQuestionReached, setFurthestQuestionReached] = useState(0)

  useEffect(() => {
    setCurrentQuestionIndex(0)
    setAnswers([])
    setSelectedValue('')
    setOtherValue('')
    setFurthestQuestionReached(0)
  }, [result])

  // Track the furthest question we've reached
  useEffect(() => {
    if (currentQuestionIndex > furthestQuestionReached) {
      setFurthestQuestionReached(currentQuestionIndex)
    }
  }, [currentQuestionIndex, furthestQuestionReached])

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

  const isLastQuestion = currentQuestionIndex === totalQuestions - 1

  function submitAnswer(answer: string) {
    if (isProcessing || !sendUserMessage) return

    // Update or append answer depending on whether we're editing
    const newAnswers = [...answers]
    newAnswers[currentQuestionIndex] = answer

    setAnswers(newAnswers)
    setSelectedValue('')
    setOtherValue('')

    // Find next unanswered question
    let nextQuestionIndex = -1
    for (let i = 0; i < questions.length; i++) {
      if (!newAnswers[i]) {
        nextQuestionIndex = i
        break
      }
    }

    if (nextQuestionIndex === -1) {
      // All questions answered - send message
      setCurrentQuestionIndex(questions.length) // Mark as submitted

      const formattedMessage = questions
        .map((q, idx) => `${idx + 1}) ${q.question}\n${newAnswers[idx]}`)
        .filter((_, idx) => newAnswers[idx]) // Only include answered questions
        .join('\n\n')

      sendUserMessage(formattedMessage, { isActionRequest: true })
    } else {
      // Navigate to next unanswered question
      setCurrentQuestionIndex(nextQuestionIndex)
    }
  }

  function handleSuggestionClick(suggestion: Suggestion) {
    if (isProcessing) return
    const value = suggestion.value || suggestion.text
    submitAnswer(value)
  }

  function handleOtherChange(value: string) {
    setOtherValue(value)
    setSelectedValue(OTHER_VALUE)
  }

  function handleOtherFocus() {
    setSelectedValue(OTHER_VALUE)
  }

  function handleOtherKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      if (otherValue.trim()) {
        submitAnswer(otherValue.trim())
      }
    }
  }

  function handleOtherSubmit() {
    if (otherValue.trim()) {
      submitAnswer(otherValue.trim())
    }
  }

  function handleEditAnswer(questionIndex: number) {
    setCurrentQuestionIndex(questionIndex)

    const existingAnswer = answers[questionIndex]
    const question = questions[questionIndex]

    const matchingSuggestion = question.suggestions.find(
      s => (s.value || s.text) === existingAnswer || s.text === existingAnswer
    )

    if (matchingSuggestion) {
      setSelectedValue(matchingSuggestion.value || matchingSuggestion.text)
      setOtherValue('')
    } else {
      setSelectedValue(OTHER_VALUE)
      setOtherValue(existingAnswer)
    }
  }

  return (
    <Box gap="sm" className="my-1">
      <Accordion.Root
        type="single"
        value={`question-${currentQuestionIndex}`}
        onValueChange={(value) => {
          if (value.startsWith('question-')) {
            const idx = parseInt(value.replace('question-', ''), 10)
            if (!isNaN(idx) && idx < questions.length) {
              if (idx < answers.length) {
                // Editing a previous answer - load it
                handleEditAnswer(idx)
              } else {
                // Viewing a future question - just navigate to it
                setCurrentQuestionIndex(idx)
                setSelectedValue('')
                setOtherValue('')
              }
            }
          }
        }}
      >
        {questions.map((question, idx) => {
          const isAnswered = idx < answers.length
          const isCurrent = idx === currentQuestionIndex
          const answer = answers[idx]

          // Only show questions up to the furthest reached
          if (idx > furthestQuestionReached) {
            return null
          }

          return (
            <Accordion.Item
              key={idx}
              value={`question-${idx}`}
            >
              <Accordion.Header>
                <Accordion.Trigger
                  className="flex items-center justify-between w-full text-left text-sm hover:cursor-pointer"
                  disabled={isProcessing}
                >
                  <div className="flex-1 flex flex-col">
                    <Text.span text={question.question} size={-1} className="!font-medium" />
                    {isAnswered && <Text.span text={answer} size={-1} className="!italic" />}
                  </div>
                  <Text.div text={`${idx + 1} / ${totalQuestions}`} size={-2} className="!text-foreground/60" />
                </Accordion.Trigger>
              </Accordion.Header>

              <Accordion.Content forceMount asChild>
                <motion.div
                  initial={false}
                  animate={{
                    height: isCurrent ? 'auto' : 0,
                    opacity: isCurrent ? 1 : 0
                  }}
                  transition={{
                    duration: 0.3,
                    ease: [0.4, 0, 0.2, 1]
                  }}
                  style={{ overflow: 'hidden' }}
                  className="my-1"
                >
                  <div>
                    <fieldset>
                      <legend className="sr-only">{question.question}</legend>

                      <div role="radiogroup" className="flex flex-col gap-1">
                        {question.suggestions.map((suggestion, suggestionIdx) => {
                          const value = suggestion.value || suggestion.text
                          const isSelected = isCurrent && selectedValue === value

                          return (
                            <div key={suggestionIdx}>
                              <OptionButton
                                text={suggestion.text}
                                isSelected={isSelected}
                                isSelectable={true}
                                disabled={isProcessing}
                                onClick={() => handleSuggestionClick(suggestion)}
                              />
                            </div>
                          )
                        })}

                        {question.allowOther !== false && (
                          <OptionInput
                            value={isCurrent ? otherValue : ''}
                            isSelected={isCurrent && selectedValue === OTHER_VALUE}
                            disabled={isProcessing}
                            placeholder={t('builder_tools_askquestion_other_placeholder')}
                            ariaLabel={t('builder_tools_askquestion_other_aria_label')}
                            submitLabel={isLastQuestion ? t('builder_common_submit') : t('builder_common_next')}
                            onChange={handleOtherChange}
                            onFocus={handleOtherFocus}
                            onSubmit={handleOtherSubmit}
                            onKeyDown={handleOtherKeyDown}
                          />
                        )}
                      </div>
                    </fieldset>
                  </div>
                </motion.div>
              </Accordion.Content>
            </Accordion.Item>
          )
        })}
      </Accordion.Root>
    </Box>
  )
}
