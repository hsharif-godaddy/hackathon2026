import 'server-only'

/**
 * Customer Stats API Configuration (Server-Only)
 *
 * The Customer Stats GraphQL API serves campaign performance metrics (leads).
 * It is customer-authenticated: callers forward the signed-in shopper's SSO JWT
 * (`sso-jwt <jwt>`). The endpoint is resolved per-environment from the gasket SSO
 * host (`insightsSsoHost`), so the shopper token and the API always target the same
 * env (a test-signed token hits the test data plane, etc.).
 *
 * A `CUSTOMER_STATS_API_URL` env var overrides everything for local experimentation.
 */
import { getInsightsSsoHost } from '@/lib/insights/config'

const DEV_CAMPAIGN_STATS_API_URL = 'https://customer-stats.api.dev-godaddy.com/v4/graphql'
const TEST_CAMPAIGN_STATS_API_URL = 'https://customer-stats.api.test-godaddy.com/v4/graphql'
const PROD_CAMPAIGN_STATS_API_URL = 'https://customer-stats.api.godaddy.com/v4/graphql'

/**
 * Resolve the Customer Stats GraphQL endpoint from the ambient app environment.
 *
 * Priority: env var override → gasket SSO-host-derived env → test fallback.
 *
 * @returns Customer Stats GraphQL API URL
 */
export function getCampaignStatsApiUrl(): string {
  const override: string | undefined = process.env.CUSTOMER_STATS_API_URL?.trim()
  if (override) return override

  const ssoHost: string = getInsightsSsoHost()
  if (ssoHost === 'sso.godaddy.com') return PROD_CAMPAIGN_STATS_API_URL
  if (ssoHost === 'sso.dev-godaddy.com') return DEV_CAMPAIGN_STATS_API_URL
  return TEST_CAMPAIGN_STATS_API_URL
}
