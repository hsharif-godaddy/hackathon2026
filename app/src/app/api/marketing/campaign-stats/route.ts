/**
 * Campaign Stats GraphQL Proxy Route
 *
 * Proxies campaign performance (leads) queries to the GoDaddy Customer Stats API.
 * The Customer Stats API is customer-authenticated: it expects the caller's own
 * shopper SSO JWT (`sso-jwt <jwt>`), not a service (cert) token. This route runs
 * server-side and forwards the signed-in shopper's validated token (authContext.jwt,
 * resolved by gd-auth from the Authorization header or the `auth_idp` cookie). The
 * endpoint is resolved per-environment from the gasket SSO host so a test deploy hits
 * the test data plane and a prod deploy hits prod. The GraphQL query is constructed
 * here from validated inputs, so the route never forwards arbitrary queries.
 */
import { NextRequest, NextResponse } from 'next/server'

import { getCampaignStatsApiUrl } from '@/lib/campaign-stats/config'
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

const APP_ID_PATTERN: RegExp = /^[a-z0-9]{10}$/

const CAMPAIGN_METRICS_QUERY: string = `
  query CampaignMetrics($appId: ID!, $campaignRefIds: [ID!]!) {
    campaigns(appId: $appId, campaignRefIds: $campaignRefIds) {
      id
      totals { leads }
      breakdown(by: [SOURCE, MEDIUM], sort: LEADS_DESC) {
        key { source medium }
        metrics { leads }
      }
    }
  }
`

interface CampaignStatsRequestBody {
  appId?: unknown
  campaignRefIds?: unknown
}

const MAX_CAMPAIGN_REF_IDS: number = 100

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value)
    && value.length > 0
    && value.length <= MAX_CAMPAIGN_REF_IDS
    && value.every((item: unknown): boolean => typeof item === 'string' && item.length > 0)
  )
}

/**
 * POST /api/marketing/campaign-stats
 *
 * Request body:
 * - appId: string - 10-char app/site id (scopes the query to one app)
 * - campaignRefIds: string[] - campaign ref tokens to fetch metrics for
 */
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const body: CampaignStatsRequestBody = await request.json()
    const appId: unknown = body.appId
    const campaignRefIds: unknown = body.campaignRefIds

    if (typeof appId !== 'string' || !APP_ID_PATTERN.test(appId)) {
      return NextResponse.json({ error: 'Missing or invalid appId parameter' }, { status: 400 })
    }

    if (!isNonEmptyStringArray(campaignRefIds)) {
      return NextResponse.json({ error: 'Missing or invalid campaignRefIds parameter' }, { status: 400 })
    }

    // The Customer Stats API authenticates as the end customer (shopper sso-jwt), not as a
    // service. authContext.jwt is the validated shopper token (from the Authorization header
    // or the `auth_idp` cookie), which the Customer Stats API accepts directly.
    const customerJwt: string | undefined = authContext.jwt
    if (!customerJwt) {
      logger.error('campaignStats.graphql.authFailed', {
        error: 'Missing customer JWT on authenticated context',
      })
      return NextResponse.json({ error: 'Failed to authenticate with stats API' }, { status: 401 })
    }
    const authToken: string = `sso-jwt ${customerJwt}`

    // Resolve the Customer Stats endpoint for the deployed environment.
    const apiUrl: string = getCampaignStatsApiUrl()

    const response: Response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authToken },
      body: JSON.stringify({
        query: CAMPAIGN_METRICS_QUERY,
        variables: { appId, campaignRefIds },
      }),
    })

    if (!response.ok) {
      const errorText: string = await response.text().catch((): string => 'Unknown error')
      logger.error('campaignStats.graphql.apiError', {
        appId,
        status: response.status,
        errorText: errorText.slice(0, 2000),
      })
      return NextResponse.json({ error: 'Campaign stats request failed' }, { status: response.status })
    }

    const result: { data?: { campaigns?: unknown }; errors?: unknown } = await response.json()
    const campaigns: unknown[] = Array.isArray(result.data?.campaigns) ? (result.data?.campaigns as unknown[]) : []

    // A GraphQL 200 can still carry an `errors` array (partial/whole failure). Never let that
    // masquerade as success: if the upstream reported errors and returned no usable campaign
    // data, surface a 502 so the client renders its error state instead of a misleading
    // "no visitors" empty result. If partial data is present, log and return what we have.
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      logger.error('campaignStats.graphql.graphqlErrors', {
        appId,
        campaignCount: campaigns.length,
        errors: JSON.stringify(result.errors).slice(0, 2000),
      })
      if (campaigns.length === 0) {
        return NextResponse.json({ error: 'Campaign stats request failed' }, { status: 502 })
      }
    }

    return NextResponse.json(
      { campaigns },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    )
  } catch (error) {
    logger.error('campaignStats.graphql.error', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
