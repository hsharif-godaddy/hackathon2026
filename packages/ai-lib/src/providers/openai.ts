/**
 * OpenAI provider utilities
 * Since @ai-sdk/openai is included as a dependency, we can provide easy helpers
 */

import { createOpenAI } from '@ai-sdk/openai'
import { EnvConfig } from '../utils/env-config.js'

/**
 * Create OpenAI provider with automatic environment configuration
 */
export function createOpenAIProvider(options?: {
  apiKey?: string
  baseURL?: string
  organization?: string
}) {
  const config = EnvConfig.getOpenAIConfig()
  
  const settings: any = {
    apiKey: options?.apiKey || config.apiKey || '',
    baseURL: options?.baseURL || config.baseURL,
  }
  
  if (options?.organization) {
    settings.organization = options.organization
  }
  
  return createOpenAI(settings)
}

/**
 * Get OpenAI model with automatic configuration
 */
export function getOpenAIModel(modelName?: string): any {
  const config = EnvConfig.getOpenAIConfig()
  const openaiProvider = createOpenAIProvider()
  
  return openaiProvider(modelName || config.model)
}

/**
 * Common OpenAI models for easy access
 */
export const openAIModels: any = {
  /** GPT-4o - Most capable model */
  gpt4o: () => getOpenAIModel('gpt-4o'),
  
  /** GPT-4o Mini - Cost-effective, fast model */
  gpt4oMini: () => getOpenAIModel('gpt-4o-mini'),
  
  /** GPT-3.5 Turbo - Legacy but reliable */
  gpt35Turbo: () => getOpenAIModel('gpt-3.5-turbo'),
  
  /** DALL-E 3 - Latest image generation model */
  dalle3: () => {
    const provider = createOpenAIProvider()
    return provider.imageModel('dall-e-3')
  },
  
  /** DALL-E 2 - Previous generation image model */
  dalle2: () => {
    const provider = createOpenAIProvider()
    return provider.imageModel('dall-e-2')
  },
  
  /** Custom model */
  custom: (modelName: string) => getOpenAIModel(modelName)
}

/**
 * Validate OpenAI configuration
 */
export function validateOpenAIConfig(): boolean {
  return EnvConfig.validateProvider('openai')
}

/**
 * Get OpenAI configuration status
 */
export function getOpenAIStatus() {
  const config = EnvConfig.getOpenAIConfig()
  const isValid = validateOpenAIConfig()
  
  return {
    isConfigured: isValid,
    hasApiKey: !!config.apiKey,
    baseURL: config.baseURL,
    defaultModel: config.model,
    config
  }
}
