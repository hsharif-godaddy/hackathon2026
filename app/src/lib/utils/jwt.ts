import { NextRequest } from 'next/server';

/**
 * Extract JWT token from request
 *
 * Looks for token in:
 * 1. Authorization header (Bearer token)
 * 2. Cookie (if configured)
 *
 * @param request - Next.js request object
 * @returns JWT token string or null if not found
 */
export function extractJwtToken(request: NextRequest): string | null {
  // Try Authorization header first
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Try cookie as fallback (if using cookie-based auth)
  const cookieToken = request.cookies.get('auth-token')?.value;
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

