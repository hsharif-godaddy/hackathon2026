/**
 * JWT Configuration
 * Centralized configuration for JWT authentication
 */

export interface JWTConfig {
  privateKey: string;
  publicKey: string;
}

export interface JWTClaims {
  // Standard JWT claims
  iss: string;      // Issuer - hardcoded to 'airo-app'
  aud: string;      // Audience - hardcoded to 'agents-service'
  exp: number;      // Expiration
  iat: number;      // Issued at
  
  // Custom claims (only siteId)
  siteId: string;   // Site ID
}

/**
 * Get JWT configuration from environment variables
 * Only requires private and public keys
 */
export function getJWTConfig(): JWTConfig {
  const privateKey = process.env.JWT_PRIVATE_KEY;
  const publicKey = process.env.JWT_PUBLIC_KEY;
  
  if (!privateKey) {
    throw new Error('JWT_PRIVATE_KEY environment variable is required');
  }
  
  if (!publicKey) {
    throw new Error('JWT_PUBLIC_KEY environment variable is required');
  }

  return {
    privateKey: privateKey.replace(/\\n/g, '\n'),
    publicKey: publicKey.replace(/\\n/g, '\n')
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
    keyId: 'key-1',
    expiresIn: '12h'
  };
}