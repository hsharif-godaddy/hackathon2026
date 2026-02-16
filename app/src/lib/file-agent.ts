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

/**
 * Get agent token and construct file upload URL
 * @param appId Site ID to get token for
 * @returns Agent token and upload URL
 */
export async function getFileUploadAgent(appId: string): Promise<{
  token: string
  uploadUrl: string
}> {
  // Get agent token
  const response = await appFetch('/api/auth/agent-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: appId })
  })

  if (!response.ok) {
    throw new Error(`Failed to get agent token: ${response.status}`)
  }

  const tokenData: AgentTokenResponse = await response.json()

  // Build URL to agents service
  const uploadUrl = await buildDynamicAgentUrl('files/upload', appId)

  return {
    token: tokenData.token,
    uploadUrl
  }
}

/**
 * Get agent token and construct file serve URL
 * @param appId Site ID
 * @param filename Filename to serve
 * @returns Agent token and serve URL
 */
export async function getFileServeAgent(appId: string, filename: string): Promise<{
  token: string
  serveUrl: string
}> {
  // Get agent token
  const response = await appFetch('/api/auth/agent-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: appId })
  })

  if (!response.ok) {
    throw new Error(`Failed to get agent token: ${response.status}`)
  }

  const tokenData: AgentTokenResponse = await response.json()

  // Build URL to agents service
  const serveUrl = await buildDynamicAgentUrl(`files/uploads/${appId}/${filename}`, appId)

  return {
    token: tokenData.token,
    serveUrl
  }
}

/**
 * Get agent token and construct upload metadata URL
 * @param appId Site ID
 * @param uploadId Upload ID
 * @returns Agent token and metadata URL
 */
export async function getFileMetadataAgent(appId: string, uploadId: string): Promise<{
  token: string
  metadataUrl: string
}> {
  // Get agent token
  const response = await appFetch('/api/auth/agent-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: appId })
  })

  if (!response.ok) {
    throw new Error(`Failed to get agent token: ${response.status}`)
  }

  const tokenData: AgentTokenResponse = await response.json()

  // Build URL to agents service
  const metadataUrl = await buildDynamicAgentUrl(`files/${appId}/${uploadId}`, appId)

  return {
    token: tokenData.token,
    metadataUrl
  }
}
