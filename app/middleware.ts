import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { logger } from './src/lib/request-context'

// This will run once when the middleware is first loaded
import { logStartupConfiguration } from './src/lib/startup-config'

// Log startup configuration when middleware loads
logStartupConfiguration()

/**
 * Middleware to log all API requests with OpenTelemetry trace correlation
 */
export function middleware(request: NextRequest) {
  const start = Date.now()
  const { pathname, searchParams } = new URL(request.url)
  const method = request.method
  
  // Log incoming request
  logger.info('api.request.start', {
    message: `${method} ${pathname}`,
    method,
    pathname,
    query: Object.fromEntries(searchParams),
    userAgent: request.headers.get('user-agent'),
    referer: request.headers.get('referer')
  })
  
  // Continue processing
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
  // Match all API routes to ensure middleware runs
  matcher: '/api/:path*'
}