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
import { logger } from '@/lib/request-context'
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
  return getLocalDevInsightsApiUrl()
    ?? (gasket.config as any).insightsApiUrl
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

const DEFAULT_DEV_INSIGHTS_API_URL = 'https://uip-dp.api.int.dev-godaddy.com/v1/insights/graphql'

export function isAnalyticsLocalDevOverride(): boolean {
  const flag = process.env.ANALYTICS_LOCAL_DEV
  return flag === '1' || flag === 'true'
}

export function getLocalDevInsightsApiUrl(): string | undefined {
  if (!isAnalyticsLocalDevOverride()) return undefined
  return process.env.ANALYTICS_LOCAL_API_URL?.trim() || DEFAULT_DEV_INSIGHTS_API_URL
}

function parseLocalDevJwt(raw: string | undefined): string | undefined {
  let token = raw?.trim()
  if (!token) return undefined
  if (
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim()
  }
  if (!token.startsWith('sso-jwt ')) {
    token = `sso-jwt ${token}`
  }
  if (token.length < 80) {
    return undefined
  }
  return token
}

export function getLocalDevInsightsToken(): string | undefined {
  if (!isAnalyticsLocalDevOverride()) return undefined
  const token = parseLocalDevJwt(process.env.ANALYTICS_LOCAL_SSO_JWT)
  if (!token) {
    logger.warn('analytics.local-dev.jwt-missing', {
      message: 'ANALYTICS_LOCAL_SSO_JWT is unset or truncated — wrap the full token in double quotes in .env.local',
      rawLength: process.env.ANALYTICS_LOCAL_SSO_JWT?.length ?? 0,
    })
  }
  return token
}

