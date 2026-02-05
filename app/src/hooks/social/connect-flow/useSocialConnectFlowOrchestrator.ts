'use client'

import { useCallback, useEffect, useMemo } from 'react'

import { useIsFullscreen } from '@/hooks/useFullscreen'
import { useTranslations } from '@/hooks/useTranslations'
import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/request-context'
import { socialV2Client } from '@/lib/social'
import { getPlatformStrategy, PLATFORM_CONFIG, PLATFORM_TRANSFORMS, PlatformConfig, SocialPlatform } from '@/lib/social-platforms'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
import { SocialFlowAction } from '@/types/social'
import { SOCIAL_SCOPES } from '@/types/social-scopes'
import { AuthStatus, useAuthPopup } from './useAuthPopup'
import { useSocialConnectFlow } from './useSocialConnectFlow'
import { FlowState, FlowStep, useSocialConnectFlowStateMachine } from './useSocialConnectFlowStateMachine'
import { useAutoSkipSelectionEffect } from './useSocialFlowEffects'
import { useSocialOAuthFlow } from './useSocialOAuthFlow'
import { useCreateAndLinkConnection } from '../mutations/useCreateAndLinkConnection'
import { useLinkConnection } from '../mutations/useLinkConnection'

export interface SocialConnectFlowOrchestratorProps {
  platform: string
  appId: string
  state: string
  initialStep?: FlowStep
  initialUserTokenId?: string
  autoOpen?: boolean
  onSuccess?: () => void
}

export interface SocialConnectFlowHandlers {
  handleSelectExisting: (socialId: string) => Promise<void>
  handleConnectNew: () => void
  handleChangeConnection: () => void
  handlePageSelection: (pageId: string) => Promise<void>
  handleCancelSelection: () => void
  openPopup: () => void
}

export interface SocialConnectFlowDerivedState {
  shouldShowExistingConnectionsLoader: boolean
  hasCurrentConnection: boolean
  shouldShowConnectionSelector: boolean
  platformPages: any[]
  isPagesLoading: boolean
}

export interface SocialConnectFlowOrchestratorResult {
  flowState: FlowState
  config: PlatformConfig
  normalizedPlatform: string
  handlers: SocialConnectFlowHandlers
  derivedState: SocialConnectFlowDerivedState
  authStatus: AuthStatus
  errorMessage: string | null
  currentConnectionDetails: SocialConnection | undefined
  enrichedPlatformConnections: Array<SocialConnection | EnrichedSocialConnection>
  isLoadingMetadata: boolean
  connectionsLoadingMetadata: Set<string>
  isLoadingAuthUrl: boolean
  authUrlError: Error | null
  authUrl: string | undefined
  isValidatingPermissions: boolean
  platform: string
}

export function useSocialConnectFlowOrchestrator({
  platform,
  appId,
  state,
  initialStep,
  initialUserTokenId,
  autoOpen = true,
  onSuccess,
}: SocialConnectFlowOrchestratorProps): SocialConnectFlowOrchestratorResult {
  const t = useTranslations()

  useEffect(() => {
    logger.info('social.connect_flow.state_sync', {
      platform,
      appId,
      state,
    })
  }, [state, platform, appId])

  const { state: flowState, dispatch } = useSocialConnectFlowStateMachine(
    initialStep || FlowStep.SelectExisting,
    3,
    initialUserTokenId
  )

  const normalizedPlatform = PLATFORM_TRANSFORMS.toDisplay(platform)
  const strategy = getPlatformStrategy(platform)
  const config = PLATFORM_CONFIG[normalizedPlatform] || { name: platform, Icon: null }
  const isFullscreen = useIsFullscreen()

  // Data fetching (enrichedPlatformConnections are pre-filtered to valid connections)
  const {
    isLoading: isSelectExistingLoading,
    availableConnections: platformConnections,
    enrichedConnections: enrichedPlatformConnections,
    currentSiteLink: currentAssociation,
    linkedConnection: currentConnectionDetails,
    isLoadingMetadata,
    connectionsLoadingMetadata
  } = useSocialConnectFlow({
    platform,
    appId,
    enabled: flowState.showSelectExisting && !flowState.forceNewConnection
  })

  const createConnectionFlow = useCreateAndLinkConnection()
  const linkMutation = useLinkConnection()

  const shouldProceedToOAuth = useMemo(() => {
    if (flowState.forceNewConnection) return true
    if (flowState.step === FlowStep.Auth) return true
    if (flowState.step === FlowStep.ValidatingPermissions) return true
    if (isSelectExistingLoading) return false
    if (flowState.showSelectExisting) return false
    return !currentAssociation && platformConnections.length === 0
  }, [flowState.forceNewConnection, flowState.step, flowState.showSelectExisting, isSelectExistingLoading, currentAssociation, platformConnections])

  const {
    authUrl,
    isLoadingAuthUrl,
    authUrlError,
    isValidatingPermissions,
    platformPages,
    isPagesLoading,
  } = useSocialOAuthFlow({
    platform: normalizedPlatform as SocialPlatform,
    appId,
    state,
    enabled: shouldProceedToOAuth,
    flowStep: flowState.step,
    userTokenId: flowState.userTokenId || '',
    pageTokens: flowState.pageTokens || [],
    popup: !isFullscreen,
    dispatch
  })

  // Handlers
  const handleOAuthSuccess = useCallback((oauthData: any) => {
    const userTokenId = oauthData.user_token
    if (!userTokenId) {
      dispatch({ type: SocialFlowAction.OAuthError, error: t('builder_social_error_no_user_token') })
      return
    }

    let tokens: string[] = []
    if (oauthData.page_tokens && Array.isArray(oauthData.page_tokens)) {
      tokens = oauthData.page_tokens
    } else if (typeof oauthData.page_tokens === 'string') {
      tokens = oauthData.page_tokens.split(',')
    }

    dispatch({ type: SocialFlowAction.OAuthSuccess, userTokenId, pageTokens: tokens })
  }, [dispatch, t])

  const { authStatus, errorMessage, openPopup } = useAuthPopup(
    authUrl || '',
    platform,
    state,
    handleOAuthSuccess,
    !autoOpen || flowState.forceNewConnection || flowState.showSelectExisting || isSelectExistingLoading
  )

  const handleSelectExisting = useCallback(async (socialId: string) => {
    const selectedConnection = enrichedPlatformConnections.find(c => c.socialId === socialId)

    if (!selectedConnection?.userTokenId) {
      dispatch({ type: SocialFlowAction.Error, error: t('builder_social_error_connection_not_found') })
      return
    }

    try {
      const requiredScopes = SOCIAL_SCOPES[strategy.provider] || []
      const validation = await socialV2Client.validatePermissions(
        strategy.provider,
        selectedConnection.userTokenId,
        requiredScopes
      )

      if (!validation.valid) {
        dispatch({
          type: SocialFlowAction.PermissionsInvalid,
          missingScopes: validation.missingScopes
        })
        return
      }

      await linkMutation.mutateAsync({
        siteId: appId,
        socialId,
        platform: platform.toLowerCase()
      })

      dispatch({ type: SocialFlowAction.ExistingSelected })
    } catch (error) {
      dispatch({ type: SocialFlowAction.Error, error: getErrorMessage(error) })
    }
  }, [strategy.provider, enrichedPlatformConnections, dispatch, appId, linkMutation, platform, t])

  const handleConnectNew = useCallback(() => {
    dispatch({ type: SocialFlowAction.StartOAuth })
  }, [dispatch])

  const handleChangeConnection = useCallback(() => {
    dispatch({ type: SocialFlowAction.ForceNewConnection })
  }, [dispatch])

  const handlePageSelection = useCallback(async (pageId: string) => {
    if (!flowState.userTokenId || !flowState.pageTokens) {
      dispatch({ type: SocialFlowAction.Error, error: t('builder_social_error_missing_tokens') })
      return
    }

    dispatch({ type: SocialFlowAction.ConnectionCreating })

    try {
      await createConnectionFlow.mutateAsync({
        platform,
        appId,
        userTokenId: flowState.userTokenId,
        pageTokens: flowState.pageTokens,
        pageId
      })

      dispatch({ type: SocialFlowAction.ConnectionCreated })
    } catch (err) {
      dispatch({ type: SocialFlowAction.Error, error: getErrorMessage(err) })
    }
  }, [flowState.userTokenId, flowState.pageTokens, platform, appId, createConnectionFlow, dispatch, t])

  const handleCancelSelection = useCallback(() => {
    dispatch({ type: SocialFlowAction.Error, error: t('builder_social_error_cancelled_page_selection') })
  }, [dispatch, t])

  // Derived state
  const shouldShowExistingConnectionsLoader =
    flowState.showSelectExisting &&
    !flowState.forceNewConnection &&
    isSelectExistingLoading

  const hasCurrentConnection = !!(
    flowState.showSelectExisting &&
    !flowState.forceNewConnection &&
    currentAssociation
  )

  const shouldShowConnectionSelector =
    flowState.showSelectExisting &&
    !flowState.forceNewConnection &&
    platformConnections.length > 0

  // Effects
  useAutoSkipSelectionEffect({
    isSelectExistingLoading,
    showSelectExisting: flowState.showSelectExisting,
    forceNewConnection: flowState.forceNewConnection,
    currentAssociation,
    platformConnectionsCount: platformConnections.length,
    dispatch,
  })

  useEffect(() => {
    if (flowState.step === FlowStep.Complete && onSuccess) {
      onSuccess()
    }
  }, [flowState.step, onSuccess])

  return {
    flowState,
    config,
    normalizedPlatform,
    handlers: {
      handleSelectExisting,
      handleConnectNew,
      handleChangeConnection,
      handlePageSelection,
      handleCancelSelection,
      openPopup,
    },
    derivedState: {
      shouldShowExistingConnectionsLoader,
      hasCurrentConnection,
      shouldShowConnectionSelector,
      platformPages,
      isPagesLoading,
    },
    authStatus,
    errorMessage,
    currentConnectionDetails,
    enrichedPlatformConnections,
    isLoadingMetadata,
    connectionsLoadingMetadata,
    isLoadingAuthUrl,
    authUrlError,
    authUrl,
    isValidatingPermissions,
    platform,
  }
}
