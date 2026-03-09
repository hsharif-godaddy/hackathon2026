/**
 * Standard JWKS (JSON Web Key Set) Endpoint
 * RFC 7517 compliant endpoint at /.well-known/jwks.json
 *
 * This is the standard location that JWT libraries automatically discover
 */

import { createHash, createPublicKey } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

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

/** Cached JWKS response — keys change rarely (rotation only) */
let jwksCache: { response: JWKSResponse; etag: string; cachedAt: number } | null = null;
let jwksInflight: Promise<{ response: JWKSResponse; etag: string }> | null = null;
const JWKS_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes, matches JWTService key cache

async function fetchJWKS(): Promise<{ response: JWKSResponse; etag: string }> {
  const jwtService = getJWTService();
  const keyMetadata = await jwtService.getPublicKeys();

  const jwks: JWK[] = keyMetadata
    .filter(key => key.status === 'active' || key.status === 'rotating')
    .sort((a, b) => a.keyId.localeCompare(b.keyId))
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

  const response: JWKSResponse = { keys: jwks };
  const etag = `"jwks-${createHash('sha256').update(JSON.stringify(response)).digest('hex').slice(0, 12)}"`;

  if (jwks.length > 0) {
    jwksCache = { response, etag, cachedAt: Date.now() };
    return { response, etag };
  }

  // Empty result — serve stale cache if available, otherwise return empty.
  // Update cachedAt to rate-limit upstream retries during sustained outages.
  if (jwksCache) {
    logger.warn('jwks.wellknown.stale.fallback', { cachedAt: jwksCache.cachedAt });
    jwksCache = { ...jwksCache, cachedAt: Date.now() };
    return { response: jwksCache.response, etag: jwksCache.etag };
  }
  return { response, etag };
}

async function getJWKSResponse(): Promise<{ response: JWKSResponse; etag: string }> {
  if (jwksCache && (Date.now() - jwksCache.cachedAt) < JWKS_CACHE_MAX_AGE) {
    return { response: jwksCache.response, etag: jwksCache.etag };
  }

  // Coalesce concurrent cold-miss fetches into a single request
  if (!jwksInflight) {
    jwksInflight = fetchJWKS().finally(() => { jwksInflight = null; });
  }
  return jwksInflight;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
} as const;

const JWKS_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
  'Content-Type': 'application/json; charset=utf-8',
  ...CORS_HEADERS,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Vary': 'Accept-Encoding',
} as const;

/** Check if the request's If-None-Match header matches the given ETag */
function etagMatches(request: NextRequest, etag: string): boolean {
  const ifNoneMatch = request.headers.get('if-none-match');
  if (!ifNoneMatch) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === '*') return true;
  // Handle comma-separated ETags and optional weak validator prefix (W/ with optional whitespace)
  return trimmed.split(',').some(tag => tag.trim().replace(/^W\/\s*/, '') === etag);
}

/**
 * GET /.well-known/jwks.json
 *
 * Standard JWKS endpoint as defined by RFC 7517 and OpenID Connect Discovery.
 * This endpoint is automatically discovered by JWT libraries and services.
 */
export async function GET(request: NextRequest) {
  try {
    const { response, etag } = await getJWKSResponse();

    if (etagMatches(request, etag)) {
      return new Response(null, {
        status: 304,
        headers: { ...CORS_HEADERS, 'Cache-Control': JWKS_HEADERS['Cache-Control'], 'ETag': etag }
      });
    }

    return NextResponse.json(response, {
      headers: { ...JWKS_HEADERS, 'ETag': etag }
    });

  } catch (error) {
    logger.error('jwks.wellknown.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        error: 'jwks_unavailable',
        error_description: 'The JSON Web Key Set is temporarily unavailable'
      },
      {
        status: 503,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Retry-After': '60'
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
    headers: { ...CORS_HEADERS, 'Content-Length': '0' }
  });
}

/**
 * Handle HEAD requests (same as GET but without body)
 */
export async function HEAD(request: NextRequest) {
  try {
    const { etag } = await getJWKSResponse();

    if (etagMatches(request, etag)) {
      return new Response(null, {
        status: 304,
        headers: { ...CORS_HEADERS, 'Cache-Control': JWKS_HEADERS['Cache-Control'], 'ETag': etag }
      });
    }

    return new Response(null, {
      status: 200,
      headers: { ...JWKS_HEADERS, 'ETag': etag }
    });
  } catch {
    return new Response(null, {
      status: 503,
      headers: { ...CORS_HEADERS, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Retry-After': '60' }
    });
  }
}
