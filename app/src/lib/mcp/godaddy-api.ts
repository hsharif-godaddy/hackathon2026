/**
 * GoDaddy API environment resolution for MCP proxy integrations.
 *
 * Prefer explicit GODADDY_API_BASE_URL. When Katana/non-local deployments omit
 * it, derive the API host from other GoDaddy-owned environment URLs already
 * present in the BFF environment, then fall back to the deployment environment
 * name. This keeps Commerce MCP and OAuth token endpoint resolution aligned.
 */

const API_BASE_BY_ROOT_DOMAIN: Record<string, string> = {
  'dev-godaddy.com': 'https://api.dev-godaddy.com',
  'test-godaddy.com': 'https://api.test-godaddy.com',
  'godaddy.com': 'https://api.godaddy.com',
}

const URL_ENV_CANDIDATES = [
  'SSO_LOGIN_URL',
  'SSO_LOGOUT_URL',
  'LOGIN_REDIRECT_URL',
  'LOGOUT_REDIRECT_URL',
  'NEXT_PUBLIC_APP_URL',
] as const

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

function apiBaseFromHost(host: string): string | null {
  const hostname = host.toLowerCase().split(':')[0]
  for (const rootDomain of ['dev-godaddy.com', 'test-godaddy.com', 'godaddy.com']) {
    if (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`)) {
      return API_BASE_BY_ROOT_DOMAIN[rootDomain]
    }
  }
  return null
}

function apiBaseFromUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`
    return apiBaseFromHost(new URL(withScheme).host)
  } catch {
    return null
  }
}

function apiBaseFromEnvironmentName(): string | null {
  const envName = (
    process.env.GODADDY_ENVIRONMENT ||
    process.env.ENVIRONMENT_NAME ||
    process.env.KATANA_ENVIRONMENT ||
    ''
  ).toLowerCase()

  if (!envName) {
    return process.env.NODE_ENV === 'development' ? 'https://api.dev-godaddy.com' : null
  }

  if (envName === 'production' || envName === 'prod') return 'https://api.godaddy.com'
  if (envName === 'test' || envName.startsWith('test-')) return 'https://api.test-godaddy.com'

  // Katana pre-test should exercise TEST GoDaddy APIs. Branch/dev-private
  // deployments can still override with GODADDY_API_BASE_URL when needed.
  if (envName === 'pre-test') return 'https://api.test-godaddy.com'

  if (
    envName === 'development' ||
    envName === 'pre-development' ||
    envName.startsWith('dev-')
  ) {
    return 'https://api.dev-godaddy.com'
  }

  return null
}

export function resolveGoDaddyApiBaseUrl(): string {
  if (process.env.GODADDY_API_BASE_URL) {
    return normalizeApiBaseUrl(process.env.GODADDY_API_BASE_URL)
  }

  // Some deployed environments expose the same GoDaddy API base as
  // GATEWAY_BASE_URL. Treat it as an equivalent explicit source.
  if (process.env.GATEWAY_BASE_URL) {
    return normalizeApiBaseUrl(process.env.GATEWAY_BASE_URL)
  }

  for (const envName of URL_ENV_CANDIDATES) {
    const inferred = apiBaseFromUrl(process.env[envName])
    if (inferred) return inferred
  }

  const fromEnvironment = apiBaseFromEnvironmentName()
  if (fromEnvironment) return fromEnvironment

  throw new Error(
    'Cannot resolve GoDaddy API base URL: set GODADDY_API_BASE_URL/GATEWAY_BASE_URL or provide a GoDaddy environment URL (SSO_LOGIN_URL, LOGIN_REDIRECT_URL, NEXT_PUBLIC_APP_URL) or ENVIRONMENT_NAME',
  )
}
