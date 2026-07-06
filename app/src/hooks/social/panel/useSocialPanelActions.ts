import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { usesSocialFlowsConnect } from '@/lib/social-platforms'
import { useUnlinkConnection } from '../mutations/useUnlinkConnection'

interface UseSocialPanelActionsParams {
  siteId: string
  siteLinks: any[]
}

interface UseSocialPanelActionsResult {
  // Modal state
  isModalOpen: boolean
  isSocialFlowsWidgetOpen: boolean
  selectedPlatform: string
  selectedConnectionId: string | undefined
  unlinkingConnectionId: string | null
  oauthState: string

  // Actions
  handleConnectPlatform: (platform: string) => void
  handleSelectConnection: (platform: string) => void
  handleModalClose: () => void
  handleModalSuccess: () => void
  handleFlowsClose: () => void
  openSocialFlowsFromModal: () => void
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
  const [isSocialFlowsWidgetOpen, setIsSocialFlowsWidgetOpen] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string>('')
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>()
  const [unlinkingConnectionId, setUnlinkingConnectionId] = useState<string | null>(null)
  const [oauthState, setOauthState] = useState<string>('')

  const resetConnectState = useCallback(() => {
    setIsModalOpen(false)
    setIsSocialFlowsWidgetOpen(false)
    setSelectedPlatform('')
    setSelectedConnectionId(undefined)
    setOauthState('')
  }, [])

  const refreshConnections = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['social-connections'] })
    queryClient.invalidateQueries({ queryKey: ['site-associations', siteId] })
  }, [queryClient, siteId])

  const handleConnectPlatform = useCallback((platform: string) => {
    setSelectedPlatform(platform)
    setSelectedConnectionId(undefined)
    setOauthState(`${platform}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`)
    if (usesSocialFlowsConnect(platform)) {
      setIsSocialFlowsWidgetOpen(true)
      setIsModalOpen(false)
      return
    }
    setIsModalOpen(true)
    setIsSocialFlowsWidgetOpen(false)
  }, [])

  const handleSelectConnection = useCallback((platform: string) => {
    setSelectedPlatform(platform)
    setSelectedConnectionId(undefined)
    setOauthState(`${platform}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`)
    setIsModalOpen(true)
    setIsSocialFlowsWidgetOpen(false)
  }, [])

  const openSocialFlowsFromModal = useCallback(() => {
    setIsModalOpen(false)
    setIsSocialFlowsWidgetOpen(true)
  }, [])

  const handleModalClose = useCallback(() => {
    resetConnectState()
  }, [resetConnectState])

  const handleFlowsClose = useCallback(() => {
    resetConnectState()
  }, [resetConnectState])

  const handleModalSuccess = useCallback(() => {
    resetConnectState()
    queryClient.invalidateQueries({ queryKey: ['site-associations', siteId] })
  }, [queryClient, siteId, resetConnectState])

  const handleUnlinkConnection = useCallback(async (socialId: string) => {
    const association = siteLinks.find(link => link.socialId === socialId)
    if (!association) {
      return
    }

    setUnlinkingConnectionId(socialId)
    try {
      await unlinkMutation.mutateAsync({
        siteId,
        associationId: association.id
      })
    } catch (_error) {
      // Error is handled by mutation
    } finally {
      setUnlinkingConnectionId(null)
    }
  }, [siteLinks, siteId, unlinkMutation])

  return {
    isModalOpen,
    isSocialFlowsWidgetOpen,
    selectedPlatform,
    selectedConnectionId,
    unlinkingConnectionId,
    oauthState,
    handleConnectPlatform,
    handleSelectConnection,
    handleModalClose,
    handleModalSuccess,
    handleFlowsClose,
    openSocialFlowsFromModal,
    handleUnlinkConnection,
    refreshConnections
  }
}
