import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { dynamicApiConfigService } from '@/config/dynamic-api'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'

export interface MediaFolder {
  id: string
  name: string
  createdAt: string
  slots?: string[]
  isVirtual?: boolean
}

/** Default folder that always exists — media lands here by default */
export const SITE_FILES_FOLDER: MediaFolder = {
  id: '__site-files__',
  name: 'Site Files',
  createdAt: new Date(0).toISOString(),
  isVirtual: true,
}

interface UseMediaFoldersOptions {
  appId: string | null
}

async function resolveBaseAgentUrl(appId: string): Promise<string> {
  const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)
  if (!apiConfig.agentUrl) throw new Error('Agent URL not available')
  return apiConfig.agentUrl.replace(`/apps/${appId}`, '')
}

export function useMediaFolders({ appId }: UseMediaFoldersOptions) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['mediaFolders', appId],
    queryFn: async (): Promise<MediaFolder[]> => {
      if (!appId) return []
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const baseAgentUrl = await resolveBaseAgentUrl(appId)
      const response = await fetch(`${baseAgentUrl}/media/${appId}/folders`, {
        headers: { Authorization: `Bearer ${tokenResult.token}` },
      })
      if (!response.ok) throw new Error('Failed to fetch folders')
      const data = await response.json()
      return data.folders ?? []
    },
    enabled: !!appId,
    staleTime: 60 * 1000,
  })

  const createMutation = useMutation({
    mutationFn: async (name: string): Promise<MediaFolder> => {
      if (!appId) throw new Error('App ID required')
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const baseAgentUrl = await resolveBaseAgentUrl(appId)
      const response = await fetch(`${baseAgentUrl}/media/${appId}/folders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to create folder' }))
        throw new Error(data.error || 'Failed to create folder')
      }
      const data = await response.json()
      return data.folder
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mediaFolders', appId] })
    },
    onError: (error) => {
      logger.error('media_folders.create.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  const apiFolders = query.data ?? []
  const folders = apiFolders

  const moveMutation = useMutation({
    mutationFn: async ({ folderId, slotName }: { folderId: string; slotName: string }): Promise<void> => {
      if (!appId) throw new Error('App ID required')
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const baseAgentUrl = await resolveBaseAgentUrl(appId)
      const response = await fetch(`${baseAgentUrl}/media/${appId}/folders/${folderId}/move`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slotName }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to move media' }))
        throw new Error(data.error || 'Failed to move media')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mediaFolders', appId] })
    },
    onError: (error) => {
      logger.error('media_folders.move.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  return {
    folders,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    createFolder: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    createError: createMutation.error instanceof Error ? createMutation.error.message : null,
    moveToFolder: moveMutation.mutateAsync,
    isMoving: moveMutation.isPending,
  }
}
