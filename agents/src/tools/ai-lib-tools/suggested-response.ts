import { createTool } from '@airo/ai-lib'
import { z } from 'zod'

import { TodoListRepository } from '../../database/repositories/TodoListRepository.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'suggested-response-tool' })
const todoListRepo = new TodoListRepository()

/**
 * Suggestion schema
 */
const suggestionSchema = z.object({
  text: z.string().describe('The suggestion text to display on the button'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata for the suggestion')
})

/**
 * Suggested response input schema
 */
const suggestedResponseInputSchema = z.object({
  question: z.string().describe('The question or prompt to ask the user'),
  suggestions: z.array(suggestionSchema).min(1).max(10).describe('Array of suggestions (minimum 1, maximum 10)')
})

/**
 * Suggested Response Tool for AI-Lib
 *
 * Ends a conversation with a question and suggested responses.
 * Displays interactive buttons that users can click to quickly respond.
 */
export const suggestedResponseAITool = createTool(
  `End your response with a question and suggested answers.
Use this when you want to give the user quick options to respond with.
The suggestions will be displayed as clickable buttons below your question.

Guidelines for good suggestions:
- Only call this tool when you have genuinely useful next steps to offer.
- Keep suggestions tightly relevant to what the user just asked or the current
  state of the app — avoid generic or unrelated options.
- Prefer 2–3 short, specific, actionable suggestions. No minimum — skip this
  tool entirely if there are no good non-plan suggestions.
- Do not suggest actions that simply repeat the user's previous request.
- NEVER duplicate or rephrase uncompleted todo list items. The user already
  sees those in the plan panel. For example, do not suggest "Let's build the
  about page" if "About page" is an uncompleted plan item.
- Focus on the current task: design tweaks, feedback requests, refinements
  to what was just built, or cross-cutting concerns (fonts, colors, SEO).

Example use cases:
- Offering multiple options for the user to choose from
- Providing common follow-up actions
- Guiding the user through a decision tree
`,
  suggestedResponseInputSchema,
  async (input, context) => {
    const { question, suggestions } = input
    const appId = context?.metadata?.appId as string
    
    logger.info('suggested-response.called', {
      appId,
      suggestionCount: suggestions.length
    })

    // Check for pending todo items that should be marked done.
    // The LLM sees this reminder in the tool result and calls mark_done itself.
    let todoReminder = ''
    try {
      const sessionId = context?.metadata?.sessionId as string
      const stateManager = context?.metadata?.stateManager as { getSelectedTodoList: (id: string) => string | undefined } | undefined
      if (sessionId && stateManager?.getSelectedTodoList) {
        const selectedListId = stateManager.getSelectedTodoList(sessionId)
        if (selectedListId) {
          const list = todoListRepo.getListById(selectedListId)
          const pendingItems = list && list.appId === appId
            ? list.items?.filter(item => !item.completed) || []
            : []
          if (pendingItems.length > 0) {
            const itemList = pendingItems
              .map(item => `- "${item.title.replace(/[\n\r]/g, ' ')}" (ID: ${item.id})`)
              .join('\n')
            todoReminder = `\n\nACTION REQUIRED: You have uncompleted todo items. If you finished any of these, call todoList with operation "mark_done" and the item ID(s) NOW before ending your turn:\n${itemList}`
            logger.info('suggested-response.todo-reminder-injected', {
              appId,
              pendingCount: pendingItems.length,
            })
          }
        }
      }
    } catch (error) {
      logger.warn('suggested-response.todo-check-failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Build message in one place
    let message = `Suggested response rendered with ${suggestions.length} option${suggestions.length === 1 ? '' : 's'}`
    if (todoReminder) {
      message += todoReminder
    }

    return {
      success: true,
      widgetType: 'suggested-response',
      widgetData: {
        type: 'suggested-response',
        question,
        suggestions
      },
      message
    }
  }
)
