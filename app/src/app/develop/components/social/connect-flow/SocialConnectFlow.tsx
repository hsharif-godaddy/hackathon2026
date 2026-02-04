'use client'

import { memo } from 'react'
import Button from '@ux/button'
import text from '@ux/text'

import ErrorBoundary from '@/components/ErrorBoundary'
import { useSocialConnectFlowOrchestrator } from '@/hooks/social/connect-flow/useSocialConnectFlowOrchestrator'
import { FlowStep } from '@/hooks/social/connect-flow/useSocialConnectFlowStateMachine'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { generateClickEID } from '@/utils/instrumentation'
import { getCurrentRenderState, getRenderConfig } from './social-connect-flow-render'
import { ContainerVariant,SocialConnectFlowContainer } from './SocialConnectFlowContainer'

interface SocialConnectFlowProps {
  platform: string
  appId: string
  state: string
  initialStep?: FlowStep
  initialUserTokenId?: string
  autoOpen?: boolean
  onSuccess?: () => void
}

const SocialConnectFlow = memo(function SocialConnectFlow(props: SocialConnectFlowProps) {
  const t = useTranslations()
  const {
    flowState,
    config,
    normalizedPlatform,
    handlers,
    derivedState,
    authStatus,
    errorMessage,
    currentConnectionDetails,
    enrichedPlatformConnections,
    isLoadingMetadata,
    connectionsLoadingMetadata,
    isLoadingAuthUrl,
    authUrlError,
    isValidatingPermissions,
    platform,
  } = useSocialConnectFlowOrchestrator(props)

  const currentState = getCurrentRenderState({
    flowStep: flowState.step,
    shouldShowExistingConnectionsLoader: derivedState.shouldShowExistingConnectionsLoader,
    hasCurrentConnection: derivedState.hasCurrentConnection,
    shouldShowConnectionSelector: derivedState.shouldShowConnectionSelector,
    authUrlError,
    platformPages: derivedState.platformPages,
    isPagesLoading: derivedState.isPagesLoading,
    isValidatingPermissions,
  })

  const renderConfig = getRenderConfig({
    renderState: currentState,
    config,
    currentConnectionDetails,
    normalizedPlatform,
    enrichedPlatformConnections,
    isLoadingMetadata,
    connectionsLoadingMetadata,
    handleSelectExisting: handlers.handleSelectExisting,
    handleConnectNew: handlers.handleConnectNew,
    handleChangeConnection: handlers.handleChangeConnection,
    platform,
    platformPages: derivedState.platformPages,
    handlePageSelection: handlers.handlePageSelection,
    handleCancelSelection: handlers.handleCancelSelection,
    flowStateError: flowState.error,
    authPopupErrorMessage: errorMessage,
    authStatus,
    openPopup: handlers.openPopup,
    isRetryable: flowState.isRetryable,
    authUrlError,
    isLoadingAuthUrl,
    t,
  })

  return (
    <SocialConnectFlowContainer
      variant={renderConfig.variant}
      icon={renderConfig.icon}
      platformName={renderConfig.platformName}
      showHeader={renderConfig.showHeader}
    >
      {renderConfig.content}
    </SocialConnectFlowContainer>
  )
}, (prevProps, nextProps) => {
  return prevProps.platform === nextProps.platform &&
    prevProps.appId === nextProps.appId &&
    prevProps.state === nextProps.state &&
    prevProps.initialStep === nextProps.initialStep &&
    prevProps.initialUserTokenId === nextProps.initialUserTokenId &&
    prevProps.autoOpen === nextProps.autoOpen
})

function SocialConnectFlowError(error: Error, reset: () => void, t: ReturnType<typeof useTranslations>) {
  return (
    <SocialConnectFlowContainer
      variant={ContainerVariant.Error}
      icon={null}
      platformName={t('builder_social_platform')}
      showHeader={true}
    >
      <div className="space-y-2">
        <text.p size={-2} className="text-intents-ux-error-textColor">
          {t('builder_social_error_unexpected')}
        </text.p>
        <text.p size={-3} className="text-muted-foreground">
          {error.message}
        </text.p>
        <Button design="primary" size="sm" onClick={reset} text={t('builder_common_try_again')} data-eid={generateClickEID('social.connect.error_boundary_retry')} />
      </div>
    </SocialConnectFlowContainer>
  )
}

export default function SocialConnectFlowWithErrorBoundary(props: SocialConnectFlowProps) {
  const t = useTranslations()

  return (
    <ErrorBoundary
      fallback={(error, reset) => {
        logger.error('social.connect_flow.error_boundary', {
          platform: props.platform,
          appId: props.appId,
          error: error.message,
          stack: error.stack
        })
        return SocialConnectFlowError(error, reset, t)
      }}
    >
      <SocialConnectFlow {...props} />
    </ErrorBoundary>
  )
}
