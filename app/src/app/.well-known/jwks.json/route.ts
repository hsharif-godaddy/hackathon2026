/**
 * Standard JWKS (JSON Web Key Set) Endpoint
 * RFC 7517 compliant endpoint at /.well-known/jwks.json
 * 
 * This is the standard location that JWT libraries automatically discover
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicKey } from 'node:crypto';
import { getJWTService } from '../../../lib/jwt-service';
import { logger } from '../../../lib/request-context';

export interface JWKSResponse {
  keys: JWK[];
}

export interface JWK {
  kty: string;       // Key Type - "RSA" for RSA keys
  use: string;       // Public Key Use - "sig" for signature
  key_ops: string[]; // Key Operations - ["verify"] for verification
  alg: string;       // Algorithm - "RS256" for RSA with SHA-256
  kid: string;       // Key ID - unique identifier
  n: string;         // RSA public key modulus (base64url encoded)
  e: string;         // RSA public key exponent (base64url encoded)
}

/**
 * Convert PEM public key to JWK format using Node.js crypto
 */
function pemToJwk(pemKey: string, keyId: string): JWK {
  const publicKey = createPublicKey(pemKey);
  
  const jwk = publicKey.export({ format: 'jwk' });
  
  return {
    kty: jwk.kty || 'RSA',
    use: 'sig',
    key_ops: ['verify'],
    alg: 'RS256',
    kid: keyId,
    n: jwk.n || '',
    e: jwk.e || ''
  };
}

/**
 * GET /.well-known/jwks.json
 * 
 * Standard JWKS endpoint as defined by RFC 7517 and OpenID Connect Discovery.
 * This endpoint is automatically discovered by JWT libraries and services.
 * 
 * Response format complies with:
 * - RFC 7517: JSON Web Key (JWK)
 * - RFC 7518: JSON Web Algorithms (JWA) 
 * - OpenID Connect Discovery 1.0
 */
export async function GET(request: NextRequest) {
  try {
    logger.info('jwks.wellknown.request', {
      userAgent: request.headers.get('user-agent'),
      origin: request.headers.get('origin'),
      path: '/.well-known/jwks.json'
    });

    // Get JWT service
    const jwtService = getJWTService();
    
    // Fetch all public keys from Secrets Manager
    const keyMetadata = await jwtService.getPublicKeys();
    
    // Convert to JWK format - only include active and rotating keys
    const jwks: JWK[] = keyMetadata
      .filter(key => key.status === 'active' || key.status === 'rotating')
      .map(key => {
        try {
          return pemToJwk(key.publicKey, key.keyId);
        } catch (error) {
          logger.error('jwks.wellknown.key.conversion.error', {
            keyId: key.keyId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          return null;
        }
      })
      .filter((jwk): jwk is JWK => jwk !== null);

    const response: JWKSResponse = { 
      keys: jwks 
    };
    
    logger.info('jwks.wellknown.success', {
      keyCount: jwks.length,
      keyIds: jwks.map(k => k.kid),
      activeKeys: keyMetadata.filter(k => k.status === 'active').length,
      rotatingKeys: keyMetadata.filter(k => k.status === 'rotating').length
    });

    // Standard headers for JWKS endpoint
    return NextResponse.json(response, {
      headers: {
        // Cache for 5 minutes (300 seconds) to balance freshness vs performance
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
        'Content-Type': 'application/json; charset=utf-8',
        
        // CORS headers for cross-origin access by JWT libraries
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400', // 24 hours
        
        // Security headers
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        
        // JWKS-specific headers
        'Vary': 'Accept-Encoding',
        'ETag': `"jwks-${Date.now()}"` // Simple ETag for cache validation
      }
    });

  } catch (error) {
    logger.error('jwks.wellknown.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      path: '/.well-known/jwks.json'
    });
    
    // Return a properly formatted error response
    return NextResponse.json(
      { 
        error: 'jwks_unavailable',
        error_description: 'The JSON Web Key Set is temporarily unavailable'
      },
      { 
        status: 503, // Service Unavailable
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Retry-After': '60' // Suggest retry in 60 seconds
        }
      }
    );
  }
}

/**
 * Handle CORS preflight requests for the JWKS endpoint
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      'Content-Length': '0'
    }
  });
}

/**
 * Handle HEAD requests (same as GET but without body)
 */
export async function HEAD(request: NextRequest) {
  const getResponse = await GET(request);
  
  // Return same headers as GET but without body
  return new Response(null, {
    status: getResponse.status,
    headers: getResponse.headers
  });
}
