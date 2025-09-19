/**
 * Unified Provider Helper
 * 
 * Single provider function that handles both OpenAI and Bedrock with short names,
 * automatic environment variable validation, and proxy support.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { LanguageModel } from 'ai'

const claude4 = 'global.anthropic.claude-sonnet-4-20250514-v1:0'
const claude35 = 'us.anthropic.claude-3-5-sonnet-20240620-v1:0'
const claude3haiku = 'us.anthropic.claude-3-5-haiku-20241022-v1:0'

/**
 * Claude models that can be routed through OpenAI proxy
 * Maps short names to their OpenAI proxy model identifiers
 */
const CLAUDE_PROXY_MODELS = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude4': 'claude-sonnet-4-20250514',
  'sonnet4': 'claude-sonnet-4-20250514',
  'claude-haiku': 'claude-3-5-haiku-20241022',
  'haiku': 'claude-3-5-haiku-20241022',
} as const

/**
 * Model short name mappings to full model identifiers
 */
const MODEL_MAPPINGS = {
  // OpenAI Models
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'gpt-4': 'gpt-4',
  'gpt-3.5-turbo': 'gpt-3.5-turbo',
  
  // Short aliases for OpenAI
  'gpt4o': 'gpt-4o',
  'gpt4o-mini': 'gpt-4o-mini',
  'gpt4': 'gpt-4',
  'gpt35': 'gpt-3.5-turbo',
  
  // Bedrock Claude Models
  'claude-3-haiku': claude3haiku,
  'claude-3.5-sonnet': claude35,
  'claude-sonnet-4': claude4,
  
  // Short aliases for Bedrock Claude
  'claude3-haiku': claude3haiku,
  'claude-haiku': claude3haiku,
  'claude35-sonnet': claude35,
  'claude4': claude4,
  'sonnet4': claude4,
  'haiku': claude3haiku,
  'sonnet': claude35,
} as const

type ModelShortName = keyof typeof MODEL_MAPPINGS

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  /** OpenAI API key override */
  openaiApiKey?: string
  /** OpenAI base URL override (for proxy) */
  openaiBaseUrl?: string
  /** AWS region override */
  awsRegion?: string
  /** AWS access key override */
  awsAccessKeyId?: string
  /** AWS secret key override */
  awsSecretAccessKey?: string
  /** AWS session token override */
  awsSessionToken?: string
  /** AWS profile override */
  awsProfile?: string
}

/**
 * Validate OpenAI configuration
 */
function validateOpenAIConfig(config?: ProviderConfig): void {
  const apiKey = config?.openaiApiKey || process.env.OPENAI_API_KEY
  
  if (!apiKey) {
    throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass openaiApiKey in config.')
  }
}

/**
 * Check if AWS credentials are available
 */
function hasAWSCredentials(config?: ProviderConfig): boolean {
  // Check for explicit credentials
  const hasExplicitCredentials = !!(config?.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID) &&
                                !!(config?.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY)
  
  // Check for AWS profile
  const hasProfile = !!(config?.awsProfile || process.env.AWS_PROFILE)
  
  // Check for any AWS environment variables that indicate AWS setup
  const hasAWSEnvVars = !!(process.env.AWS_REGION || 
                          process.env.AWS_DEFAULT_REGION ||
                          process.env.AWS_SESSION_TOKEN ||
                          process.env.AWS_ROLE_ARN ||
                          process.env.AWS_WEB_IDENTITY_TOKEN_FILE)
  
  return hasExplicitCredentials || hasProfile || hasAWSEnvVars
}

/**
 * Check if a Claude model should be routed through OpenAI proxy
 */
function shouldUseClaudeProxy(modelName: string, config?: ProviderConfig): boolean {
  // Check if model is in our Claude proxy list
  const isClaudeProxyModel = modelName in CLAUDE_PROXY_MODELS
  if (!isClaudeProxyModel) {
    return false
  }
  
  // Check if AWS credentials are NOT available
  const hasAWS = hasAWSCredentials(config)
  if (hasAWS) {
    return false
  }
  
  // Check if OpenAI base URL is set (proxy available)
  const hasOpenAIProxy = !!(config?.openaiBaseUrl || process.env.OPENAI_BASE_URL)
  if (!hasOpenAIProxy) {
    return false
  }
  
  return true
}

/**
 * Validate Bedrock configuration
 */
function validateBedrockConfig(config?: ProviderConfig): void {
  // Check for explicit credentials or AWS profile
  const hasExplicitCredentials = (config?.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID) &&
                                (config?.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY)
  
  const hasProfile = config?.awsProfile || process.env.AWS_PROFILE
  const hasRegion = config?.awsRegion || process.env.AWS_REGION
  
  if (!hasExplicitCredentials && !hasProfile) {
    throw new Error(`AWS credentials are required for Bedrock. Either:
1. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables
2. Set AWS_PROFILE environment variable
3. Configure AWS CLI with 'aws configure'
4. Pass awsAccessKeyId/awsSecretAccessKey in config`)
  }
  
  // Only warn about region if no profile is configured (profile can provide region)
  if (!hasRegion && !hasProfile) {
    console.warn('⚠️  No AWS region specified and no profile configured. Using default: us-east-1')
  }
}

/**
 * Determine provider type from model name, considering proxy routing
 */
function getProviderType(modelName: string, config?: ProviderConfig): 'openai' | 'bedrock' {
  // Check if this Claude model should be routed through OpenAI proxy
  if (shouldUseClaudeProxy(modelName, config)) {
    return 'openai'
  }
  
  const fullModelName = MODEL_MAPPINGS[modelName as ModelShortName] || modelName
  
  // Check if it's a Bedrock model
  if (fullModelName.includes('anthropic.') || 
      fullModelName.includes('amazon.') || 
      fullModelName.includes('stability.') ||
      fullModelName.includes('cohere.') ||
      fullModelName.includes('global.')) {
    return 'bedrock'
  }
  
  // Default to OpenAI
  return 'openai'
}

/**
 * Create OpenAI provider with configuration
 */
function createOpenAIProvider(config?: ProviderConfig) {
  const openaiConfig: any = {
    apiKey: config?.openaiApiKey || process.env.OPENAI_API_KEY || ''
  }
  
  // Add base URL if provided (for proxy support)
  const baseURL = config?.openaiBaseUrl || process.env.OPENAI_BASE_URL
  if (baseURL) {
    openaiConfig.baseURL = baseURL
  }
  
  return createOpenAI(openaiConfig)
}

/**
 * Create Bedrock provider with configuration
 */
async function createBedrockProvider(config?: ProviderConfig) {
  // Only set region if explicitly provided
  // Let AWS SDK handle region resolution from profiles automatically
  const bedrockConfig: any = {}
  
  const explicitRegion = config?.awsRegion || process.env.AWS_REGION
  const hasProfile = config?.awsProfile || process.env.AWS_PROFILE
  
  if (explicitRegion) {
    // Use explicit region if provided
    bedrockConfig.region = explicitRegion
  } else if (!hasProfile) {
    // Only set default region if no profile is configured
    bedrockConfig.region = 'us-east-1'
    console.warn('⚠️  No AWS region specified and no profile configured. Using default: us-east-1')
  }
  // If profile is configured but no explicit region, don't set region
  // Let AWS SDK resolve region from profile configuration
  
  // Check if explicit credentials are provided
  const hasExplicitCredentials = (config?.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID) &&
                                (config?.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY)
  
  if (hasExplicitCredentials) {
    // Use explicit credentials
    bedrockConfig.accessKeyId = config?.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID
    bedrockConfig.secretAccessKey = config?.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY
    
    if (config?.awsSessionToken || process.env.AWS_SESSION_TOKEN) {
      bedrockConfig.sessionToken = config?.awsSessionToken || process.env.AWS_SESSION_TOKEN
    }
  } else {
    // Use AWS credential provider chain (supports profiles, IAM roles, etc.)
    try {
      const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers')
      
      const credentialOptions: any = {}
      
      // Add profile if specified
      const profile = config?.awsProfile || process.env.AWS_PROFILE
      if (profile) {
        credentialOptions.profile = profile
      }
      
      // Resolve credentials immediately to validate they work
      const credentialProvider = fromNodeProviderChain(credentialOptions)
      const resolvedCredentials = await credentialProvider()
      
      // Set the resolved credentials
      bedrockConfig.accessKeyId = resolvedCredentials.accessKeyId
      bedrockConfig.secretAccessKey = resolvedCredentials.secretAccessKey
     
      if (resolvedCredentials.sessionToken) {
        bedrockConfig.sessionToken = resolvedCredentials.sessionToken
      }

      // seemingly this shouldn't be needed, but its not reading the region from the profile for me ...
      bedrockConfig.region = config?.awsRegion || process.env.AWS_REGION || 'us-west-2'
    } catch (credentialError) {
      throw new Error(`Failed to resolve AWS credentials: ${credentialError instanceof Error ? credentialError.message : String(credentialError)}`)
    }
  }
  
  return createAmazonBedrock(bedrockConfig)
}

/**
 * Unified model provider function
 * 
 * @param modelName - Short model name or full model identifier
 * @param config - Optional configuration overrides
 * @returns Language model instance
 * 
 * @example
 * ```typescript
 * // OpenAI models (with proxy support)
 * const gpt4 = await getModel('gpt4o')
 * const gpt4WithProxy = await getModel('gpt4o', { 
 *   openaiBaseUrl: 'https://proxy.example.com' 
 * })
 * 
 * // Claude through OpenAI proxy (when AWS not configured)
 * // Automatically routes to proxy if OPENAI_BASE_URL is set and AWS credentials are not available
 * const claudeViaProxy = await getModel('claude4')  // Uses OpenAI proxy
 * 
 * // Bedrock models (when AWS is configured)
 * const claude = await getModel('claude4')  // Uses Bedrock when AWS credentials available
 * const claudeWithProfile = await getModel('sonnet4', { 
 *   awsProfile: 'my-profile'  // Region will come from profile
 * })
 * 
 * // Bedrock with explicit region
 * const claudeExplicit = await getModel('claude4', {
 *   awsRegion: 'us-west-2'
 * })
 * ```
 */
export async function getModel(
  modelName: string, 
  config?: ProviderConfig
): Promise<LanguageModel> {
  const providerType = getProviderType(modelName, config)
  
  try {
    if (providerType === 'openai') {
      // Validate OpenAI configuration
      validateOpenAIConfig(config)
      
      // Determine the model name to use
      let modelNameToUse: string
      
      if (shouldUseClaudeProxy(modelName, config)) {
        // Use Claude proxy model name
        modelNameToUse = CLAUDE_PROXY_MODELS[modelName as keyof typeof CLAUDE_PROXY_MODELS]
        console.log(`🔄 Routing Claude model '${modelName}' through OpenAI proxy as '${modelNameToUse}'`)
      } else {
        // Use regular OpenAI model mapping
        modelNameToUse = MODEL_MAPPINGS[modelName as ModelShortName] || modelName
      }
      
      // Create OpenAI provider
      const provider = createOpenAIProvider(config)
      return provider(modelNameToUse)
      
    } else if (providerType === 'bedrock') {
      // Validate Bedrock configuration
      validateBedrockConfig(config)
      
      // Use Bedrock model mapping
      const fullModelName = MODEL_MAPPINGS[modelName as ModelShortName] || modelName
      
      // Create Bedrock provider
      const provider = await createBedrockProvider(config)
      return provider(fullModelName)
      
    } else {
      throw new Error(`Unsupported provider type: ${providerType}`)
    }
  } catch (error) {
    throw new Error(`Failed to create model '${modelName}': ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Get available model short names
 */
export function getAvailableModels(): string[] {
  return Object.keys(MODEL_MAPPINGS).sort()
}

/**
 * Check if a model name is supported
 */
export function isModelSupported(modelName: string): boolean {
  return modelName in MODEL_MAPPINGS
}

/**
 * Get the full model identifier from a short name
 */
export function getFullModelName(shortName: string): string {
  return MODEL_MAPPINGS[shortName as ModelShortName] || shortName
}

/**
 * Validate environment for a specific model
 */
export function validateModelEnvironment(modelName: string, config?: ProviderConfig): boolean {
  const providerType = getProviderType(modelName, config)
  
  try {
    if (providerType === 'openai') {
      validateOpenAIConfig(config)
    } else if (providerType === 'bedrock') {
      validateBedrockConfig(config)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Get model information
 */
export function getModelInfo(modelName: string, config?: ProviderConfig) {
  const providerType = getProviderType(modelName, config)
  
  let fullModelName: string
  let usingProxy = false
  
  if (shouldUseClaudeProxy(modelName, config)) {
    fullModelName = CLAUDE_PROXY_MODELS[modelName as keyof typeof CLAUDE_PROXY_MODELS]
    usingProxy = true
  } else {
    fullModelName = MODEL_MAPPINGS[modelName as ModelShortName] || modelName
  }
  
  return {
    shortName: modelName,
    fullName: fullModelName,
    provider: providerType,
    isSupported: isModelSupported(modelName),
    usingProxy,
    ...(usingProxy && { proxyReason: 'AWS credentials not available, using OpenAI proxy' })
  }
}
