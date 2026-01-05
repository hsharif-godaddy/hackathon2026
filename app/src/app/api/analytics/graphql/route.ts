/**
 * Analytics GraphQL Proxy Route
 *
 * Proxies GraphQL requests to the UIP Insights API to avoid CORS issues.
 * All requests are made server-side, so CORS is not a concern.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getInsightsAuthToken } from '@/lib/insights-auth'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

/**
 * POST /api/analytics/graphql
 *
 * Proxy GraphQL query to UIP Insights API
 *
 * Request body:
 * - query: string - GraphQL query string
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { query } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid query parameter' },
        { status: 400 }
      )
    }

    // Get hostname from request headers for environment detection
    const host = request.headers.get('host') || ''
    const hostname = host.split(':')[0]

    // Get authentication token
    let authToken: string
    try {
      authToken = await getInsightsAuthToken(hostname)
    } catch (error) {
      logger.error('analytics.graphql.auth-failed', {
        message: 'Failed to get authentication token',
        error: error instanceof Error ? error.message : String(error)
      })
      return NextResponse.json(
        { error: 'Failed to authenticate with insights API' },
        { status: 500 }
      )
    }

    // Get API URL based on hostname (server-side)
    const isLocalhost = hostname === 'localhost' || 
                       hostname === '127.0.0.1' || 
                       hostname.startsWith('localhost:') ||
                       hostname.startsWith('127.0.0.1:')
    const isTestOrDev = isLocalhost || hostname.includes('test-') || hostname.includes('dev-')
    const apiUrl = isTestOrDev
      ? 'https://uip.api.int.test-godaddy.com/v1/insights/graphql'
      : 'https://uip.api.int.godaddy.com/v1/insights/graphql'

    // Forward request to UIP Insights API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken
      },
      body: JSON.stringify({ query })
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      logger.error('analytics.graphql.api-error', {
        message: 'UIP API returned error',
        status: response.status,
        error: errorText
      })
      return NextResponse.json(
        { error: `API error: ${errorText}` },
        { status: response.status }
      )
    }

    const result = await response.json()

    // Return the GraphQL response
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    })
  } catch (error) {
    logger.error('analytics.graphql.error', {
      message: 'GraphQL proxy error',
      error: error instanceof Error ? error.message : String(error)
    })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

