import { getModel } from '@airo/ai-lib'
import { generateText } from 'ai'

export class NameSuggestionService {
  /**
   * Suggests an app name based on the initial app description prompt
   * @param prompt The user's initial prompt describing their app idea
   * @returns A suggested app name or null if generation fails
   */
  async suggestName(prompt: string): Promise<string | null> {
    try {
      if (!prompt || prompt.trim().length === 0) {
        console.warn('Empty prompt provided to NameSuggestionService.suggestName()');
        return null;
      }

      // Get the model using ai-lib's unified provider
      const model = await getModel('claude-haiku')

      // Generate name using AI
      const result = await generateText({
        model,
        system: `You are an expert app name generator. Your task is to suggest a short, catchy, and appropriate name for an app based on the description provided. 
          - Generate general project name, not exactly title name
          - Name should be 1-3 words maximum
          - Use title case (capitalize first letter of each word)
          - Do not use quotes in your response
          - Avoid generic words like "App" or "Solution" if possible
          - Do not explain your choice or add any other text
          - Just return the name and nothing else`,
        prompt: `Suggest a name for this app: ${prompt.trim()}`,
        temperature: 0.7,
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
        
        console.log(`Name suggestion service generated name: "${suggestedName}" from prompt`)
        return suggestedName
      }
      
      console.warn('Name suggestion returned empty content')
      return null
    } catch (error) {
      console.error('Error in name suggestion service:', error)
      return null
    }
  }
}

const nameSuggestionService = new NameSuggestionService();

export function getNameSuggestionService(): NameSuggestionService {
  return nameSuggestionService;
}