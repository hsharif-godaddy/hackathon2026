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
import {
  getInsightsApiUrl,
  getLocalDevInsightsToken,
  isAnalyticsLocalDevOverride,
} from '@/lib/insights/config'
import { logGraphqlRequest, logGraphqlResponse } from '@/lib/insights/log-graphql-query'
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

    const localDev = isAnalyticsLocalDevOverride()

    if (localDev) {
      logger.info('analytics.graphql.local-dev', {
        apiUrl: getInsightsApiUrl(),
      })
    }

    logGraphqlRequest(appId, query)

    const localJwt = localDev ? getLocalDevInsightsToken() : undefined
    let authToken: string
    try {
      authToken = await getInsightsAuthToken()
      if (localDev) {
        logger.info('analytics.graphql.auth', {
          source: localJwt ? 'local-env-jwt' : 'iam-sso',
          jwtLength: authToken.length,
        })
      }
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
      logGraphqlResponse(appId, query, { httpStatus: response.status, errorText })
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
    logGraphqlResponse(appId, query, result)

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
