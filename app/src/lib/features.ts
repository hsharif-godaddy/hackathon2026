/**
 * Centralized feature configuration system
 * This module handles all environment variable parsing and feature flags
 */
import { SUPPORTED_AUTH_TYPES } from '@airo/shared/auth';

import { logger } from '@/lib/request-context';
import { decodeJWT } from '@/lib/utils/jwt-utils';

/**
 * Authentication types supported by the application
 */
/**
 * SSO expiration codes from gd-auth (mirrors gd-auth/src/expiration-codes.js)
 * Used by TokenExpiredError.ssoCode to indicate why a token was rejected.
 */
export const SsoExpirationCode = {
  NOT_EXPIRED: 0,
  LOGIN: 1,
  HBI: 2,
  VAT: 3,
} as const;

export type SsoExpirationCode = (typeof SsoExpirationCode)[keyof typeof SsoExpirationCode];

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
  enableLocalFeatures: boolean
  // Add more features here as needed
}

/**
 * Application constants
 */
// UI-enforced character limit for prompt input.
// This value is used for textarea `maxLength` (e.g. in HeroSection) to provide a simple UX cap,
// while the backend still enforces the true byte-based limit (~7.4KB) in waf-validation.ts.
// 6000 characters is a conservative estimate assuming ~1.2 bytes per character on average, so
// typical inputs remain safely under the byte cap even for multi-byte characters.
export const MAX_PROMPT_LENGTH = 6000

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
      if (process.env.AUTH_TYPE === 'jwt') {
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
    enableLocalFeatures: process.env.NEXT_PUBLIC_ENABLE_LOCAL_FEATURES === 'true',
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
  localFeatures: () => features.enableLocalFeatures,
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
  /** Check if TCP mode should be used */
  shouldUseTcp: () => {
    // Enable if explicitly configured
    if (isFeatureEnabled.devSupervisorTcp()) {
      return true;
    }

    // Auto-enable on macOS for better Docker compatibility
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
   *
   * IMPORTANT: gd-auth validates tokens against this list. If a token's auth type
   * is not in this array, gd-auth will throw TokenAuthMismatchError and reject it.
   * This list must include ALL auth types we want to support.
   *
   * Auth types (from gd-auth source):
   * - basic: Normal authentication
   * - e2s: Employee-to-shopper impersonation
   * - s2s: Shopper-to-shopper delegation
   * - e2s2s: Employee-to-shopper-to-shopper
   * - e2s2p: Employee-to-shopper-to-partner
   * - e2s2snpr: Employee-to-shopper-to-shopper (NPR)
   * - e2s2s2p: Employee-to-shopper-to-shopper-to-partner
   * - cert2s: Certificate-to-shopper
   * - e2p: Employee-to-partner
   * - s2p: Shopper-to-partner
   * - s2snpr: Shopper-to-shopper (non-personalized reseller)
   * - s2s2p: Shopper-to-shopper-to-partner
   */
  getSupportedAuthTypes: (): string[] => {
    return [...SUPPORTED_AUTH_TYPES];
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

    // Check for auth field first (gd-auth sets this)
    if (payload.auth) {
      return payload.auth;
    }

    // Check for e2s (employee-to-shopper impersonation)
    if (payload.e2s && typeof payload.e2s === 'object') {
      return 'e2s';
    }

    // Check for s2s (shopper-to-shopper delegation)
    if (payload.s2s && typeof payload.s2s === 'object') {
      return 's2s';
    }

    // Check for other nested auth types (delegation chains and impersonation)
    const nestedAuthTypes = ['cert2s', 'e2s2s', 'e2s2p', 'e2s2snpr', 'e2s2s2p', 'e2p', 's2p', 's2snpr', 's2s2p'];
    for (const authType of nestedAuthTypes) {
      if (payload[authType] && typeof payload[authType] === 'object') {
        return authType;
      }
    }

    // Default to basic auth
    return 'basic';
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
