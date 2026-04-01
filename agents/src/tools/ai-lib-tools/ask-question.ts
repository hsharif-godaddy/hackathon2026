import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'ask-question-tool' })

/**
 * Suggestion schema for question answers
 */
const suggestionSchema = z.object({
  text: z.string().describe('The suggestion text to display'),
  value: z.string().optional().describe('Optional: different value to send vs display')
})

/**
 * Question schema
 */
const questionSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  suggestions: z.array(suggestionSchema).min(1).describe('Array of suggested answers (minimum 1)'),
  allowOther: z.boolean().default(true).describe('Whether to show "Other" option for free text input'),
  multiSelect: z.boolean().default(false).describe('Whether to allow selecting multiple answers (checkboxes) or single answer (radio buttons)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata for tracking')
})

/**
 * Ask Question input schema
 */
const askQuestionInputSchema = z.object({
  questions: z.array(questionSchema).min(1).max(10).describe('Array of questions to ask (minimum 1, maximum 10)')
})

/**
 * Ask Question Tool for AI-Lib
 *
 * Enables structured question-asking with suggested answers and "Other" option.
 * Supports multiple questions that are displayed sequentially in the UI.
 * Agent execution stops after calling this tool (no follow-up text).
 *
 * Use cases:
 * - Gathering personalization attributes in InitialAgent
 * - Offering choices with suggested options
 * - Asking multiple related questions efficiently
 */
export const askQuestionAITool: Tool = createTool(
  `Ask the user one or more questions with suggested answers.
Questions are displayed one at a time in the UI. Users can select a suggestion or provide their own answer.
The agent will receive all answers in a formatted response once the user completes all questions.

Use this instead of asking questions directly in your response text.`,
  askQuestionInputSchema,
  async (input, context) => {
    const { questions } = input
    const appId = context?.metadata?.appId as string | undefined

    logger.info('ask-question.called', {
      appId,
      questionCount: questions.length,
      hasContext: !!context
    })

    // Return structured data for frontend renderer
    return {
      success: true,
      widgetType: 'ask-question',
      widgetData: {
        questions,
        currentQuestionIndex: 0,
        answers: []
      },
      message: `Asked ${questions.length} question${questions.length === 1 ? '' : 's'}`
    }
  }
)
