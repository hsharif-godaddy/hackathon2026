/**
 * Centralized feature configuration system for agents service
 * This module handles all environment variable parsing and feature flags
 */

import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'features' });

/**
 * Authentication types supported by the agents service
 */
export enum AuthType {
  /** Custom JWT authentication using JWKS (production) */
  JWT = 'jwt',
  /** Mock authentication for development/testing */
  MOCK = 'mock',
  /** No authentication (local development only) */
  NONE = 'none'
}

interface AgentFeatureConfig {
  // Price and usage limits
  dailyPriceLimit: number

  // Server configuration
  nodeEnv: string
  authType: AuthType

  // JWT configuration
  jwksUrl: string | undefined
  siteId: string

  // OpenAI configuration
  openaiApiKey: string | undefined
  openaiBaseUrl: string | undefined
  openaiModel: string

  // MySQL configuration
  mysqlRootHost: string
  mysqlRootPort: number
  mysqlRootUser: string
  mysqlRootPass: string

  // File upload configuration
  uploadDir: string

  // Context logging configuration
  contextLogging: {
    detailed: boolean
    appContextContent: boolean
    templateContent: boolean
    visualContextDetails: boolean
    rawContextData: boolean
  }

  // Agent enablement configuration
  enabledAgents: {
    commerce: boolean
    social: boolean
    socialPosts: boolean
  }
}

/**
 * Application constants
 */
export const MAX_PROMPT_LENGTH = 40000

/**
 * Determine authentication type based on environment
 */
function determineAuthType(): AuthType {
  const nodeEnv = process.env.NODE_ENV
  const explicitAuthType = process.env.AUTH_TYPE?.toLowerCase() as AuthType

  // Explicit AUTH_TYPE override (for testing/debugging)
  if (explicitAuthType && Object.values(AuthType).includes(explicitAuthType)) {
    return explicitAuthType
  }

  // Default behavior based on NODE_ENV
  switch (nodeEnv) {
    case 'production':
      return AuthType.JWT
    case 'development':
      // In development, check legacy environment variable for compatibility
      if (process.env.BYPASS_AUTH_FOR_LOCAL === 'true') {
        return AuthType.NONE
      }
      return AuthType.MOCK
    case 'test':
      return AuthType.MOCK
    default:
      // Unknown environment - default to JWT for security
      return AuthType.JWT
  }
}

/**
 * Parse environment variables and return agent feature configuration
 */
function parseEnvironmentFeatures(): AgentFeatureConfig {
  return {
    // Price and usage limits
    dailyPriceLimit: parseFloat(process.env.DAILY_PRICE_LIMIT || '10'),

    // Server configuration
    nodeEnv: process.env.NODE_ENV || 'development',
    authType: determineAuthType(),

    // JWT configuration
    jwksUrl: process.env.JWKS_URL || 'https://airo-builder.test-godaddy.com/.well-known/jwks.json',
    siteId: process.env.SITE_ID || 'default-site',

    // OpenAI configuration
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4',

    // MySQL configuration
    mysqlRootHost: process.env.MYSQL_ROOT_HOST || 'localhost',
    mysqlRootPort: parseInt(process.env.MYSQL_ROOT_PORT || '3306', 10),
    mysqlRootUser: process.env.MYSQL_ROOT_USER || 'root',
    mysqlRootPass: process.env.MYSQL_ROOT_PASS || 'airo',

    // File upload configuration
    uploadDir: process.env.UPLOAD_DIR || 'data/uploads',

    // Context logging configuration
    contextLogging: {
      detailed: process.env.DEBUG_CONTEXT_DETAILED === 'true',
      appContextContent: process.env.DEBUG_CONTEXT_APP_CONTENT === 'true',
      templateContent: process.env.DEBUG_CONTEXT_TEMPLATE_CONTENT === 'true',
      visualContextDetails: process.env.DEBUG_CONTEXT_VISUAL_DETAILS === 'true',
      rawContextData: process.env.DEBUG_CONTEXT_RAW_DATA === 'true'
    },

    // Agent enablement configuration
    enabledAgents: {
      commerce: process.env.ENABLE_COMMERCE_AGENT === 'true',
      social: process.env.ENABLE_SOCIAL_PLATFORM === 'true',
      socialPosts: process.env.ENABLE_SOCIAL_POSTS === 'true'
    }
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
  uploadDir: () => getAgentFeatures().uploadDir,
  contextLogging: () => getAgentFeatures().contextLogging,
} as const

/**
 * Authentication helper functions for agents service
 */
export const auth = {
  /** Get current authentication type */
  getType: () => getAgentFeatures().authType,
  /** Check if authentication is disabled (no auth required) */
  isDisabled: () => getAgentFeatures().authType === AuthType.NONE,
  /** Check if using mock authentication */
  isMock: () => getAgentFeatures().authType === AuthType.MOCK,
  /** Check if using full JWT authentication */
  isJWT: () => getAgentFeatures().authType === AuthType.JWT,
  /** Check if authentication is required (not NONE) */
  isRequired: () => getAgentFeatures().authType !== AuthType.NONE,

  /** Get JWKS URL (undefined if not set or empty) */
  getJWKSUrl: () => {
    const url = getAgentFeatures().jwksUrl;
    return url && url.trim() !== '' ? url : undefined;
  },
  /** Check if JWKS URL is available and not empty */
  hasJWKSUrl: () => {
    const url = getAgentFeatures().jwksUrl;
    return url !== undefined && url.trim() !== '';
  },
  /** Get site ID for authentication context */
  getSiteId: (authType?: AuthType) => {
    const features = getAgentFeatures();
    const currentAuthType = authType || features.authType;

    switch (currentAuthType) {
      case AuthType.NONE:
        return features.siteId || 'local-dev-site';
      case AuthType.MOCK:
        return features.siteId || 'mock-site-id';
      case AuthType.JWT:
        return features.siteId || 'bypass-site';
      default:
        return features.siteId || 'unknown-site';
    }
  }
} as const

/**
 * Agent enablement helper functions
 */
export const agents = {
  /** Check if a specific agent is enabled */
  isEnabled: (agentId: 'commerce' | 'social' | 'socialPosts'): boolean => {
    const features = getAgentFeatures();
    return features.enabledAgents[agentId] ?? false;
  }
} as const

/**
 * Debug function to log all current feature states
 * Useful for development and troubleshooting
 */
export function logFeatureState(): void {
  const features = getAgentFeatures();
  if (features.nodeEnv === 'development') {
    logger.info('features.state.debug', {
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
