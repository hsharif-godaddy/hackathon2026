'use client'

import { useCallback, useEffect, useMemo } from 'react'

import { useIsFullscreen } from '@/hooks/useFullscreen'
import { useTranslations } from '@/hooks/useTranslations'
import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/request-context'
import type { GoogleLocation } from '@/lib/social'
import { socialV2Client } from '@/lib/social'
import { ALL_PLATFORM_CONFIG, getPlatformStrategy, PLATFORM_TRANSFORMS, PlatformConfig, SocialPlatform } from '@/lib/social-platforms'
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
  isActive: boolean
  onSuccess?: () => void
  onClose: () => void
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
  normalizedPlatform: SocialPlatform
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
  isActive,
  onSuccess,
  onClose,
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

  const normalizedPlatform = PLATFORM_TRANSFORMS.toDisplay(platform) as SocialPlatform
  const strategy = getPlatformStrategy(platform)
  const config = ALL_PLATFORM_CONFIG[normalizedPlatform] || { name: platform, Icon: null }
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
    enabled: isActive && flowState.showSelectExisting && !flowState.forceNewConnection
  })

  const createConnectionFlow = useCreateAndLinkConnection()
  const linkMutation = useLinkConnection()

  // Facebook/Instagram/GBP use SocialFlowsConnectWidget
  // which handles its own OAuth — skip the popup-based OAuth flow.
  const isFacebookPlatform = normalizedPlatform.toLowerCase() === SocialPlatform.FACEBOOK
  const isInstagramPlatform = normalizedPlatform.toLowerCase() === SocialPlatform.INSTAGRAM
  const isGBPPlatform = normalizedPlatform.toLowerCase() === SocialPlatform.GOOGLE

  const shouldProceedToOAuth = useMemo(() => {
    if (isFacebookPlatform || isInstagramPlatform || isGBPPlatform) return false
    if (flowState.forceNewConnection) return true
    if (flowState.step === FlowStep.Auth) return true
    if (flowState.step === FlowStep.ValidatingPermissions) return true
    if (isSelectExistingLoading) return false
    if (flowState.showSelectExisting) return false
    return !currentAssociation && platformConnections.length === 0
  }, [isFacebookPlatform, isInstagramPlatform, isGBPPlatform, flowState.forceNewConnection, flowState.step, flowState.showSelectExisting, isSelectExistingLoading, currentAssociation, platformConnections])

  const {
    authUrl,
    isLoadingAuthUrl,
    authUrlError,
    isValidatingPermissions,
    platformPages,
    isPagesLoading,
  } = useSocialOAuthFlow({
    platform: normalizedPlatform,
    appId,
    state,
    enabled: isActive && shouldProceedToOAuth,
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
    isFacebookPlatform || isInstagramPlatform || isGBPPlatform || !autoOpen || flowState.forceNewConnection || flowState.showSelectExisting || isSelectExistingLoading
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

    const accountId = strategy.provider === SocialPlatform.GOOGLE
      ? (platformPages as GoogleLocation[]).find(loc => loc.id === pageId)?.accountId
      : undefined

    dispatch({ type: SocialFlowAction.ConnectionCreating })

    try {
      if (strategy.provider === SocialPlatform.GOOGLE && !accountId) {
        throw new Error('Could not find account information for this Google location. Please refresh and try connecting again.')
      }

      await createConnectionFlow.mutateAsync({
        platform,
        appId,
        userTokenId: flowState.userTokenId,
        pageTokens: flowState.pageTokens,
        pageId,
        accountId,
      })

      dispatch({ type: SocialFlowAction.ConnectionCreated })
    } catch (err) {
      dispatch({ type: SocialFlowAction.Error, error: getErrorMessage(err) })
    }
  }, [flowState.userTokenId, flowState.pageTokens, platform, appId, createConnectionFlow, dispatch, t, platformPages, strategy.provider])

  const handleCancelSelection = useCallback(() => {
    onClose()
  }, [onClose])

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
