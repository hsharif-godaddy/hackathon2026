import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { logger } from './src/lib/request-context'
import { logStartupConfiguration } from './src/lib/startup-config'

logStartupConfiguration()

/**
 * Middleware for API request logging
 *
 * Note: OpenTelemetry instrumentation for pages is handled in root layout (layout.tsx)
 * because middleware runs in Edge Runtime where @vercel/otel context is NOT available.
 * Page instrumentation must happen in Node.js context (layout, route handlers).
 */
export function middleware(request: NextRequest) {
  const start = Date.now()
  const { pathname, searchParams } = new URL(request.url)
  const method = request.method

  // Log incoming API request
  logger.info('api.request.start', {
    message: `${method} ${pathname}`,
    method,
    pathname,
    query: Object.fromEntries(searchParams),
    userAgent: request.headers.get('user-agent'),
    referer: request.headers.get('referer')
  })

  const response = NextResponse.next()

  // Log request completion
  const duration = Date.now() - start
  logger.info('api.request.complete', {
    message: `${method} ${pathname} - ${response.status} (${duration}ms)`,
    method,
    pathname,
    status: response.status,
    durationMs: duration
  })

  return response
}

export const config = {
  matcher: [
    // Match API routes for logging (pages just pass through)
    '/api/:path*'
  ]
}