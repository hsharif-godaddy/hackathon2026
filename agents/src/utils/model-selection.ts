/**
 * Model Selection Helper for Agents
 * 
 * Provides intelligent model selection based on performance requirements
 * and available providers (Bedrock vs OpenAI)
 */

import { getModel, getModelInfo } from '@airo/ai-lib'

export type ModelTier = 'full' | 'fast'

/**
 * Model mappings for different tiers and providers
 */
const MODEL_MAPPINGS = {
  full: {
    // Always use Claude 4 for consistent experience
    bedrock: 'claude4',           // Claude Sonnet 4 (latest)
    openai: 'claude4',            // Claude 4 through proxy/Anthropic
    fallback: 'claude4'           // Always Claude 4
  },
  fast: {
    // Always use Claude 4 for consistent experience
    bedrock: 'claude4',           // Claude 4 (consistent experience)
    openai: 'claude4',            // Claude 4 through proxy/Anthropic
    fallback: 'claude4'           // Always Claude 4
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
    
    // Test with a simple model info call
    const modelInfo = getModelInfo('claude4')
    return modelInfo.provider === 'bedrock' && !modelInfo.usingProxy
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
export async function getAgentModel(tier: ModelTier) {
  const config = MODEL_MAPPINGS[tier]
  
  // Check provider availability
  const bedrockAvailable = await isBedrockAvailable()
  const anthropicAvailable = isAnthropicAvailable()
  const openaiAvailable = isOpenAIAvailable()
  
  console.log(`🤖 Selecting ${tier} model...`)
  console.log(`   Bedrock available: ${bedrockAvailable}`)
  console.log(`   Anthropic available: ${anthropicAvailable}`)
  console.log(`   OpenAI available: ${openaiAvailable}`)
  
  let selectedModel: string
  
  if (bedrockAvailable) {
    // Prefer Bedrock for better models and cost
    selectedModel = config.bedrock
    console.log(`   ✅ Using Bedrock model: ${selectedModel}`)
  } else if (anthropicAvailable) {
    // Second preference: Anthropic direct API
    selectedModel = config.bedrock // Use Claude models through Anthropic API
    console.log(`   ✅ Using Anthropic API model: ${selectedModel}`)
  } else if (openaiAvailable) {
    // Fallback to OpenAI
    selectedModel = config.openai
    console.log(`   ✅ Using OpenAI model: ${selectedModel}`)
  } else {
    // Last resort - try fallback (may use proxy if configured)
    selectedModel = config.fallback
    console.log(`   ⚠️  No providers configured, using fallback: ${selectedModel}`)
  }
  
  try {
    const model = await getModel(selectedModel)
    
    // Log final model info
    const modelInfo = getModelInfo(selectedModel)
    console.log(`   📊 Final model: ${modelInfo.fullName} (${modelInfo.provider}${modelInfo.usingProxy ? ' via proxy' : ''})`)
    
    return model
  } catch (error) {
    console.error(`❌ Failed to load model ${selectedModel}:`, error)
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
  
  const status = {
    bedrock: bedrockAvailable,
    anthropic: anthropicAvailable,
    openai: openaiAvailable,
    recommendations: [] as string[]
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
