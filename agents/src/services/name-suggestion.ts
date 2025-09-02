import { getLLMService, LLMMessage } from './llm.js';

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
      const llmService = getLLMService();

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: `You are an expert app name generator. Your task is to suggest a short, catchy, and appropriate name for an app based on the description provided. 
            - Generate general project name, not exactly title name
            - Name should be 1-3 words maximum
            - Use title case (capitalize first letter of each word)
            - Do not use quotes in your response
            - Avoid generic words like "App" or "Solution" if possible
            - Do not explain your choice or add any other text
            - Just return the name and nothing else`
        },
        {
          role: 'user',
          content: `Suggest a name for this app: ${prompt.trim()}`
        }
      ];

      // Send the request to the LLM service
      const response = await llmService.complete({
        messages,
        temperature: 0.7, 
        maxTokens: 50 
      });

      let suggestedName = response.content;
      if (suggestedName) {
        suggestedName = suggestedName.replace(/["""''.]/g, '').trim();
        
        if (suggestedName.length > 30) {
          suggestedName = suggestedName.substring(0, 30).trim();
        }
        
        console.log(`Name suggestion service generated name: "${suggestedName}" from prompt`);
        return suggestedName;
      }
      
      console.warn('Name suggestion returned empty content');
      return null;
    } catch (error) {
      console.error('Error in name suggestion service:', error);
      return null;
    }
  }
}

// Singleton instance
let nameSuggestionService: NameSuggestionService | null = null;
export function getNameSuggestionService(): NameSuggestionService {
  if (!nameSuggestionService) {
    nameSuggestionService = new NameSuggestionService();
  }
  return nameSuggestionService;
}
