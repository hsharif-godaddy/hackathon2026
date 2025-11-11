import { createTool } from '@airo/ai-lib'
import { z } from 'zod'

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

Example use cases:
- Offering multiple options for the user to choose from
- Providing common follow-up actions
- Guiding the user through a decision tree
`,
  suggestedResponseInputSchema,
  async (input) => {
    const { question, suggestions } = input
    
    // Input is already validated by Zod schema
    
    // Return structured data that will be handled by the frontend
    // The WebSocket server will transform this into a widget segment
    return {
      success: true,
      widgetType: 'suggested-response',
      widgetData: {
        type: 'suggested-response',
        question,
        suggestions
      },
      message: `Suggested response rendered with ${suggestions.length} option${suggestions.length === 1 ? '' : 's'}`
    }
  }
)
