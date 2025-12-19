import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUnlinkConnection } from '../mutations/useUnlinkConnection'

interface UseSocialPanelActionsParams {
  siteId: string
  siteLinks: any[]
}

interface UseSocialPanelActionsResult {
  // Modal state
  isModalOpen: boolean
  selectedPlatform: string
  selectedConnectionId: string | undefined
  unlinkingConnectionId: string | null

  // Actions
  handleConnectPlatform: (platform: string) => void
  handleSelectConnection: (platform: string) => void
  handleModalClose: () => void
  handleModalSuccess: () => void
  handleUnlinkConnection: (socialId: string) => Promise<void>
  refreshConnections: () => void
}

/**
 * Hook for managing social panel actions and state
 * Handles modal state, platform connections, and unlinking
 */
export function useSocialPanelActions({
  siteId,
  siteLinks
}: UseSocialPanelActionsParams): UseSocialPanelActionsResult {
  const queryClient = useQueryClient()
  const unlinkMutation = useUnlinkConnection()

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string>('')
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>()
  const [unlinkingConnectionId, setUnlinkingConnectionId] = useState<string | null>(null)

  const refreshConnections = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['social-connections'] })
    queryClient.invalidateQueries({ queryKey: ['site-links', siteId] })
  }, [queryClient, siteId])

  const handleConnectPlatform = useCallback((platform: string) => {
    setSelectedPlatform(platform)
    setSelectedConnectionId(undefined)
    setIsModalOpen(true)
  }, [])

  const handleSelectConnection = useCallback((platform: string) => {
    setSelectedPlatform(platform)
    setSelectedConnectionId(undefined)
    setIsModalOpen(true)
  }, [])

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false)
    setSelectedPlatform('')
    setSelectedConnectionId(undefined)
  }, [])

  const handleModalSuccess = useCallback(() => {
    setIsModalOpen(false)
    setSelectedPlatform('')
    setSelectedConnectionId(undefined)
    queryClient.invalidateQueries({ queryKey: ['site-links', siteId] })
  }, [queryClient, siteId])

  const handleUnlinkConnection = useCallback(async (socialId: string) => {
    const association = siteLinks.find(link => link.social_id === socialId)
    if (!association) {
      return
    }

    setUnlinkingConnectionId(socialId)
    try {
      await unlinkMutation.mutateAsync({
        siteId,
        associationId: association.id
      })
    } catch (error) {
      // Error is handled by mutation
    } finally {
      setUnlinkingConnectionId(null)
    }
  }, [siteLinks, siteId, unlinkMutation])

  return {
    isModalOpen,
    selectedPlatform,
    selectedConnectionId,
    unlinkingConnectionId,
    handleConnectPlatform,
    handleSelectConnection,
    handleModalClose,
    handleModalSuccess,
    handleUnlinkConnection,
    refreshConnections
  }
}
