import { AuthStatus } from '@/hooks/social/connect-flow/useAuthPopup'
import { FlowStep } from '@/hooks/social/connect-flow/useSocialConnectFlowStateMachine'
import { useTranslations } from '@/hooks/useTranslations'
import { getErrorMessage } from '@/lib/errors'
import type { PlatformConfig } from '@/lib/social-platforms'
import { type EnrichedSocialConnection, type SocialConnection,SocialPlatform } from '@/types/social'
import { SocialAuthPrompt } from './SocialAuthPrompt'
import { FlowStateType, SocialConnectFlowState } from './SocialConnectFlowState'
import { SocialConnectionSelector } from './SocialConnectionSelector'
import { SocialConnectionWarning } from './SocialConnectionWarning'
import SocialFlowsConnectWidget from './SocialFlowsConnectWidget'
import { SocialPageSelector } from './SocialPageSelector'

export enum RenderState {
  CheckingExistingConnections = 'CHECKING_EXISTING_CONNECTIONS',
  AlreadyConnected = 'ALREADY_CONNECTED',
  SelectingExistingConnection = 'SELECTING_EXISTING_CONNECTION',
  AuthUrlError = 'AUTH_URL_ERROR',
  ValidatingPermissions = 'VALIDATING_PERMISSIONS',
  FetchingPages = 'FETCHING_PAGES',
  SelectingPage = 'SELECTING_PAGE',
  CreatingConnection = 'CREATING_CONNECTION',
  Success = 'SUCCESS',
  Error = 'ERROR',
  OAuthPrompt = 'OAUTH_PROMPT',
}

interface GetCurrentRenderStateParams {
  flowStep: FlowStep
  shouldShowExistingConnectionsLoader: boolean
  hasCurrentConnection: boolean
  shouldShowConnectionSelector: boolean
  authUrlError: Error | null
  platformPages: any[]
  isPagesLoading: boolean
  isValidatingPermissions: boolean
}

export function getCurrentRenderState({
  flowStep,
  shouldShowExistingConnectionsLoader,
  hasCurrentConnection,
  shouldShowConnectionSelector,
  authUrlError,
  platformPages,
  isPagesLoading,
  isValidatingPermissions,
}: GetCurrentRenderStateParams): RenderState {
  // Check terminal flow-based states first
  if (flowStep === FlowStep.Error) {
    return RenderState.Error
  }
  if (flowStep === FlowStep.Complete) {
    return RenderState.Success
  }

  // Check in-progress flow states
  if (flowStep === FlowStep.CreatingConnection) {
    return RenderState.CreatingConnection
  }
  if (flowStep === FlowStep.SelectingPage && platformPages) {
    return RenderState.SelectingPage
  }
  if (flowStep === FlowStep.FetchingPages && isPagesLoading) {
    return RenderState.FetchingPages
  }
  if (flowStep === FlowStep.ValidatingPermissions && isValidatingPermissions) {
    return RenderState.ValidatingPermissions
  }

  // Handle SelectExisting step - check UI conditions
  if (flowStep === FlowStep.SelectExisting) {
    if (shouldShowExistingConnectionsLoader) return RenderState.CheckingExistingConnections
    if (hasCurrentConnection) return RenderState.AlreadyConnected
    if (shouldShowConnectionSelector) return RenderState.SelectingExistingConnection
  }

  // Auth-related states
  if (authUrlError) return RenderState.AuthUrlError

  return RenderState.OAuthPrompt
}

interface GetRenderConfigParams {
  renderState: RenderState
  config: PlatformConfig
  currentConnectionDetails: (SocialConnection | EnrichedSocialConnection) | undefined
  normalizedPlatform: SocialPlatform
  enrichedPlatformConnections: Array<SocialConnection | EnrichedSocialConnection>
  isLoadingMetadata: boolean
  connectionsLoadingMetadata: Set<string>
  handleSelectExisting: (socialId: string) => Promise<void>
  handleConnectNew: () => void
  handleChangeConnection: () => void
  platform: string
  platformPages: any[]
  handlePageSelection: (pageId: string) => Promise<void>
  handleCancelSelection: () => void
  flowStateError: string | undefined
  authPopupErrorMessage: string | null
  authStatus: AuthStatus
  openPopup: () => void
  isRetryable: boolean
  authUrlError: Error | null
  isLoadingAuthUrl: boolean
  onClose?: () => void
  appId: string
  onSuccess?: () => void
  t: ReturnType<typeof useTranslations>
}

interface RenderConfig {
  icon?: React.ComponentType<{ className?: string }> | null
  platformName?: string
  showHeader?: boolean
  content: React.ReactNode
}

export function getRenderConfig({
  renderState,
  config,
  currentConnectionDetails,
  normalizedPlatform,
  enrichedPlatformConnections,
  isLoadingMetadata,
  connectionsLoadingMetadata,
  handleSelectExisting,
  handleConnectNew,
  handleChangeConnection,
  platform,
  platformPages,
  handlePageSelection,
  handleCancelSelection,
  flowStateError,
  authPopupErrorMessage,
  authStatus,
  openPopup,
  isRetryable,
  authUrlError,
  isLoadingAuthUrl,
  onClose,
  appId,
  onSuccess,
  t
}: GetRenderConfigParams): RenderConfig {
  switch (renderState) {
    case RenderState.CheckingExistingConnections:
      return {
        icon: config.Icon,
        platformName: config.name,
        showHeader: true,
        content: <SocialConnectFlowState type={FlowStateType.Loading} message={t('builder_social_checking_connections')} />
      }

    case RenderState.AlreadyConnected: {
      let connectionName: string | undefined
      if (currentConnectionDetails) {
        const enriched = currentConnectionDetails as any
        connectionName = enriched.pageName || enriched.locationName || enriched.shopName
      }

      return {
        showHeader: false,
        content: (
          <SocialConnectionWarning
            platformName={config.name}
            Icon={config.Icon}
            connectionName={connectionName}
            onChangeConnection={handleChangeConnection}
            onClose={onClose}
          />
        )
      }
    }

    case RenderState.SelectingExistingConnection:
      return {
        showHeader: false,
        content: (
          <SocialConnectionSelector
            platform={normalizedPlatform}
            platformName={config.name}
            Icon={config.Icon}
            connections={enrichedPlatformConnections}
            isLoadingMetadata={isLoadingMetadata}
            connectionsLoadingMetadata={connectionsLoadingMetadata}
            onSelectExisting={handleSelectExisting}
            onConnectNew={handleConnectNew}
          />
        )
      }

    case RenderState.AuthUrlError:
      return {
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Error} errorMessage={t('builder_social_auth_url_error', { error: authUrlError ? getErrorMessage(authUrlError) : t('builder_code_error_unknown') })} onRetry={openPopup} onClose={onClose} />
      }

    case RenderState.ValidatingPermissions:
      return {
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Loading} message={t('builder_social_validating_permissions')} />
      }

    case RenderState.FetchingPages:
      return {
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Loading} message={t('builder_social_loading_pages', { platform: config.name })} />
      }

    case RenderState.SelectingPage:
      return {
        icon: config.Icon,
        platformName: config.name,
        content: (
          <SocialPageSelector
            platform={platform}
            pages={platformPages}
            onSelect={handlePageSelection}
            onCancel={handleCancelSelection}
          />
        )
      }

    case RenderState.CreatingConnection:
      return {
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Loading} message={t('builder_social_creating_connection')} />
      }

    case RenderState.Success:
      return {
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Success} onClose={onClose} />
      }

    case RenderState.Error:
      return {
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Error} errorMessage={flowStateError || authPopupErrorMessage} onRetry={isRetryable ? openPopup : undefined} onClose={onClose} />
      }

    case RenderState.OAuthPrompt: {
      const isFacebook = normalizedPlatform === SocialPlatform.FACEBOOK
      const isInstagram = normalizedPlatform === SocialPlatform.INSTAGRAM
      const isGBP = normalizedPlatform === SocialPlatform.GOOGLE

      if ((isFacebook || isInstagram || isGBP) && onSuccess) {
        return {
          icon: config.Icon,
          platformName: config.name,
          content: (
            <SocialFlowsConnectWidget
              appId={appId}
              platform={normalizedPlatform}
              onSuccess={onSuccess}
            />
          )
        }
      }

      return {
        icon: config.Icon,
        platformName: config.name,
        content: (
          <>
            {authStatus === AuthStatus.Success && <SocialConnectFlowState type={FlowStateType.Success} onClose={onClose} />}
            {authStatus === AuthStatus.Error && <SocialConnectFlowState type={FlowStateType.Error} errorMessage={authPopupErrorMessage} onRetry={openPopup} onClose={onClose} />}
            {authStatus === AuthStatus.Pending && <SocialAuthPrompt platformName={config.name} onConnect={openPopup} isLoading={isLoadingAuthUrl} onClose={onClose} />}
          </>
        )
      }
    }
  }
}
