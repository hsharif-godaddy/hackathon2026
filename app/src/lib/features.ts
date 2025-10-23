/**
 * Centralized feature configuration system
 * This module handles all environment variable parsing and feature flags
 */
import { logger } from '@/lib/request-context';
import { decodeJWT } from '@/lib/utils/jwt-utils';

/**
 * Authentication types supported by the application
 */
export enum AuthType {
  /** Full JWT authentication with SSO (production) */
  JWT = 'jwt',
  /** Mock authentication for development/testing */
  MOCK = 'mock',
  /** No authentication (local development only) */
  NONE = 'none'
}

interface FeatureConfig {
  showCodeEditor: boolean
  authType: AuthType
  useMockLogin: boolean
  developmentMode: boolean
  showGalleryPage: boolean
  devSupervisorUseTcp: boolean
  devSupervisorTcpPort: string
  // Add more features here as needed
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
      // In development, check legacy environment variables for compatibility
      if (process.env.AUTH_TYPE === 'none') {
        return AuthType.NONE
      }
      if(process.env.AUTH_TYPE === 'jwt') {
        return AuthType.JWT
      }
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
  const authType = determineAuthType()
  
  return {
    showCodeEditor: process.env.NEXT_PUBLIC_SHOW_CODE_EDITOR === 'true',
    authType: authType,
    useMockLogin: authType === AuthType.MOCK || authType === AuthType.NONE,
    developmentMode: process.env.NODE_ENV === 'development',
    showGalleryPage: process.env.NEXT_PUBLIC_SHOW_GALLERY_PAGE === 'true',
    devSupervisorUseTcp: process.env.DEV_SUPERVISOR_USE_TCP === 'true',
    devSupervisorTcpPort: process.env.DEV_SUPERVISOR_TCP_PORT || '8877',
    // Add more feature parsing here
  }
}

/**
 * Get the current feature configuration
 * This is the main export that components should use
 */
export const features = parseEnvironmentFeatures()

/**
 * Feature flag checker functions for better type safety and readability
 */
export const isFeatureEnabled = {
  codeEditor: () => features.showCodeEditor,
  mockLogin: () => features.useMockLogin,
  developmentMode: () => features.developmentMode,
  galleryPage: () => features.showGalleryPage,
  devSupervisorTcp: () => features.devSupervisorUseTcp,
  // Add more feature checkers here
} as const

/**
 * Authentication helper functions
 */
export const auth = {
  /** Get current authentication type */
  getType: () => features.authType,
  /** Check if authentication is disabled (no auth required) */
  isDisabled: () => features.authType === AuthType.NONE,
  /** Check if using mock authentication */
  isMock: () => features.authType === AuthType.MOCK,
  /** Check if using full JWT authentication */
  isJWT: () => features.authType === AuthType.JWT,
  /** Check if authentication is required (not NONE) */
  isRequired: () => features.authType !== AuthType.NONE
} as const

/**
 * Dev-supervisor configuration helpers
 */
export const devSupervisor = {
  /** Check if TCP mode should be used (only in development) */
  shouldUseTcp: () => {
    // Only allow TCP mode in development
    if (!isFeatureEnabled.developmentMode()) {
      return false;
    }
    
    // Enable if explicitly configured
    if (isFeatureEnabled.devSupervisorTcp()) {
      return true;
    }
    
    // Auto-enable on macOS for better Docker compatibility (development only)
    if (typeof process !== 'undefined' && process.platform === 'darwin') {
      return true;
    }
    
    return false;
  },
  /** Get the configured TCP port */
  getTcpPort: () => features.devSupervisorTcpPort,
} as const

/**
 * Authentication helper functions for JWT token handling
 */
export const authUtils = {
  /** 
   * Get supported auth types for JWT authentication
   * Includes both basic and impersonation (e2s) auth types
   */
  getSupportedAuthTypes: (): string[] => {
    return ['basic', 'e2s'];
  },
  
  /**
   * Detect auth type from a JWT token
   * @param token - JWT token string
   * @returns Detected auth type or 'basic' as fallback
   */
  detectAuthTypeFromToken: (token: string): string => {
    if (!token) return 'basic';
    
    const payload = decodeJWT(token);
    if (!payload) return 'basic';
    
    // Check for e2s (impersonation) auth
    if (payload.e2s && typeof payload.e2s === 'object') {
      return 'e2s';
    }
    
    // Check for other nested auth types
    const nestedAuthTypes = ['cert2s', 's2s', 'e2s2s'];
    for (const authType of nestedAuthTypes) {
      if (payload[authType] && typeof payload[authType] === 'object') {
        return authType;
      }
    }
    
    // Default to basic auth
    return 'basic';
  },
  
  /**
   * Check if a token is an impersonation (e2s) token
   * @param token - JWT token string  
   * @returns True if token is e2s impersonation
   */
  isImpersonationToken: (token: string): boolean => {
    return authUtils.detectAuthTypeFromToken(token) === 'e2s';
  }
} as const

/**
 * Debug function to log all current feature states
 * Useful for development and troubleshooting
 */
export function logFeatureState(): void {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('features.state', { message: 'Feature flags', features })
  }
}