import { getModel } from '@airo/ai-lib'
import { generateText } from 'ai'
import { Logger, log } from '../logging/index.js'

const logger = Logger.create({ service: 'name-suggestion' })

export class NameSuggestionService {
  /**
   * Suggests an app name based on the initial app description prompt
   *
   * If the user has already specified a name in their prompt (e.g., "called TaskMaster"),
   * it will extract and use that name. Otherwise, it will generate a new appropriate name.
   *
   * @param prompt The user's initial prompt describing their app idea
   * @returns A suggested app name or null if generation fails
   */
  async suggestName(prompt: string): Promise<string | null> {
    try {
      if (!prompt || prompt.trim().length === 0) {
        logger.warn('name-suggestion.empty-prompt', {})
        return null;
      }

      // Get the model using ai-lib's unified provider
      const model = await getModel('haiku')

      // Generate name using AI
      const result = await generateText({
        model,
        system: `You are an expert app name generator. Your task is to suggest a short, catchy, and appropriate name for an app based on the description provided.

          IMPORTANT:
          - If the user has already mentioned a specific name in their prompt (like "called TaskMaster", "named TodoApp", "called MyProject"), extract and use EXACTLY that name
          - If no specific name is mentioned, then generate general project name, not exactly title name
          - Name should be 1-3 words maximum
          - Use title case (capitalize first letter of each word)
          - Do not use quotes in your response
          - Avoid generic words like "App" or "Solution" unless specifically mentioned
          - Do not explain your choice or add any other text
          - Just return the name and nothing else`,
        prompt: `Suggest a name for this app: ${prompt.trim()}`,
        temperature: 0.5,
        maxOutputTokens: 50
      })

      let suggestedName = result.text
      if (suggestedName) {
        // Clean up the response
        suggestedName = suggestedName.replace(/["""''.]/g, '').trim()

        // Limit length
        if (suggestedName.length > 30) {
          suggestedName = suggestedName.substring(0, 30).trim()
        }

        logger.info('name-suggestion.generated', {
          suggestedName,
          promptLength: prompt.length,
        })
        return suggestedName
      }

      logger.warn('name-suggestion.empty-content', {})
      return null
    } catch (error) {
      log.error(logger, 'name-suggestion.error', error as Error, {})
      return null
    }
  }
}

const nameSuggestionService = new NameSuggestionService();

export function getNameSuggestionService(): NameSuggestionService {
  return nameSuggestionService;
}
