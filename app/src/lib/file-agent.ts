/**
 * File Agent Helper
 *
 * Provides utilities for direct agent communication for file operations
 */

import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { appFetch } from './gasket-config'

export interface AgentTokenResponse {
  token: string
  expires: string
  siteId: string
  type: string
}

interface CachedToken {
  token: string
  expiresAt: number
}

// Per-appId token cache. Tokens are reused until 30s before expiry.
const tokenCache = new Map<string, CachedToken>()
const CACHE_BUFFER_MS = 30_000

function getCachedToken(appId: string): string | null {
  const cached = tokenCache.get(appId)
  if (!cached) {return null}
  if (Date.now() >= cached.expiresAt - CACHE_BUFFER_MS) {
    tokenCache.delete(appId)
    return null
  }
  return cached.token
}

async function fetchToken(appId: string): Promise<string> {
  const cached = getCachedToken(appId)
  if (cached) {return cached}

  const response = await appFetch('/api/auth/agent-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: appId })
  })

  if (!response.ok) {
    throw new Error(`Failed to get agent token: ${response.status}`)
  }

  const tokenData: AgentTokenResponse = await response.json()

  tokenCache.set(appId, {
    token: tokenData.token,
    expiresAt: new Date(tokenData.expires).getTime()
  })

  return tokenData.token
}

/**
 * Get agent token and construct file upload URL.
 * Token is cached until expiry. Token fetch and URL resolution run in parallel.
 */
export async function getFileUploadAgent(appId: string): Promise<{
  token: string
  uploadUrl: string
}> {
  const [token, uploadUrl] = await Promise.all([
    fetchToken(appId),
    buildDynamicAgentUrl('files/upload', appId)
  ])

  return { token, uploadUrl }
}

/**
 * Get agent token and construct file serve URL.
 * Token is cached until expiry. Token fetch and URL resolution run in parallel.
 */
export async function getFileServeAgent(appId: string, filename: string): Promise<{
  token: string
  serveUrl: string
}> {
  const [token, serveUrl] = await Promise.all([
    fetchToken(appId),
    buildDynamicAgentUrl(`files/uploads/${appId}/${filename}`, appId)
  ])

  return { token, serveUrl }
}

/**
 * Get agent token and construct upload metadata URL.
 * Token is cached until expiry. Token fetch and URL resolution run in parallel.
 */
export async function getFileMetadataAgent(appId: string, uploadId: string): Promise<{
  token: string
  metadataUrl: string
}> {
  const [token, metadataUrl] = await Promise.all([
    fetchToken(appId),
    buildDynamicAgentUrl(`files/${appId}/${uploadId}`, appId)
  ])

  return { token, metadataUrl }
}
