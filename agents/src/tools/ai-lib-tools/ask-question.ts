import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'ask-question-tool' })

/**
 * Suggestion schema for question answers.
 * Accepts both plain strings and { text, value? } objects because LLMs
 * frequently simplify single-required-field objects to bare strings.
 */
export const suggestionObjectSchema = z.object({
  text: z.string().describe('The suggestion text to display'),
  value: z.string().optional().describe('Optional: different value to send vs display'),
  trackingId: z.string().optional().describe('Optional stable identifier emitted as recommendation_id when this suggestion is clicked. Use when a specific suggestion needs to be tracked across prompt edits or option reordering.')
})

export const suggestionSchema = z.union([
  z.string().transform(text => ({ text })),
  suggestionObjectSchema
]).describe(
  'Suggested answer, either a plain string (displayed and used as value) or an object { text, value? } when the value to send should differ from the displayed text'
)

/**
 * Input mode for a question. Optional; when omitted, legacy behavior applies
 * (suggestion buttons plus free-text input when allowOther is true).
 * - chips_single: single-select suggestion buttons, requires ≥1 suggestion
 * - chips_multi:  multi-select suggestion buttons, requires ≥1 suggestion
 * - text:         free-text input only, suggestions may be empty
 */
export const questionTypeSchema = z.enum(['chips_single', 'chips_multi', 'text'])

/**
 * Question schema
 *
 * `suggestions` requires at least 1 entry unless `type === 'text'`, in which
 * case the buttons grid is hidden and an empty array is allowed.
 */
export const questionSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  subtitle: z.string().optional().describe('Optional helper text rendered below the question'),
  type: questionTypeSchema.optional().describe('Optional input mode: chips_single, chips_multi, or text. When omitted, legacy rendering is used.'),
  placeholder: z.string().optional().describe('Optional placeholder for the free-text input'),
  suggestions: z.array(suggestionSchema).describe('Array of suggested answers'),
  allowOther: z.boolean().default(true).describe('Whether to show "Other" option for free text input'),
  multiSelect: z.boolean().default(false).describe('Whether to allow selecting multiple answers (checkboxes) or single answer (radio buttons)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata for tracking')
}).superRefine((q, ctx) => {
  if (q.type !== 'text' && q.suggestions.length < 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['suggestions'],
      message: 'Array of suggested answers must contain at least 1 entry unless type is "text"'
    })
  }
  // Reject an unanswerable step: no chips AND no freeform input.
  if (q.suggestions.length === 0 && q.allowOther === false) {
    ctx.addIssue({
      code: 'custom',
      path: ['allowOther'],
      message: 'A question with suggestions=[] requires allowOther=true — otherwise the step has no input mechanism and users can only skip'
    })
  }
  // `type` is authoritative when present; `multiSelect` must not contradict.
  // `{ type: "chips_single", multiSelect: true }` would render as multi-select
  // in legacy code paths and as single in the new renderer — reject the
  // ambiguity so callers pick one.
  if (q.type === 'chips_single' && q.multiSelect === true) {
    ctx.addIssue({
      code: 'custom',
      path: ['multiSelect'],
      message: 'type: "chips_single" is incompatible with multiSelect: true — pick type: "chips_multi" instead',
    })
  }
  if (q.type === 'text' && q.multiSelect === true) {
    ctx.addIssue({
      code: 'custom',
      path: ['multiSelect'],
      message: 'type: "text" is incompatible with multiSelect: true',
    })
  }
})

/**
 * Ask Question input schema
 */
export const askQuestionInputSchema = z.object({
  questions: z.array(questionSchema).min(1).max(10).describe('Array of questions to ask (minimum 1, maximum 10)')
}).superRefine((input, ctx) => {
  // `allowOther` is applied at the ChoiceList root (single prop for the whole
  // multi-step flow — there is no per-step equivalent in the current
  // components version). A mix of `true` and `false` across steps would
  // either let freeform leak onto authoritative-pick steps or make
  // free-text steps unanswerable, depending on which way the renderer
  // collapses. Reject mixed values at the tool boundary so callers must
  // commit to a single stance for the whole call.
  const allowOtherValues = new Set(input.questions.map(q => q.allowOther))
  if (allowOtherValues.size > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['questions'],
      message: 'All questions in one askQuestion call must share the same `allowOther` value — mixed values are not supported by the current renderer',
    })
  }
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

Use this instead of asking questions directly in your response text.

NEVER use this to ask about commerce intent before loading the commerce skill. For initial commerce/e-commerce/store/product/selling requests, load the commerce skill first — do not ask the user generic commerce questions first.

EXCEPTION: Use this tool to present concrete store or business choices returned by Commerce discovery/list tools. Pass each store/business name as a suggestion with multiSelect: false and allowOther: false so the user picks via option buttons.`,
  askQuestionInputSchema,
  async (input, context) => {
    const { questions } = input
    const appId = context?.metadata?.appId as string | undefined

    logger.info('ask-question.called', {
      appId,
      questionCount: questions.length,
      hasContext: !!context
    })

    return {
      success: true,
      widgetType: 'ask-question',
      widgetData: {
        type: 'ask-question',
        questions,
        currentQuestionIndex: 0,
        answers: []
      },
      message: `Asked ${questions.length} question${questions.length === 1 ? '' : 's'}`
    }
  }
)
