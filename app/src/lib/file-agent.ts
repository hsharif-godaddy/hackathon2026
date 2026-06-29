/**
 * File Agent Helper
 *
 * Provides utilities for direct agent communication for file operations
 */

import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { getAgentToken } from '@/lib/agent-fetch'

/**
 * Get agent token and construct file upload URL.
 * Token fetch and URL resolution run in parallel.
 */
export async function getFileUploadAgent(appId: string): Promise<{
  token: string
  uploadUrl: string
}> {
  const [token, uploadUrl] = await Promise.all([
    getAgentToken(appId),
    buildDynamicAgentUrl('files/upload', appId)
  ])

  return { token, uploadUrl }
}

/**
 * Get agent token and construct file serve URL.
 * Token fetch and URL resolution run in parallel.
 */
export async function getFileServeAgent(appId: string, filename: string): Promise<{
  token: string
  serveUrl: string
}> {
  const [token, serveUrl] = await Promise.all([
    getAgentToken(appId),
    buildDynamicAgentUrl(`files/uploads/${appId}/${filename}`, appId)
  ])

  return { token, serveUrl }
}

/**
 * Get agent token and construct upload metadata URL.
 * Token fetch and URL resolution run in parallel.
 */
export async function getFileMetadataAgent(appId: string, uploadId: string): Promise<{
  token: string
  metadataUrl: string
}> {
  const [token, metadataUrl] = await Promise.all([
    getAgentToken(appId),
    buildDynamicAgentUrl(`files/${appId}/${uploadId}`, appId)
  ])

  return { token, metadataUrl }
}
