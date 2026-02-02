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

interface FeatureConfig {
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
  }

  // Skill enablement configuration
  enabledSkills: {
    social: boolean
  }

  // Widget/Feature enablement configuration
  enabledFeatures: {
    sessionFeedback: boolean
    imageAnalysisEnabled: boolean
  }
}

/**
 * Application constants
 */
export const MAX_PROMPT_LENGTH = 40000

/**
 * Size constants for readability
 */
const ONE_KB = 1024;
const ONE_MB = ONE_KB * 1024;
const ONE_GB = ONE_MB * 1024;

// Default zip import size limits
const DEFAULT_MIN_ZIP_SIZE = ONE_KB; // 1KB
const DEFAULT_MAX_ZIP_SIZE = 250 * ONE_MB; // 250MB
const DEFAULT_MAX_EXTRACTED_SIZE = ONE_GB; // 1GB
const DEFAULT_MAX_COMPRESSION_RATIO = 100;
const DEFAULT_MAX_FILES = 50000;
const DEFAULT_MAX_PATH_LENGTH = 260;

/**
 * Zip Import security limits configuration
 */
export interface ZipImportLimits {
  minZipSize: number;
  maxZipSize: number;
  maxExtractedSize: number;
  maxCompressionRatio: number;
  maxFiles: number;
  maxPathLength: number;
  blockedExtensions: string[];
}

/**
 * Get zip import security limits from environment variables
 * All limits have sensible defaults if not configured
 */
export function getZipImportLimits(): ZipImportLimits {
  return {
    minZipSize: parseInt(process.env.ZIP_IMPORT_MIN_SIZE || String(DEFAULT_MIN_ZIP_SIZE), 10),
    maxZipSize: parseInt(process.env.ZIP_IMPORT_MAX_SIZE || String(DEFAULT_MAX_ZIP_SIZE), 10),
    maxExtractedSize: parseInt(process.env.ZIP_IMPORT_MAX_EXTRACTED_SIZE || String(DEFAULT_MAX_EXTRACTED_SIZE), 10),
    maxCompressionRatio: parseInt(process.env.ZIP_IMPORT_MAX_COMPRESSION_RATIO || String(DEFAULT_MAX_COMPRESSION_RATIO), 10),
    maxFiles: parseInt(process.env.ZIP_IMPORT_MAX_FILES || String(DEFAULT_MAX_FILES), 10),
    maxPathLength: parseInt(process.env.ZIP_IMPORT_MAX_PATH_LENGTH || String(DEFAULT_MAX_PATH_LENGTH), 10),
    blockedExtensions: (process.env.ZIP_IMPORT_BLOCKED_EXTENSIONS ||
                       'exe,dll,so,dylib,bin,deb,rpm,pkg,app,ps1')
      .split(',')
      .map(ext => `.${ext.trim().toLowerCase()}`),
  };
}

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
 * Parse environment variables and return feature configuration
 */
function parseEnvironmentFeatures(): FeatureConfig {
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
      social: process.env.ENABLE_SOCIAL === 'true'
    },

    // Skill enablement configuration. Add skills here as they are created.
    enabledSkills: {
      social: process.env.ENABLE_SOCIAL === 'true'
    },

    // Widget/Feature enablement configuration
    enabledFeatures: {
      sessionFeedback: process.env.ENABLE_SESSION_FEEDBACK === 'true',
      imageAnalysisEnabled: process.env.IMAGE_ANALYSIS_ENABLED !== 'false'
    }
  }
}

// Lazy-loaded configuration - only parse when accessed
let _features: FeatureConfig | null = null;

/**
 * Get the current feature configuration (lazy-loaded)
 * This is the main export that services should use
 */
export function getFeatures(): FeatureConfig {
  if (_features === null) {
    _features = parseEnvironmentFeatures();
  }
  return _features;
}

/** @deprecated Use getFeatures() instead */
export const getAgentFeatures = getFeatures;

/**
 * Configuration getters for commonly used values (lazy-loaded)
 */
export const getAgentConfig = {
  dailyPriceLimit: () => getFeatures().dailyPriceLimit,
  openaiConfig: () => {
    const features = getFeatures();
    return {
      apiKey: features.openaiApiKey,
      baseUrl: features.openaiBaseUrl,
      model: features.openaiModel,
    };
  },
  mysqlConfig: () => {
    const features = getFeatures();
    return {
      host: features.mysqlRootHost,
      port: features.mysqlRootPort,
      user: features.mysqlRootUser,
      password: features.mysqlRootPass,
    };
  },
  uploadDir: () => getFeatures().uploadDir,
  contextLogging: () => getFeatures().contextLogging,
} as const

/**
 * Authentication helper functions for agents service
 */
export const auth = {
  /** Get current authentication type */
  getType: () => getFeatures().authType,
  /** Check if authentication is disabled (no auth required) */
  isDisabled: () => getFeatures().authType === AuthType.NONE,
  /** Check if using mock authentication */
  isMock: () => getFeatures().authType === AuthType.MOCK,
  /** Check if using full JWT authentication */
  isJWT: () => getFeatures().authType === AuthType.JWT,
  /** Check if authentication is required (not NONE) */
  isRequired: () => getFeatures().authType !== AuthType.NONE,

  /** Get JWKS URL (undefined if not set or empty) */
  getJWKSUrl: () => {
    const url = getFeatures().jwksUrl;
    return url && url.trim() !== '' ? url : undefined;
  },
  /** Check if JWKS URL is available and not empty */
  hasJWKSUrl: () => {
    const url = getFeatures().jwksUrl;
    return url !== undefined && url.trim() !== '';
  },
  /** Get site ID for authentication context */
  getSiteId: (authType?: AuthType) => {
    const features = getFeatures();
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
  isEnabled: (agentId: 'commerce' | 'social'): boolean => {
    const features = getFeatures();
    return features.enabledAgents[agentId] ?? false;
  }
} as const

/**
 * Skill enablement helper functions
 */
export const skills = {
  /** Check if a specific skill is enabled */
  isEnabled: (skillId: string): boolean => {
    const features = getFeatures();
    return features.enabledSkills[skillId as keyof typeof features.enabledSkills] ?? false;
  }
} as const

/**
 * Feature enablement helper functions
 */
export const features = {
  /** Check if a specific feature is enabled */
  isEnabled: (featureId: 'sessionFeedback'): boolean => {
    const features = getFeatures();
    return features.enabledFeatures[featureId] ?? false;
  }
} as const

/**
 * Debug function to log all current feature states
 * Useful for development and troubleshooting
 */
export function logFeatureState(): void {
  const features = getFeatures();
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
  const features = getFeatures();
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

/**
 * List of site IDs that are allowed to bypass authentication checks.
 */
export const BYPASS_SITE_IDS = [
  'bypass-site',
  'default-site',
  'local-dev-site',
  'mock-site-id',
  'unknown-site'
];
