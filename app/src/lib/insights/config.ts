import 'server-only'

/**
 * Insights API Configuration (Server-Only)
 *
 * Server-side configuration for insights GraphQL API client.
 * URL is set per-environment in gasket.ts (insightsApiUrl) and falls back
 * to the production endpoint so removal of the config never silently
 * breaks production.
 *
 * Client code should import from ./constants instead.
 */
import gasket from '../../../gasket.ts'

const PROD_INSIGHTS_API_URL = 'https://uip.api.int.godaddy.com/v1/insights/graphql'

/**
 * Get insights API URL from Gasket environment config.
 *
 * Priority: gasket env config → env var override → production fallback.
 *
 * @returns Insights GraphQL API URL
 */
export function getInsightsApiUrl(): string {
  return (gasket.config as any).insightsApiUrl
    ?? process.env.UIP_INSIGHTS_API_URL
    ?? PROD_INSIGHTS_API_URL
}

const PROD_SSO_HOST = 'sso.godaddy.com'

/**
 * Get SSO host for insights token generation from Gasket environment config.
 *
 * Always paired with insightsApiUrl so token and API endpoint are
 * guaranteed to target the same environment.
 *
 * @returns SSO hostname (e.g. 'sso.godaddy.com' or 'sso.test-godaddy.com')
 */
export function getInsightsSsoHost(): string {
  return (gasket.config as any).insightsSsoHost
    ?? PROD_SSO_HOST
}

