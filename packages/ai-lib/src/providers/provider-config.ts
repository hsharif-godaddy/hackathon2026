import type { LanguageModel } from 'ai'

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  /** Provider type */
  type: 'openai' | 'anthropic' | 'bedrock' | 'custom'
  /** API key (if required) */
  apiKey?: string
  /** Base URL (for custom providers) */
  baseURL?: string
  /** Additional provider-specific options */
  options?: Record<string, any>
}

/**
 * Global provider registry
 */
class ProviderRegistry {
  private providers = new Map<string, () => LanguageModel>()
  private defaultProvider: (() => LanguageModel) | undefined = undefined

  /**
   * Register a provider factory function
   */
  register(name: string, factory: () => LanguageModel): void {
    this.providers.set(name, factory)
  }

  /**
   * Set the default provider
   */
  setDefault(factory: () => LanguageModel): void {
    this.defaultProvider = factory
    
    // Set AI SDK global provider
    if (typeof globalThis !== 'undefined') {
      ;(globalThis as any).AI_SDK_DEFAULT_PROVIDER = factory()
    }
  }

  /**
   * Get a provider by name
   */
  get(name: string): LanguageModel {
    const factory = this.providers.get(name)
    if (!factory) {
      throw new Error(`Provider '${name}' not found. Available providers: ${Array.from(this.providers.keys()).join(', ')}`)
    }
    return factory()
  }

  /**
   * Get the default provider
   */
  getDefault(): LanguageModel {
    if (!this.defaultProvider) {
      throw new Error('No default provider set. Call setDefault() first.')
    }
    return this.defaultProvider()
  }

  /**
   * Check if a provider is registered
   */
  has(name: string): boolean {
    return this.providers.has(name)
  }

  /**
   * List all registered providers
   */
  list(): string[] {
    return Array.from(this.providers.keys())
  }

  /**
   * Clear all providers
   */
  clear(): void {
    this.providers.clear()
    this.defaultProvider = undefined
  }
}

/**
 * Global provider registry instance
 */
export const providerRegistry = new ProviderRegistry()

/**
 * Configure a provider (helper function)
 */
export function configureProvider(name: string, config: ProviderConfig): void {
  let factory: () => LanguageModel

  switch (config.type) {
    case 'openai':
      factory = () => {
        // Direct import since @ai-sdk/openai is now a dependency
        const { createOpenAI } = require('@ai-sdk/openai')
        const openai = createOpenAI({
          apiKey: config.apiKey || process.env.OPENAI_API_KEY || '',
          baseURL: config.baseURL || process.env.OPENAI_BASE_URL,
          ...config.options
        })
        return openai(name)
      }
      break

    case 'anthropic':
      factory = () => {
        try {
          const { createAnthropic } = require('@ai-sdk/anthropic')
          const anthropic = createAnthropic({
            apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || '',
            baseURL: config.baseURL,
            ...config.options
          })
          return anthropic(name)
        } catch (error) {
          throw new Error(`Failed to create Anthropic provider: ${error}. Make sure @ai-sdk/anthropic is installed.`)
        }
      }
      break

    case 'bedrock':
      factory = () => {
        try {
          const { createAmazonBedrock } = require('@ai-sdk/amazon-bedrock')
          const bedrock = createAmazonBedrock({
            region: process.env.AWS_REGION || 'us-west-2',
            ...config.options
          })
          return bedrock(name)
        } catch (error) {
          throw new Error(`Failed to create Bedrock provider: ${error}. Make sure @ai-sdk/amazon-bedrock is installed.`)
        }
      }
      break

    case 'custom':
      if (!config.options?.factory) {
        throw new Error('Custom provider requires a factory function in options.factory')
      }
      factory = config.options.factory
      break

    default:
      throw new Error(`Unsupported provider type: ${config.type}`)
  }

  providerRegistry.register(name, factory)
}

/**
 * Set the global default provider
 */
export function setDefaultProvider(name: string, config: ProviderConfig): void {
  configureProvider(name, config)
  const factory = () => providerRegistry.get(name)
  providerRegistry.setDefault(factory)
}

/**
 * Get a model by string ID (uses provider registry)
 */
export function getModel(modelId: string): LanguageModel {
  // Check if it's a registered provider
  if (providerRegistry.has(modelId)) {
    return providerRegistry.get(modelId)
  }

    // Try to parse as provider/model format
    const parts = modelId.split('/')
    if (parts.length === 2) {
      const [providerName] = parts
      if (providerName && providerRegistry.has(providerName)) {
        // This is a simplification - in reality we'd need to handle model names properly
        return providerRegistry.get(providerName)
      }
    }

  // Fall back to default provider
  try {
    return providerRegistry.getDefault()
  } catch {
    throw new Error(`Model '${modelId}' not found and no default provider set`)
  }
}

/**
 * Quick setup functions for common providers
 */
export const providers = {
  openai: (apiKey?: string, options?: any) => 
    configureProvider('openai', { type: 'openai', apiKey: apiKey || '', options }),
    
  anthropic: (apiKey?: string, options?: any) => 
    configureProvider('anthropic', { type: 'anthropic', apiKey: apiKey || '', options }),
    
  bedrock: (region?: string, options?: any) => 
    configureProvider('bedrock', { type: 'bedrock', options: { region, ...options } })
}
