/**
 * JWT Configuration for Agents
 * 
 * Centralized configuration for JWT validation using JWKS endpoint.
 */

import { auth } from '../services/features.js';

export interface JWTAgentConfig {
  jwksUrl: string;       // JWKS endpoint URL
  issuer: string;
  audience: string;
  algorithms: string[];
}

/**
 * Get JWT configuration for agents using JWKS endpoint
 */
export function getJWTAgentConfig(): JWTAgentConfig {
  const jwksUrl = auth.getJWKSUrl();
  
  if (!jwksUrl) {
    throw new Error('JWKS_URL environment variable is required for agents');
  }

  return {
    jwksUrl,
    issuer: 'airo-app',
    audience: 'agents-service',
    algorithms: ['RS256']
  };
}

/**
 * Validate JWT configuration for agents
 * Validates JWKS_URL configuration
 */
export function validateJWTAgentConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  try {
    const config = getJWTAgentConfig();
    
    // Validate JWKS URL
    try {
      new URL(config.jwksUrl);
    } catch {
      errors.push('JWKS_URL must be a valid URL');
    }
    
    if (!config.jwksUrl.includes('/.well-known/jwks.json')) {
      errors.push('JWKS_URL should point to a standard JWKS endpoint (/.well-known/jwks.json)');
    }
    
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown JWT config error');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
