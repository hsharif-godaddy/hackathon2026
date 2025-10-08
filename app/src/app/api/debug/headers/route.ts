import { NextRequest, NextResponse } from 'next/server';

/**
 * Debug endpoint to inspect request headers
 *
 * Returns all request headers as JSON for debugging purposes.
 * Useful for troubleshooting middleware, authentication, and proxy configurations.
 *
 * Requires X-Debug-Key header with the correct secret value.
 *
 * @returns JSON response with all request headers
 */
export const dynamic = 'force-dynamic';

const DEBUG = 'debug-airo-7f9e2b4a-3c8d-4e1f-9a6b-2d5c8e1f4a7b';

export async function GET(request: NextRequest) {
  const debugKey = request.headers.get('x-debug-key');

  if (debugKey !== DEBUG) {
    return NextResponse.json({
      error: 'Unauthorized',
      message: 'Valid X-Debug-Key header required'
    }, {
      status: 401,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json'
      }
    });
  }

  const headers: Record<string, string> = {};

  request.headers.forEach(function addHeader(value, key) {
    headers[key] = value;
  });

  return NextResponse.json({
    headers,
    url: request.url,
    method: request.method,
    timestamp: new Date().toISOString()
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Type': 'application/json'
    }
  });
}

