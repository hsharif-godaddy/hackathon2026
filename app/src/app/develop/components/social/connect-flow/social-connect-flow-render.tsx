import { AuthStatus } from '@/hooks/social/connect-flow/useAuthPopup'
import { FlowStep } from '@/hooks/social/connect-flow/useSocialConnectFlowStateMachine'
import { useTranslations } from '@/hooks/useTranslations'
import { getErrorMessage } from '@/lib/errors'
import type { PlatformConfig } from '@/lib/social-platforms'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
import { SocialAuthPrompt } from './SocialAuthPrompt'
import { ContainerVariant } from './SocialConnectFlowContainer'
import { FlowStateType,SocialConnectFlowState } from './SocialConnectFlowState'
import { SocialConnectionSelector } from './SocialConnectionSelector'
import { SocialConnectionWarning } from './SocialConnectionWarning'
import { SocialPageSelector } from './SocialPageSelector'

export enum RenderState {
  CheckingExistingConnections = 'CHECKING_EXISTING_CONNECTIONS',
  AlreadyConnected = 'ALREADY_CONNECTED',
  SelectingExistingConnection = 'SELECTING_EXISTING_CONNECTION',
  LoadingAuthUrl = 'LOADING_AUTH_URL',
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
  isLoadingAuthUrl: boolean
  authUrlError: Error | null
  authUrl: string | undefined
  platformPages: any[]
  isPagesLoading: boolean
  isValidatingPermissions: boolean
}

export function getCurrentRenderState({
  flowStep,
  shouldShowExistingConnectionsLoader,
  hasCurrentConnection,
  shouldShowConnectionSelector,
  isLoadingAuthUrl,
  authUrlError,
  authUrl,
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

  // Auth-related states (only check authUrlError if we're not still loading)
  if (isLoadingAuthUrl) return RenderState.LoadingAuthUrl
  if (authUrlError) return RenderState.AuthUrlError
  if (!authUrl && flowStep === FlowStep.Auth) return RenderState.LoadingAuthUrl

  return RenderState.OAuthPrompt
}

interface GetRenderConfigParams {
  renderState: RenderState
  config: PlatformConfig
  currentConnectionDetails: (SocialConnection | EnrichedSocialConnection) | undefined
  normalizedPlatform: string
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
  t: ReturnType<typeof useTranslations>
}

interface RenderConfig {
  variant?: ContainerVariant
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
  t
}: GetRenderConfigParams): RenderConfig {
  switch (renderState) {
    case RenderState.CheckingExistingConnections:
      return {
        variant: undefined,
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
        variant: ContainerVariant.Warning,
        showHeader: false,
        content: (
          <SocialConnectionWarning
            platformName={config.name}
            Icon={config.Icon}
            connectionName={connectionName}
            onChangeConnection={handleChangeConnection}
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

    case RenderState.LoadingAuthUrl:
      return {
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Loading} message={t('builder_common_loading_authorization')} />
      }

    case RenderState.AuthUrlError:
      return {
        variant: ContainerVariant.Error,
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Error} errorMessage={t('builder_social_auth_url_error', { error: authUrlError ? getErrorMessage(authUrlError) : t('builder_code_error_unknown') })} onRetry={openPopup} />
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
        content: <SocialConnectFlowState type={FlowStateType.Loading} message={t('builder_common_loading_pages', { platform: config.name })} />
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
        variant: ContainerVariant.Success,
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Success} />
      }

    case RenderState.Error:
      return {
        variant: ContainerVariant.Error,
        icon: config.Icon,
        platformName: config.name,
        content: <SocialConnectFlowState type={FlowStateType.Error} errorMessage={flowStateError || authPopupErrorMessage} onRetry={isRetryable ? openPopup : undefined} />
      }

    case RenderState.OAuthPrompt:
      return {
        icon: config.Icon,
        platformName: config.name,
        content: (
          <>
            {authStatus === AuthStatus.Success && <SocialConnectFlowState type={FlowStateType.Success} />}
            {authStatus === AuthStatus.Error && <SocialConnectFlowState type={FlowStateType.Error} errorMessage={authPopupErrorMessage} onRetry={openPopup} />}
            {authStatus === AuthStatus.Pending && <SocialAuthPrompt platformName={config.name} onConnect={openPopup} />}
          </>
        )
      }
  }
}
