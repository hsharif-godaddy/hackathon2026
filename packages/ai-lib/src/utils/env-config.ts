/**
 * Environment configuration helper
 */

import { createLogger } from './logger.js'

const logger = createLogger('env-config')

export class EnvConfig {
  /**
   * Get OpenAI configuration from environment
   */
  static getOpenAIConfig() {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.DEFAULT_MODEL || 'gpt-4o-mini'
    }
  }

  /**
   * Get Anthropic configuration from environment
   */
  static getAnthropicConfig() {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-20241022'
    }
  }

  /**
   * Get AWS Bedrock configuration from environment
   */
  static getBedrockConfig() {
    return {
      region: process.env.AWS_REGION || 'us-west-2',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      model: process.env.DEFAULT_MODEL || 'us.anthropic.claude-3-5-sonnet-20241022-v1:0'
    }
  }

  /**
   * Get the default provider from environment
   */
  static getDefaultProvider(): 'openai' | 'anthropic' | 'bedrock' {
    const provider = process.env.DEFAULT_PROVIDER?.toLowerCase()
    if (provider === 'anthropic' || provider === 'bedrock') {
      return provider
    }
    return 'openai' // default
  }

  /**
   * Check if required environment variables are set for a provider
   */
  static validateProvider(provider: 'openai' | 'anthropic' | 'bedrock'): boolean {
    switch (provider) {
      case 'openai':
        return !!process.env.OPENAI_API_KEY
      case 'anthropic':
        return !!process.env.ANTHROPIC_API_KEY
      case 'bedrock':
        // For Bedrock, we assume it's configured if we have any AWS credentials setup
        // The AWS SDK will handle the credential chain resolution
        return true // Let the actual API call validate credentials
      default:
        return false
    }
  }

  /**
   * Get configuration for the default provider
   */
  static getDefaultConfig() {
    const provider = this.getDefaultProvider()

    switch (provider) {
      case 'openai':
        return { provider, ...this.getOpenAIConfig() }
      case 'anthropic':
        return { provider, ...this.getAnthropicConfig() }
      case 'bedrock':
        return { provider, ...this.getBedrockConfig() }
    }
  }

  /**
   * Print environment status for debugging
   */
  static printStatus() {
    logger.info('Environment Configuration Status:')
    logger.info(`Default Provider: ${this.getDefaultProvider()}`)
    logger.info(`OpenAI: ${this.validateProvider('openai') ? 'Yes' : 'No'} ${process.env.OPENAI_API_KEY ? '(API key set)' : '(no API key)'}`)
    logger.info(`Anthropic: ${this.validateProvider('anthropic') ? 'Yes' : 'No'} ${process.env.ANTHROPIC_API_KEY ? '(API key set)' : '(no API key)'}`)

    // Better Bedrock status detection
    const awsCredsInfo = []
    if (process.env.AWS_ACCESS_KEY_ID) awsCredsInfo.push('env vars')
    if (process.env.AWS_PROFILE) awsCredsInfo.push(`profile: ${process.env.AWS_PROFILE}`)
    if (process.env.AWS_ROLE_ARN) awsCredsInfo.push('role')
    const region = process.env.AWS_REGION || 'us-west-2'
    const awsStatus = awsCredsInfo.length > 0 ? `(${awsCredsInfo.join(', ')}, region: ${region})` : `(region: ${region}, using default credential chain)`

    logger.info(`Bedrock: ${this.validateProvider('bedrock') ? 'Yes' : 'No'} ${awsStatus}`)
  }
}
