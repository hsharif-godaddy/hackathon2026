import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// This will run once when the middleware is first loaded
import { logStartupConfiguration } from './src/lib/startup-config'

// Log startup configuration when middleware loads
logStartupConfiguration()

export function middleware(request: NextRequest) {
  // Just pass through all requests
  return NextResponse.next()
}

export const config = {
  // Match all API routes to ensure middleware runs
  matcher: '/api/:path*'
}