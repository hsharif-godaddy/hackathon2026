/**
 * JWT Configuration
 * Centralized configuration for JWT authentication
 */

export interface JWTConfig {
  secretName: string;
  awsRegion: string;
}

export interface JWTClaims {
  // Standard JWT claims
  iss: string;      // Issuer - hardcoded to 'airo-app'
  aud: string;      // Audience - hardcoded to 'agents-service'
  exp: number;      // Expiration
  iat: number;      // Issued at

  // Custom claims
  siteId: string;          // Site ID
  canDownload: boolean;    // Permission to download app files
  canPublish: boolean;     // Permission to publish app
  canPurchaseDomain: boolean; // Permission to purchase and attach custom domains
  authType?: 'basic' | 'e2s' | 's2s'; // Authentication type: basic (normal), e2s (employee impersonation), s2s (shopper delegation)
  isE2S: boolean; // Backward compatibility: true if authType is 'e2s' or 's2s'
}

/**
 * Get JWT configuration from environment variables
 */
export function getJWTConfig(): JWTConfig {
  const secretName = process.env.JWT_SECRETS_NAME || 'dev-airo-jwt-keys';
  const awsRegion = process.env.AWS_REGION || 'us-west-2';

  return {
    secretName,
    awsRegion
  };
}

/**
 * Get hardcoded JWT constants
 */
export function getJWTConstants() {
  return {
    issuer: 'airo-app',
    audience: 'agents-service',
    algorithm: 'RS256' as const,
    expiresIn: '12h'
  };
}
