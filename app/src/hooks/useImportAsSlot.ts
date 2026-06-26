import { useCallback } from 'react'

import { type DynamicApiConfig, dynamicApiConfigService } from '@/config/dynamic-api'
import { regenerateToken, type RegenerateTokenResult } from '@/lib/jwt-regeneration'

export interface ImportAsSlotOptions {
  filename?: string
  imageUrl?: string
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const record: Record<string, unknown> = data as Record<string, unknown>
  if (typeof record.error === 'string') return record.error
  if (typeof record.message === 'string') return record.message
  return fallback
}

async function getResponseError(response: Response, fallback: string): Promise<Error> {
  const data: unknown = await response.json().catch((): null => null)
  return new Error(getErrorMessage(data, fallback))
}

export function useImportAsSlot(appId: string | null): (options: ImportAsSlotOptions) => Promise<string> {
  return useCallback(async (options: ImportAsSlotOptions): Promise<string> => {
    if (!appId) throw new Error('App ID required')
    const tokenResult: RegenerateTokenResult = await regenerateToken({ siteId: appId, force: true })
    const apiConfig: DynamicApiConfig = await dynamicApiConfigService.getConfigForSite(appId)
    if (!apiConfig.agentUrl) throw new Error('Agent URL not available')

    const hasFilename: boolean = typeof options.filename === 'string' && options.filename.length > 0
    const hasImageUrl: boolean = typeof options.imageUrl === 'string' && options.imageUrl.length > 0
    if (!hasFilename && !hasImageUrl) throw new Error('filename or imageUrl is required')

    const isUploadImport: boolean = hasFilename
    const mediaPath: string = isUploadImport ? 'import-upload' : 'import'
    const body: Record<string, string> = isUploadImport
      ? { filename: options.filename }
      : { imageUrl: options.imageUrl as string }

    const baseAgentUrl: string = apiConfig.agentUrl.replace(`/apps/${appId}`, '')
    const response: Response = await fetch(`${baseAgentUrl}/media/${appId}/slots/${mediaPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenResult.token}` },
      body: JSON.stringify(body),
    })

    if (!response.ok) throw await getResponseError(response, 'Failed to import media as slot')

    const data: Record<string, unknown> = await response.json()
    if (typeof data.slotPath !== 'string') throw new Error('Import response missing slotPath')
    return data.slotPath
  }, [appId])
}
