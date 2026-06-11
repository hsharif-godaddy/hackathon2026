import { NextRequest, NextResponse } from 'next/server';

/**
 * Allowed origins for cross-origin requests from GoDaddy account pages
 */
const ALLOWED_ORIGINS = [
  'https://account.test-godaddy.com',
  'https://account.godaddy.com',
  'https://local.cx.test-godaddy.com:8443',
  'https://local.cx.godaddy.com:8443',
];

/**
 * Add CORS headers to response if origin is allowed
 */
export function withCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return response;
}

/**
 * Create OPTIONS handler for CORS preflight requests
 */
export function createCorsOptionsHandler() {
  return async function OPTIONS(request: NextRequest): Promise<NextResponse> {
    const origin = request.headers.get('origin');
    const response = new NextResponse(null, { status: 204 });
    return withCorsHeaders(response, origin);
  };
}
