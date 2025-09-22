/**
 * Centralized feature configuration system for agents service
 * This module handles all environment variable parsing and feature flags
 */

interface AgentFeatureConfig {
  // Price and usage limits
  dailyPriceLimit: number
  
  // Server configuration
  nodeEnv: string
  
  // OpenAI configuration
  openaiApiKey: string | undefined
  openaiBaseUrl: string | undefined
  openaiModel: string
  
  // MySQL configuration
  mysqlRootHost: string
  mysqlRootPort: number
  mysqlRootUser: string
  mysqlRootPass: string

}

/**
 * Application constants
 */
export const MAX_PROMPT_LENGTH = 40000

/**
 * Parse environment variables and return agent feature configuration
 */
function parseEnvironmentFeatures(): AgentFeatureConfig {
  return {
    // Price and usage limits
    dailyPriceLimit: parseFloat(process.env.DAILY_PRICE_LIMIT || '10'),
    
    // Server configuration
    nodeEnv: process.env.NODE_ENV || 'development',
        
    // OpenAI configuration
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4',
    
    // MySQL configuration
    mysqlRootHost: process.env.MYSQL_ROOT_HOST || 'localhost',
    mysqlRootPort: parseInt(process.env.MYSQL_ROOT_PORT || '3306', 10),
    mysqlRootUser: process.env.MYSQL_ROOT_USER || 'root',
    mysqlRootPass: process.env.MYSQL_ROOT_PASS || 'airo',
    
  }
}

// Lazy-loaded configuration - only parse when accessed
let _agentFeatures: AgentFeatureConfig | null = null;

/**
 * Get the current feature configuration (lazy-loaded)
 * This is the main export that services should use
 */
export function getAgentFeatures(): AgentFeatureConfig {
  if (_agentFeatures === null) {
    _agentFeatures = parseEnvironmentFeatures();
  }
  return _agentFeatures;
}

/**
 * Configuration getters for commonly used values (lazy-loaded)
 */
export const getAgentConfig = {
  dailyPriceLimit: () => getAgentFeatures().dailyPriceLimit,
  openaiConfig: () => {
    const features = getAgentFeatures();
    return {
      apiKey: features.openaiApiKey,
      baseUrl: features.openaiBaseUrl,
      model: features.openaiModel,
    };
  },
  mysqlConfig: () => {
    const features = getAgentFeatures();
    return {
      host: features.mysqlRootHost,
      port: features.mysqlRootPort,
      user: features.mysqlRootUser,
      password: features.mysqlRootPass,
    };
  },
} as const

/**
 * Debug function to log all current feature states
 * Useful for development and troubleshooting
 */
export function logFeatureState(): void {
  const features = getAgentFeatures();
  if (features.nodeEnv === 'development') {
    console.log('Agent feature flags and configuration:', {
      environment: features.nodeEnv,
      pricing: {
        dailyLimit: features.dailyPriceLimit,
      },
    })
  }
}

/**
 * Validate critical configuration on startup
 * Throws errors for missing required configuration
 */
export function validateConfiguration(): void {
  const features = getAgentFeatures();
  const errors: string[] = []

  // Validate critical paths and values
  if (features.dailyPriceLimit < 0) {
    errors.push('DAILY_PRICE_LIMIT must be a positive number')
  }

  if (features.mysqlRootPort < 1 || features.mysqlRootPort > 65535) {
    errors.push('MYSQL_ROOT_PORT must be a valid port number (1-65535)')
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`)
  }
}
