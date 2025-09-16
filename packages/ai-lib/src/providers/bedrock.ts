/**
 * AWS Bedrock provider utilities
 * Requires @ai-sdk/amazon-bedrock to be installed
 */

import { EnvConfig } from '../utils/env-config.js'

/**
 * Create Bedrock provider with automatic environment configuration
 */
export async function createBedrockProvider(options?: {
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  profile?: string
}) {
  // Note: This requires @ai-sdk/amazon-bedrock to be installed
  // Since it's an optional dependency, we'll use dynamic import
  try {
    const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock')
    
    const config = EnvConfig.getBedrockConfig?.() || {}
    
    const settings: any = {
      region: options?.region || config.region || process.env.AWS_REGION || 'us-east-1',
    }
    
    // Check if explicit credentials are provided
    const hasExplicitCredentials = (options?.accessKeyId || process.env.AWS_ACCESS_KEY_ID) &&
                                  (options?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY)
    
    if (hasExplicitCredentials) {
      // Use explicit credentials
      settings.accessKeyId = options?.accessKeyId || process.env.AWS_ACCESS_KEY_ID
      settings.secretAccessKey = options?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY
      
      if (options?.sessionToken || process.env.AWS_SESSION_TOKEN) {
        settings.sessionToken = options?.sessionToken || process.env.AWS_SESSION_TOKEN
      }
    } else {
      // Use AWS credential provider chain (supports profiles, IAM roles, etc.)
      try {
        const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers')
        
        const credentialOptions: any = {}
        
        // Add profile if specified
        const profile = options?.profile || process.env.AWS_PROFILE
        if (profile) {
          credentialOptions.profile = profile
        }
        
        // Resolve credentials immediately to validate they work
        const credentialProvider = fromNodeProviderChain(credentialOptions)
        const resolvedCredentials = await credentialProvider()
        
        // Set the resolved credentials
        settings.accessKeyId = resolvedCredentials.accessKeyId
        settings.secretAccessKey = resolvedCredentials.secretAccessKey
        if (resolvedCredentials.sessionToken) {
          settings.sessionToken = resolvedCredentials.sessionToken
        }
      } catch (credentialError) {
        console.warn('Failed to resolve AWS credentials:', credentialError)
        throw new Error(`AWS Bedrock provider requires valid AWS credentials. Please provide either:
1. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables
2. Provide accessKeyId and secretAccessKey in options
3. Configure AWS profile with 'aws configure' or set AWS_PROFILE environment variable
4. Use IAM roles if running on AWS infrastructure

Current issue: ${credentialError instanceof Error ? credentialError.message : String(credentialError)}`)
      }
    }
    
    return createAmazonBedrock(settings)
  } catch (error) {
    if (error instanceof Error && error.message.includes('AWS Bedrock provider requires')) {
      throw error
    }
    throw new Error('AWS Bedrock provider requires @ai-sdk/amazon-bedrock package to be installed. Install it with: npm install @ai-sdk/amazon-bedrock')
  }
}

/**
 * Get Bedrock model with automatic configuration
 */
export async function getBedrockModel(modelName: string): Promise<any> {
  const bedrockProvider = await createBedrockProvider()
  return bedrockProvider(modelName)
}

/**
 * Get Bedrock embedding model
 */
export async function getBedrockEmbeddingModel(modelName: string): Promise<any> {
  const bedrockProvider = await createBedrockProvider()
  return bedrockProvider.embedding(modelName)
}

/**
 * Get Bedrock image model
 */
export async function getBedrockImageModel(modelName: string): Promise<any> {
  const bedrockProvider = await createBedrockProvider()
  return bedrockProvider.imageModel(modelName)
}

/**
 * Common Bedrock models for easy access
 */
export const bedrockModels = {
  // Text generation models
  claude3Sonnet: async () => await getBedrockModel('anthropic.claude-3-sonnet-20240229-v1:0'),
  claude3Haiku: async () => await getBedrockModel('anthropic.claude-3-haiku-20240307-v1:0'),
  claude35Sonnet: async () => await getBedrockModel('anthropic.claude-3-5-sonnet-20241022-v2:0'),
  
  // Embedding models
  titanEmbedText: async () => await getBedrockEmbeddingModel('amazon.titan-embed-text-v1'),
  titanEmbedTextV2: async () => await getBedrockEmbeddingModel('amazon.titan-embed-text-v2:0'),
  cohereEmbedEnglish: async () => await getBedrockEmbeddingModel('cohere.embed-english-v3'),
  cohereEmbedMultilingual: async () => await getBedrockEmbeddingModel('cohere.embed-multilingual-v3'),
  
  // Image generation models
  titanImage: async () => await getBedrockImageModel('amazon.titan-image-generator-v1'),
  titanImageV2: async () => await getBedrockImageModel('amazon.titan-image-generator-v2:0'),
  stabilitySD35: async () => await getBedrockImageModel('stability.sd3-5-large-v1:0'),
  stabilityCore: async () => await getBedrockImageModel('stability.stable-image-core-v1:1'),
  stabilityUltra: async () => await getBedrockImageModel('stability.stable-image-ultra-v1:1'),
  
  // Deprecated - use stabilitySD35 instead
  stabilityAI: async () => await getBedrockImageModel('stability.sd3-5-large-v1:0'),
  
  // Custom model
  custom: async (modelName: string) => await getBedrockModel(modelName),
  customEmbedding: async (modelName: string) => await getBedrockEmbeddingModel(modelName),
  customImage: async (modelName: string) => await getBedrockImageModel(modelName)
}

/**
 * Validate Bedrock configuration
 */
export function validateBedrockConfig(): boolean {
  try {
    // Check if AWS credentials are available
    const hasAccessKey = !!process.env.AWS_ACCESS_KEY_ID
    const hasSecretKey = !!process.env.AWS_SECRET_ACCESS_KEY
    const hasRegion = !!process.env.AWS_REGION
    
    // For AWS environments, credentials might be provided by IAM roles
    // so we only require region to be set
    return hasRegion || hasAccessKey || hasSecretKey
  } catch {
    return false
  }
}

/**
 * Get Bedrock configuration status
 */
export function getBedrockStatus() {
  const hasAccessKey = !!process.env.AWS_ACCESS_KEY_ID
  const hasSecretKey = !!process.env.AWS_SECRET_ACCESS_KEY
  const hasRegion = !!process.env.AWS_REGION
  const isValid = validateBedrockConfig()
  
  return {
    isConfigured: isValid,
    hasAccessKey,
    hasSecretKey,
    hasRegion,
    region: process.env.AWS_REGION || 'us-east-1',
    authMethod: hasAccessKey && hasSecretKey ? 'credentials' : 'iam-role'
  }
}