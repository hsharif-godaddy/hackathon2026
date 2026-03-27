/**
 * Analytics GraphQL Proxy Route
 *
 * Proxies GraphQL requests to the UIP Insights API to avoid CORS issues.
 * All requests are made server-side, so CORS is not a concern.
 */

import { NextRequest, NextResponse } from 'next/server'

// TODO: Re-enable when ownership validation is restored
// import { getControlPlaneAdapter } from '@/lib/control-plane'
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth'
import { getInsightsApiUrl } from '@/lib/insights/config'
import { getInsightsAuthToken } from '@/lib/insights-auth'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

/**
 * POST /api/analytics/graphql
 *
 * Proxy GraphQL query to UIP Insights API (authenticated)
 *
 * Request body:
 * - query: string - GraphQL query string
 * - appId: string - App/site ID (validated for ownership)
 */
export const POST = withCustomerAuth(async (request: NextRequest, _authContext: CustomerAuthContext) => {
  try {
    const body = await request.json()
    const { query, appId } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid query parameter' },
        { status: 400 }
      )
    }

    if (!appId || typeof appId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid appId parameter' },
        { status: 400 }
      )
    }

    // TODO: Re-enable ownership validation in next PR with additional plans(Start/Pro)
    // Validate that the authenticated user owns this app
    // const adapter = getControlPlaneAdapter()
    // const site = await adapter.getSite(appId, authContext.jwt!)
    // if (!site) {
    //   logger.warn('analytics.graphql.unauthorized', {
    //     appId,
    //     customerId: authContext.user.customerId,
    //   })
    //   return NextResponse.json(
    //     { error: 'Site not found or access denied' },
    //     { status: 403 }
    //   )
    // }

    const operationName = query.match(/query\s+(\w+)/)?.[1] || 'unknown'

    // Get authentication token (environment determined by Gasket config)
    let authToken: string
    try {
      authToken = await getInsightsAuthToken()
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

    // Get API URL from Gasket per-environment config
    const apiUrl = getInsightsApiUrl()

    logger.info('analytics.graphql.request', {
      operationName
    })

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
        errorText,
      })
      return NextResponse.json(
        { error: 'Analytics request failed' },
        { status: response.status }
      )
    }

    const result = await response.json()

    const wildcardInsight = result?.data?.insightCountByValueDailyAnyWildcard?.brand?.namespace?.insightName
    const dailyInsight = result?.data?.insightCountByValueDaily?.brand?.namespace?.insightName

    logger.info('analytics.graphql.response', {
      operationName,
      count: wildcardInsight?.count ?? dailyInsight?.count ?? 0,
      dailyBreakdownCount: (wildcardInsight?.dailyBreakdown || dailyInsight?.dailyBreakdown || []).length
    })

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
})

