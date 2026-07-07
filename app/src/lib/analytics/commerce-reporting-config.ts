import 'server-only'

import { resolveGoDaddyApiBaseUrl } from '@/lib/mcp/godaddy-api'

const REPORTING_URL_BY_API_HOST: Record<string, string> = {
  'api.dev-godaddy.com': 'https://reporting.commerce.dev-godaddy.com',
  'api.test-godaddy.com': 'https://reporting.commerce.test-godaddy.com',
  'api.godaddy.com': 'https://reporting.commerce.godaddy.com',
}

export function getCommerceReportingApiUrl(): string {
  const override = process.env.COMMERCE_REPORTING_API_URL?.trim()
  if (override) {
    return override.replace(/\/+$/, '')
  }

  try {
    const apiHost = new URL(resolveGoDaddyApiBaseUrl()).host.toLowerCase()
    const mapped = REPORTING_URL_BY_API_HOST[apiHost]
    if (mapped) return mapped
  } catch {
    // fall through to production default
  }

  return REPORTING_URL_BY_API_HOST['api.godaddy.com']
}
