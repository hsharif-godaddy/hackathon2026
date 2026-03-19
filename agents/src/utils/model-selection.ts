/**
 * Model Selection Helper for Agents
 *
 * Provides intelligent model selection based on performance requirements
 * and available providers (Bedrock vs OpenAI)
 */

import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { LanguageModel } from 'ai'
import { wrapLanguageModel } from 'ai'
import { devToolsMiddleware } from '@ai-sdk/devtools'
import { getModel, getModelInfo } from '@airo/ai-lib'

import { logger } from '../logging/index.js'

/**
 * Check if DevTools should be enabled (development mode only)
 */
function isDevToolsEnabled(): boolean {
  const enableDevTools = process.env.ENABLE_AI_DEVTOOLS
  return enableDevTools === 'true' ||
    (process.env.NODE_ENV === 'development' && enableDevTools !== 'false')
}

export const DEVTOOLS_DB_MAX_BYTES = 5 * 1024 * 1024
let devToolsDbChecked = false

export function resetDevToolsCheck() {
  devToolsDbChecked = false
}

/**
 * Reset the devtools generations.json if it exceeds the size limit.
 * Must run before devToolsMiddleware() is created so the library's
 * in-memory cache loads the truncated (or empty) version.
 */
export async function truncateDevToolsDb(): Promise<void> {
  if (devToolsDbChecked) {return}

  const dbPath = path.join(process.cwd(), '.devtools', 'generations.json')

  let fileSize: number
  try {
    fileSize = (await stat(dbPath)).size
  } catch (error: unknown) {
    devToolsDbChecked = true
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return}

    logger.warn('devtools.db.stat.failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    return
  }

  if (fileSize <= DEVTOOLS_DB_MAX_BYTES) {
    devToolsDbChecked = true
    return
  }

  const sizeMB = parseFloat((fileSize / (1024 * 1024)).toFixed(1))
  logger.warn('devtools.db.truncate', {
    sizeMB,
    reason: 'generations.json exceeded 5MB limit, resetting to prevent OOM'
  })

  try {
    await writeFile(dbPath, JSON.stringify({ runs: [], steps: [] }, null, 2))
    logger.info('devtools.db.truncated', { previousSizeMB: sizeMB })
    devToolsDbChecked = true
  } catch (error: unknown) {
    logger.error('devtools.db.truncate.failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

/**
 * Wrap model with DevTools middleware when enabled
 */
async function wrapWithDevTools(model: LanguageModel): Promise<LanguageModel> {
  if (!isDevToolsEnabled()) {
    return model
  }

  try {
    await truncateDevToolsDb()
  } catch {
    logger.warn('devtools.skipped', {
      reason: 'Could not truncate oversized generations.json, skipping devtools to prevent OOM'
    })
    return model
  }

  logger.info('devtools.enabled', {
    message: 'AI SDK DevTools middleware enabled - view at http://localhost:4983'
  })

  // Type assertions required: @ai-sdk/devtools uses @ai-sdk/provider@3.0.1
  // while ai@6.0.0-beta uses @ai-sdk/provider@3.0.0-beta.25. The APIs are
  // compatible but TypeScript sees them as different types.
  return wrapLanguageModel({
    model: model as any,
    middleware: devToolsMiddleware() as any
  })
}

export type ModelTier = 'full' | 'fast'

/**
 * Model mappings for different tiers and providers
 */
const MODEL_MAPPINGS = {
  full: {
    // Always use Claude Sonnet for consistent experience
    bedrock: 'sonnet',            // Claude Sonnet (latest)
    openai: 'sonnet',             // Claude Sonnet through proxy/Anthropic
    fallback: 'sonnet'            // Always Claude Sonnet
  },
  fast: {
    // Always use Claude Sonnet for consistent experience
    bedrock: 'sonnet',             // Claude Sonnet (consistent experience)
    openai: 'sonnet',              // Claude Sonnet through proxy/Anthropic
    fallback: 'sonnet'             // Always Claude Sonnet
  }
} as const

/**
 * Check if Bedrock (AWS) is available by testing credentials
 */
async function isBedrockAvailable(): Promise<boolean> {
  try {
    // Check if AWS credentials are available
    const hasAwsCredentials = !!(
      process.env.AWS_ACCESS_KEY_ID || 
      process.env.AWS_PROFILE ||
      process.env.AWS_REGION
    )
    
    if (!hasAwsCredentials) {
      return false
    }
    
    // Test with a simple model info call - pass AWS region to force Bedrock provider detection
    const modelInfo = getModelInfo('sonnet', { awsRegion: process.env.AWS_REGION || 'us-east-1' })
    return modelInfo.provider === 'bedrock'
  } catch {
    return false
  }
}

/**
 * Check if Anthropic is available
 */
function isAnthropicAvailable(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY)
}

/**
 * Check if OpenAI is available
 */
function isOpenAIAvailable(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL)
}

/**
 * Get the model override from environment variable if set.
 * Use AI_MODEL_OVERRIDE to force a specific model for testing.
 */
export function getModelOverride(): string | null {
  return process.env.AI_MODEL_OVERRIDE || null
}

/**
 * Get the appropriate model for the specified tier
 * 
 * @param tier - 'full' for premium models, 'fast' for quick responses
 * @returns Promise<LanguageModel> - The selected model instance
 * 
 * @example
 * ```typescript
 * // For complex reasoning tasks
 * const fullModel = await getAgentModel('full')
 * 
 * // For quick responses
 * const fastModel = await getAgentModel('fast')
 * ```
 */
export async function getAgentModel(tier: ModelTier): Promise<LanguageModel> {
  const config = MODEL_MAPPINGS[tier]

  // Check for model override first (for testing new models)
  const overrideModel = getModelOverride()
  if (overrideModel) {
    logger.info('model.override.active', {
      overrideModel,
      tier,
      reason: 'AI_MODEL_OVERRIDE environment variable set'
    })

    try {
      const model = await getModel(overrideModel)
      const modelInfo = getModelInfo(overrideModel)
      logger.info('model.override.success', {
        tier,
        overrideModel,
        modelInfo: {
          shortName: modelInfo.shortName,
          fullName: modelInfo.fullName,
          provider: modelInfo.provider,
          usingProxy: modelInfo.usingProxy
        }
      })
      return await wrapWithDevTools(model)
    } catch (error) {
      logger.error('model.override.failure', {
        tier,
        overrideModel,
        error: error instanceof Error ? error.message : String(error)
      })
      throw new Error(`Failed to initialize override model '${overrideModel}'. Please check the model name and API credentials.`)
    }
  }

  // Check provider availability
  const bedrockAvailable = await isBedrockAvailable()
  const anthropicAvailable = isAnthropicAvailable()
  const openaiAvailable = isOpenAIAvailable()

  logger.info('model.selection.begin', {
    tier,
    providers: {
      bedrockAvailable,
      anthropicAvailable,
      openaiAvailable
    }
  })

  let selectedModel: string

  if (bedrockAvailable) {
    // Prefer Bedrock for better models and cost
    selectedModel = config.bedrock
    logger.info('model.provider.selected', {
      provider: 'bedrock',
      selectedModel,
      tier
    })
  } else if (anthropicAvailable) {
    // Second preference: Anthropic direct API
    selectedModel = config.bedrock // Use Claude models through Anthropic API
    logger.info('model.provider.selected', {
      provider: 'anthropic',
      selectedModel,
      tier
    })
  } else if (openaiAvailable) {
    // Fallback to OpenAI
    selectedModel = config.openai
    logger.info('model.provider.selected', {
      provider: 'openai',
      selectedModel,
      tier
    })
  } else {
    // Last resort - try fallback (may use proxy if configured)
    selectedModel = config.fallback
    logger.warn('model.provider.fallback', {
      selectedModel,
      tier,
      reason: 'no_providers_configured'
    })
  }
  
  try {
    const model = await getModel(selectedModel)

    // Log final model info
    const modelInfo = getModelInfo(selectedModel)
    logger.info('model.selection.success', {
      tier,
      selectedModel,
      modelInfo: {
        shortName: modelInfo.shortName,
        fullName: modelInfo.fullName,
        provider: modelInfo.provider,
        usingProxy: modelInfo.usingProxy
      }
    })

    return await wrapWithDevTools(model)
  } catch (error) {
    logger.error('model.selection.failure', {
      tier,
      selectedModel,
      error: error instanceof Error ? error.message : String(error)
    })
    throw new Error(`Failed to initialize ${tier} model. Please check your API credentials.`)
  }
}

/**
 * Get the appropriate model and model name for the specified tier
 * 
 * @param tier - 'full' for premium models, 'fast' for quick responses
 * @returns Promise<{model: LanguageModel, modelName: string}> - The selected model instance and name
 */
export async function getAgentModelWithName(tier: ModelTier): Promise<{model: any, modelName: string}> {
  const config = MODEL_MAPPINGS[tier]

  // Check for model override first (for testing new models)
  const overrideModel = getModelOverride()
  if (overrideModel) {
    logger.info('model.override.active', {
      overrideModel,
      tier,
      operation: 'with_name',
      reason: 'AI_MODEL_OVERRIDE environment variable set'
    })

    try {
      const model = await getModel(overrideModel)
      const modelInfo = getModelInfo(overrideModel)
      logger.info('model.override.success', {
        tier,
        overrideModel,
        operation: 'with_name',
        modelInfo: {
          shortName: modelInfo.shortName,
          fullName: modelInfo.fullName,
          provider: modelInfo.provider,
          usingProxy: modelInfo.usingProxy
        }
      })
      return { model: await wrapWithDevTools(model), modelName: overrideModel }
    } catch (error) {
      logger.error('model.override.failure', {
        tier,
        overrideModel,
        operation: 'with_name',
        error: error instanceof Error ? error.message : String(error)
      })
      throw new Error(`Failed to initialize override model '${overrideModel}'. Please check the model name and API credentials.`)
    }
  }

  // Check provider availability
  const bedrockAvailable = await isBedrockAvailable()
  const anthropicAvailable = isAnthropicAvailable()
  const openaiAvailable = isOpenAIAvailable()

  logger.info('model.selection.with_name.begin', {
    tier,
    providers: {
      bedrockAvailable,
      anthropicAvailable,
      openaiAvailable
    }
  })

  let selectedModel: string

  if (bedrockAvailable) {
    // Prefer Bedrock for better models and cost
    selectedModel = config.bedrock
    logger.info('model.provider.selected', {
      provider: 'bedrock',
      selectedModel,
      tier,
      operation: 'with_name'
    })
  } else if (anthropicAvailable) {
    // Second preference: Anthropic direct API
    selectedModel = config.bedrock // Use Claude models through Anthropic API
    logger.info('model.provider.selected', {
      provider: 'anthropic',
      selectedModel,
      tier,
      operation: 'with_name'
    })
  } else if (openaiAvailable) {
    // Fallback to OpenAI
    selectedModel = config.openai
    logger.info('model.provider.selected', {
      provider: 'openai',
      selectedModel,
      tier,
      operation: 'with_name'
    })
  } else {
    // Last resort - try fallback (may use proxy if configured)
    selectedModel = config.fallback
    logger.warn('model.provider.fallback', {
      selectedModel,
      tier,
      reason: 'no_providers_configured',
      operation: 'with_name'
    })
  }
  
  try {
    const model = await getModel(selectedModel)

    // Log final model info
    const modelInfo = getModelInfo(selectedModel)
    logger.info('model.selection.with_name.success', {
      tier,
      selectedModel,
      modelInfo: {
        shortName: modelInfo.shortName,
        fullName: modelInfo.fullName,
        provider: modelInfo.provider,
        usingProxy: modelInfo.usingProxy
      }
    })

    return { model: await wrapWithDevTools(model), modelName: selectedModel }
  } catch (error) {
    logger.error('model.selection.with_name.failure', {
      tier,
      selectedModel,
      error: error instanceof Error ? error.message : String(error)
    })
    throw new Error(`Failed to initialize ${tier} model. Please check your API credentials.`)
  }
}

/**
 * Get model recommendations for different use cases
 */
export function getModelRecommendations() {
  return {
    full: {
      description: 'Premium models for complex reasoning, coding, and analysis',
      models: {
        bedrock: 'Claude Sonnet 4 - Latest and most capable',
        openai: 'GPT-4o - High performance OpenAI model'
      },
      useCases: [
        'Complex code generation and debugging',
        'Advanced reasoning and analysis',
        'Multi-step problem solving',
        'Long-form content creation'
      ]
    },
    fast: {
      description: 'Fast models for quick responses and simple tasks',
      models: {
        bedrock: 'Claude 3.5 Haiku - Fast and efficient',
        openai: 'GPT-4o Mini - Cost-effective and quick'
      },
      useCases: [
        'Quick questions and answers',
        'Simple code snippets',
        'Fast text processing',
        'Real-time chat interactions'
      ]
    }
  }
}

/**
 * Validate model configuration and provide setup guidance
 */
export async function validateModelSetup() {
  const bedrockAvailable = await isBedrockAvailable()
  const anthropicAvailable = isAnthropicAvailable()
  const openaiAvailable = isOpenAIAvailable()
  const overrideModel = getModelOverride()

  const status = {
    bedrock: bedrockAvailable,
    anthropic: anthropicAvailable,
    openai: openaiAvailable,
    override: overrideModel,
    recommendations: [] as string[]
  }

  // Show override status first if active
  if (overrideModel) {
    status.recommendations.push(`🔧 Model override active: ${overrideModel} (via AI_MODEL_OVERRIDE)`)
  }

  const totalProviders = [bedrockAvailable, anthropicAvailable, openaiAvailable].filter(Boolean).length

  if (totalProviders === 0) {
    status.recommendations.push('❌ No AI providers configured. Run setup script to configure a provider.')
  } else if (totalProviders === 1) {
    if (bedrockAvailable) {
      status.recommendations.push('✅ Bedrock configured - optimal setup!')
      status.recommendations.push('💡 Consider adding Anthropic or OpenAI as backup.')
    } else if (anthropicAvailable) {
      status.recommendations.push('✅ Anthropic configured - good setup!')
      status.recommendations.push('💡 Consider adding AWS Bedrock for production.')
    } else {
      status.recommendations.push('✅ OpenAI configured - basic setup!')
      status.recommendations.push('💡 Consider adding AWS Bedrock or Anthropic for Claude models.')
    }
  } else {
    status.recommendations.push(`✅ ${totalProviders} providers available - excellent setup!`)
  }

  return status
}
