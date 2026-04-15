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
      model: process.env.DEFAULT_MODEL || 'claude-sonnet-4-6'
    }
  }

  /**
   * Get the default provider from environment
   */
  static getDefaultProvider(): 'openai' | 'anthropic' {
    const provider = process.env.DEFAULT_PROVIDER?.toLowerCase()
    if (provider === 'anthropic') {
      return provider
    }
    return 'openai' // default
  }

  /**
   * Check if required environment variables are set for a provider
   */
  static validateProvider(provider: 'openai' | 'anthropic'): boolean {
    switch (provider) {
      case 'openai':
        return !!process.env.OPENAI_API_KEY
      case 'anthropic':
        return !!process.env.ANTHROPIC_API_KEY
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
  }
}
