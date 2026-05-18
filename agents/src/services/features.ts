/**
 * Centralized feature configuration system for agents service
 * This module handles all environment variable parsing and feature flags
 */

import { Logger } from '../logging/index.js';
import { profileFlag } from '../profiles/profile-accessor.js';
import { getPersistentPrivateDir } from '../utils/persistent-assets.js';

const logger = Logger.create({ component: 'features' });

/**
 * Authentication types supported by the agents service
 */
export enum AuthType {
  /** Custom JWT authentication using JWKS (production) */
  JWT = 'jwt',
  /** Mock authentication for development/testing */
  MOCK = 'mock',
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
    social: boolean
  }

  // Skill enablement configuration
  enabledSkills: {
    social: boolean
    connectingCalendars: boolean
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

// Cleanable file patterns defaults
const DEFAULT_CLEANABLE_OS_JUNK = ['.DS_Store', 'Thumbs.db', '__MACOSX/', 'desktop.ini'];
const DEFAULT_CLEANABLE_SECURITY = ['.git/', '.pem', '.key', '.npmrc', '.yarnrc'];
const DEFAULT_CLEANABLE_IDE = ['.idea/', '.vscode/'];

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
  /** Patterns for files that should be cleaned up instead of rejected */
  cleanablePatterns: {
    /** OS-generated junk files (e.g., .DS_Store, Thumbs.db) */
    osJunk: string[];
    /** Security-sensitive files (e.g., .env, .git/hooks/) */
    securitySensitive: string[];
    /** IDE configuration directories (e.g., .idea/, .vscode/) */
    ideConfig: string[];
  };
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
    cleanablePatterns: {
      osJunk: (process.env.ZIP_IMPORT_CLEANABLE_OS_JUNK || DEFAULT_CLEANABLE_OS_JUNK.join(','))
        .split(',').map(p => p.trim()).filter(Boolean),
      securitySensitive: (process.env.ZIP_IMPORT_CLEANABLE_SECURITY || DEFAULT_CLEANABLE_SECURITY.join(','))
        .split(',').map(p => p.trim()).filter(Boolean),
      ideConfig: (process.env.ZIP_IMPORT_CLEANABLE_IDE || DEFAULT_CLEANABLE_IDE.join(','))
        .split(',').map(p => p.trim()).filter(Boolean),
    },
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

  // AUTH_TYPE was set but not a recognized value - error so misconfigurations
  // surface in on-call tooling (warn may not trip the same alert tier).
  if (process.env.AUTH_TYPE) {
    logger.error('features.auth_type.unrecognized', {
      value: process.env.AUTH_TYPE,
      nodeEnv,
      supported: Object.values(AuthType),
      message: 'AUTH_TYPE is set but not a recognized value; falling back to NODE_ENV default',
    })
  }

  // Default behavior based on NODE_ENV
  switch (nodeEnv) {
    case 'production':
      return AuthType.JWT
    case 'development':
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

    // MySQL configuration
    mysqlRootHost: process.env.MYSQL_ROOT_HOST || 'localhost',
    mysqlRootPort: parseInt(process.env.MYSQL_ROOT_PORT || '3306', 10),
    mysqlRootUser: process.env.MYSQL_ROOT_USER || 'root',
    mysqlRootPass: process.env.MYSQL_ROOT_PASS || 'airo',

    // File upload configuration
    uploadDir: process.env.UPLOAD_DIR || (
      process.env.CUSTOMER_APP_DIR
        ? getPersistentPrivateDir(process.env.CUSTOMER_APP_DIR) + '/uploads'
        : '/tmp/airo-app-builder-uploads'
    ),

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
      social: process.env.ENABLE_SOCIAL === 'true'
    },

    // Skill enablement configuration. Add skills here as they are created.
    enabledSkills: {
      social: process.env.ENABLE_SOCIAL === 'true',
      connectingCalendars : process.env.ENABLE_CONNECTING_CALENDARS !== 'false'
    },

    // Widget/Feature enablement configuration
    enabledFeatures: {
      sessionFeedback: process.env.ENABLE_SESSION_FEEDBACK === 'true',
      imageAnalysisEnabled: process.env.IMAGE_ANALYSIS_ENABLED === 'true',
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
  getType: () => getFeatures().authType,
  isMock: () => getFeatures().authType === AuthType.MOCK,
  isJWT: () => getFeatures().authType === AuthType.JWT,

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
  isEnabled: (agentId: 'social'): boolean => {
    const features = getFeatures();
    return features.enabledAgents[agentId] ?? false;
  }
} as const

/**
 * Skills gated via agent profile properties rather than static env vars.
 * The skill loader checks `skill.{enablementId}.enabled` on the active profile.
 * The enablementId in a skill's frontmatter must match an entry here.
 * This set also suppresses the "unknown feature flag" warning for these IDs.
 */
export const profileGatedSkills: Set<string> = new Set([
  // Add skill enablementIds here as they adopt profile-based gating.
]);

/**
 * Skill enablement helper functions
 */
export const skills = {
  /**
   * Check if a specific skill is enabled.
   * Resolution: static config (env var) > profile flag > default (false).
   */
  isEnabled: (skillId: string): boolean => {
    const featureConfig = getFeatures();

    if (skillId in featureConfig.enabledSkills) {
      return featureConfig.enabledSkills[skillId as keyof typeof featureConfig.enabledSkills];
    }

    if (profileGatedSkills.has(skillId)) {
      return profileFlag(`skill.${skillId}.enabled`, false);
    }

    return false;
  },

  isProfileGated: (skillId: string): boolean => {
    return profileGatedSkills.has(skillId);
  }
} as const

/**
 * Feature enablement helper functions
 */
export const features = {
  /** Check if a specific feature is enabled */
  isEnabled: (featureId: keyof FeatureConfig['enabledFeatures']): boolean => {
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

  // SECURITY: Validate production uses JWT authentication
  if (features.nodeEnv === 'production' && features.authType !== AuthType.JWT) {
    errors.push(
      `SECURITY: Production must use JWT authentication. ` +
      `Current: NODE_ENV=${features.nodeEnv}, AUTH_TYPE=${features.authType}`
    );
  }

  // SECURITY: Validate BYPASS_SITE_IDS not in production use
  if (features.nodeEnv === 'production') {
    const siteId = features.siteId;
    if (BYPASS_SITE_IDS.includes(siteId)) {
      errors.push(
        `SECURITY: Production SITE_ID cannot be a bypass value. ` +
        `Current: SITE_ID=${siteId}. ` +
        `Bypass values are for development/testing only: ${BYPASS_SITE_IDS.join(', ')}`
      );
    }
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
