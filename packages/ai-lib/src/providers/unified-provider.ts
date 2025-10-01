/**
 * Unified Provider Helper
 * 
 * Single provider function that handles both OpenAI and Bedrock with short names,
 * automatic environment variable validation, and proxy support.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { 
  normalizeModelName, 
  getLegacyModelMappings, 
  getAvailableModels as getAvailableModelsFromNormalization,
  isModelSupported as isModelSupportedFromNormalization,
  getFullModelName as getFullModelNameFromNormalization
} from '../utils/model-normalization.js'
import { getS2SProviderConfig, isS2SAuthEnabled, getDefaultAnthropicProxyEndpoint, type S2SAuthConfig } from '../utils/s2s-auth.js'

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

// Use unified model mappings from model-normalization
const MODEL_MAPPINGS = getLegacyModelMappings()
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
  /** Anthropic API key override */
  anthropicApiKey?: string
  /** Anthropic base URL override (for proxy) */
  anthropicBaseUrl?: string
  /** S2S authentication configuration */
  s2sAuth?: S2SAuthConfig
}

/**
 * Validate OpenAI configuration
 * Skips API key validation when S2S authentication is enabled
 */
function validateOpenAIConfig(config?: ProviderConfig): void {
  // Skip API key validation if S2S authentication is enabled
  if (isS2SAuthEnabled()) {
    return;
  }
  
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
 * Check if Anthropic credentials are available
 */
function hasAnthropicCredentials(config?: ProviderConfig): boolean {
  return !!(config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY)
}

/**
 * Check if a Claude model should be routed through a proxy
 * Returns the proxy type to use: 'openai' | 'anthropic' | null
 */
function getClaudeProxyType(modelName: string, config?: ProviderConfig): 'openai' | 'anthropic' | null {
  // Check if model is in our Claude proxy list
  const isClaudeProxyModel = modelName in CLAUDE_PROXY_MODELS
  if (!isClaudeProxyModel) {
    return null
  }
  
  // If S2S auth is enabled, prefer Anthropic proxy (since we have GoCode endpoints)
  if (isS2SAuthEnabled()) {
    return 'anthropic'
  }
  
  // If AWS is available, use Bedrock directly (no proxy needed)
  const hasAWS = hasAWSCredentials(config)
  if (hasAWS) {
    return null
  }
  
  // Check available proxy options
  const hasAnthropicCreds = hasAnthropicCredentials(config)
  const hasOpenAIProxy = !!(config?.openaiBaseUrl || process.env.OPENAI_BASE_URL)
  
  // Prefer Anthropic direct access if available
  if (hasAnthropicCreds) {
    return 'anthropic'
  }
  
  // Fall back to OpenAI proxy if available
  if (hasOpenAIProxy) {
    return 'openai'
  }
  
  return null
}

/**
 * Check if a Claude model should be routed through OpenAI proxy (backward compatibility)
 */
function shouldUseClaudeProxy(modelName: string, config?: ProviderConfig): boolean {
  return getClaudeProxyType(modelName, config) === 'openai'
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
function getProviderType(modelName: string, config?: ProviderConfig): 'openai' | 'bedrock' | 'anthropic' {
  // Check if this Claude model should be routed through a proxy
  const proxyType = getClaudeProxyType(modelName, config)
  if (proxyType) {
    return proxyType
  }
  
  // Check if AWS/Bedrock is available and prefer it when possible
  const hasAwsCredentials = !!(
    config?.awsAccessKeyId ||
    config?.awsSecretAccessKey ||
    config?.awsRegion ||
    process.env.AWS_ACCESS_KEY_ID || 
    process.env.AWS_PROFILE ||
    process.env.AWS_REGION
  )
  
  // Use unified model normalization to determine provider - prefer Bedrock if AWS available
  const modelInfo = normalizeModelName(modelName, hasAwsCredentials)
  
  // Map unified provider types to legacy types
  switch (modelInfo.provider) {
    case 'bedrock-claude':
      return 'bedrock'
    case 'anthropic':
      return 'anthropic'
    case 'openai':
    default:
      return 'openai'
  }
}

/**
 * Create OpenAI provider with configuration
 * Now supports S2S authentication when GOCODE_USE_S2S_AUTH is enabled
 */
async function createOpenAIProvider(config?: ProviderConfig) {
  // Check if S2S authentication is enabled and get config
  const s2sConfig = await getS2SProviderConfig(config?.s2sAuth)
  
  if (s2sConfig) {
    // Use S2S authentication with GoCode endpoint
    const openaiConfig: any = {
      apiKey: s2sConfig.apiKey, // Placeholder API key
      baseURL: s2sConfig.baseURL, // GoCode endpoint
      headers: s2sConfig.headers   // Authorization: Bearer JWT
    }
    
    console.log(`🔐 Using S2S authentication with GoCode endpoint: ${s2sConfig.baseURL}`)
    return createOpenAI(openaiConfig)
    
  } else {
    // Use regular OpenAI authentication
    const fallbackApiKey = config?.openaiApiKey || process.env.OPENAI_API_KEY || ''
    
    const openaiConfig: any = {
      apiKey: fallbackApiKey
    }
    
    // Add base URL if provided (for proxy support)
    const baseURL = config?.openaiBaseUrl || process.env.OPENAI_BASE_URL
    if (baseURL) {
      openaiConfig.baseURL = baseURL
    }
    
    return createOpenAI(openaiConfig)
  }
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
      const provider = await createOpenAIProvider(config)
      return provider(modelNameToUse)
      
    } else if (providerType === 'bedrock') {
      // Validate Bedrock configuration
      validateBedrockConfig(config)
      
      // Use Bedrock model mapping
      const fullModelName = MODEL_MAPPINGS[modelName as ModelShortName] || modelName
      
      // Create Bedrock provider
      const provider = await createBedrockProvider(config)
      return provider(fullModelName)
    } else if (providerType === 'anthropic') {
      // Validate Anthropic configuration
      validateAnthropicConfig(config)
      
      // Determine the model name to use
      let modelNameToUse: string
      
      // Check if this is a Claude model that we're routing to Anthropic
      if (modelName in CLAUDE_PROXY_MODELS) {
        // Use Claude proxy model name for Anthropic API
        modelNameToUse = CLAUDE_PROXY_MODELS[modelName as keyof typeof CLAUDE_PROXY_MODELS]
        console.log(`🔄 Using Anthropic API for Claude model '${modelName}' as '${modelNameToUse}'`)
      } else {
        // Use regular model mapping
        modelNameToUse = MODEL_MAPPINGS[modelName as ModelShortName] || modelName
      }
      
      // Create Anthropic provider
      const provider = await createAnthropicProvider(config)
      return provider(modelNameToUse)
      
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
  return getAvailableModelsFromNormalization()
}

/**
 * Check if a model name is supported
 */
export function isModelSupported(modelName: string): boolean {
  return isModelSupportedFromNormalization(modelName)
}

/**
 * Get the full model identifier from a short name
 */
export function getFullModelName(shortName: string): string {
  return getFullModelNameFromNormalization(shortName)
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
    } else if (providerType === 'anthropic') {
      validateAnthropicConfig(config)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Validate Anthropic configuration
 * Skips API key validation when S2S authentication is enabled
 */
function validateAnthropicConfig(config?: ProviderConfig): void {
  // Skip API key validation if S2S authentication is enabled
  if (isS2SAuthEnabled()) {
    return;
  }
  
  const apiKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass anthropicApiKey in config.')
  }
}

/**
 * Create Anthropic provider with configuration
 * Now supports S2S authentication when GOCODE_USE_S2S_AUTH is enabled
 */
async function createAnthropicProvider(config?: ProviderConfig) {
  // Check if S2S authentication is enabled and get config
  const s2sConfig = await getS2SProviderConfig(config?.s2sAuth)
  
  if (s2sConfig) {
    // Use S2S authentication with GoCode endpoint
    const anthropicConfig: any = {
      apiKey: s2sConfig.apiKey, // Placeholder API key
      baseURL: s2sConfig.baseURL.endsWith('/v1') ? s2sConfig.baseURL : s2sConfig.baseURL + '/v1', // Ensure /v1 suffix
      headers: s2sConfig.headers // Authorization: Bearer JWT
    }
    
    console.log(`🔐 Using S2S authentication with GoCode endpoint (Anthropic): ${anthropicConfig.baseURL}`)
    return createAnthropic(anthropicConfig)
    
  } else {
    // Use regular Anthropic authentication
    const fallbackApiKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || ''
    
    const anthropicConfig: any = {
      apiKey: fallbackApiKey
    }
    
    // Add base URL - use GoCode Anthropic proxy endpoint if no explicit override
    const baseURL = config?.anthropicBaseUrl || process.env.ANTHROPIC_BASE_URL || getDefaultAnthropicProxyEndpoint()
    if (baseURL) {
      anthropicConfig.baseURL = baseURL
      console.log(`🔗 Using Anthropic proxy endpoint: ${baseURL}`)
    }
    
    return createAnthropic(anthropicConfig)
  }
}


/**
 * Get model information
 */
export function getModelInfo(modelName: string, config?: ProviderConfig) {
  const providerType = getProviderType(modelName, config)
  const proxyType = getClaudeProxyType(modelName, config)
  
  let fullModelName: string
  let usingProxy = false
  let proxyReason = ''
  
  if (proxyType) {
    fullModelName = CLAUDE_PROXY_MODELS[modelName as keyof typeof CLAUDE_PROXY_MODELS]
    usingProxy = true
    if (proxyType === 'openai') {
      proxyReason = 'AWS and Anthropic not available, using OpenAI proxy'
    } else if (proxyType === 'anthropic') {
      proxyReason = 'AWS not available, using Anthropic API directly'
    }
  } else {
    fullModelName = getFullModelNameFromNormalization(modelName)
  }
  
  return {
    shortName: modelName,
    fullName: fullModelName,
    provider: providerType,
    isSupported: isModelSupported(modelName),
    usingProxy,
    ...(usingProxy && { proxyReason })
  }
}
