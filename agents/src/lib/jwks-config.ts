/**
 * JWT Configuration for Agents
 * 
 * Centralized configuration for JWT validation in agents service.
 * Uses the centralized features system to get JWT_PUBLIC_KEY - other values are hardcoded constants.
 * In production, JWT_PUBLIC_KEY will be injected via job template from app configuration.
 */

import { auth } from '../services/features.js';

/**
 * Normalize PEM key by handling various levels of newline escaping
 * Handles cases where deployment systems double-escape newlines:
 * - \n -> \n (normal case)
 * - \\n -> \n (single escape from env vars)
 * - \\\\n -> \n (double escape from Nomad/deployment systems)
 */
function normalizePEMKey(key: string): string {
  // Handle escaped newlines from Nomad environment variables
  // Nomad typically escapes newlines as \n (single backslash + n)
  let normalized = key;
  
  // Replace escaped newlines with actual newlines
  normalized = normalized.replace(/\\n/g, '\n');
  
  // Clean up the PEM format - just ensure proper line structure
  return normalized.trim();
}

export interface JWTAgentConfig {
  publicKey: string;
  issuer: string;
  audience: string;
  algorithms: string[];
}

/**
 * Get JWT configuration for agents using centralized features system
 * Only JWT_PUBLIC_KEY needs to be injected - other values are hardcoded constants
 */
export function getJWTAgentConfig(): JWTAgentConfig {
  const publicKey = auth.getJWTPublicKey();
  
  if (!publicKey) {
    throw new Error('JWT_PUBLIC_KEY environment variable is required for agents');
  }

  
  const normalizedKey = normalizePEMKey(publicKey);

  return {
    publicKey: normalizedKey,
    issuer: 'airo-app',
    audience: 'agents-service',
    algorithms: ['RS256']
  };
}

/**
 * Validate JWT configuration for agents
 * Only validates JWT_PUBLIC_KEY since other values are hardcoded constants
 */
export function validateJWTAgentConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  try {
    const config = getJWTAgentConfig();
    
    if (!config.publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      errors.push('JWT_PUBLIC_KEY must be a valid PEM-formatted public key');
    }
    
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown JWT config error');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
