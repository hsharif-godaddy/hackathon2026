'use client'

import { memo, useCallback,useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import text from '@ux/text'

import { useSocialAuthUrl } from '@/hooks/useSocialAuthUrl'
import { PLATFORM_CONFIG } from '@/lib/social-platforms'

interface SocialConnectFlowProps {
  platform: string
  appId: string
  state?: string
}

interface PopupPosition {
  left: number
  top: number
}

enum AuthStatus {
  Pending = 'pending',
  Success = 'success',
  Error = 'error',
}

interface AuthPopupResult {
  authStatus: AuthStatus
  errorMessage: string | null
  openPopup: () => void
}

function calculatePopupPosition(width: number, height: number): PopupPosition {
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2)
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2)
  return { left, top }
}

function buildPopupFeatures(width: number, height: number, position: PopupPosition): string {
  return `width=${width},height=${height},left=${position.left},top=${position.top},toolbar=no,menubar=no,location=no,status=no`
}

function useAuthPopup(
  authUrl: string,
  platform: string,
  expectedState?: string
): AuthPopupResult {
  const [authStatus, setAuthStatus] = useState<AuthStatus>(AuthStatus.Pending)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const hasAutoOpenedRef = useRef<Record<string, boolean>>({})
  const popupRef = useRef<Window | null>(null)

  const openPopup = useCallback(() => {
    const width = 600
    const height = 700
    const position = calculatePopupPosition(width, height)
    const features = buildPopupFeatures(width, height, position)

    const windowName = `socialAuthPopup_${expectedState || platform}_${Date.now()}`

    const popup = window.open(authUrl, windowName, features)

    if (popup) {
      popupRef.current = popup
    }
  }, [authUrl, platform, expectedState])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const socialAuthBaseUrl = process.env.NEXT_PUBLIC_SOCIAL_AUTH_API_URL || 'https://social-auth.api.dev-godaddy.com'
      const expectedOrigin = new URL(socialAuthBaseUrl).origin

      if (event.origin !== expectedOrigin) {
        return
      }

      if (typeof event.data === 'object' && event.data !== null) {
        if ('success' in event.data) {
          if (expectedState && event.data.state !== expectedState) {
            return
          }

          if (popupRef.current && !popupRef.current.closed) {
            try {
              popupRef.current.close()
            } catch {
              // Silently handle popup close failures
            }
          }

          if (event.data.success) {
            setAuthStatus(AuthStatus.Success)
          } else {
            setAuthStatus(AuthStatus.Error)
            setErrorMessage(event.data.error || 'Authentication failed')
          }
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [expectedState])

  useEffect(() => {
    if (!authUrl) return

    const refKey = expectedState || authUrl
    if (!hasAutoOpenedRef.current[refKey]) {
      hasAutoOpenedRef.current[refKey] = true
      const timer = setTimeout(() => {
        openPopup()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [expectedState, authUrl, openPopup])

  return { authStatus, errorMessage, openPopup }
}

interface ConnectFlowHeaderProps {
  icon: React.ComponentType<{ className?: string }> | null
  platformName: string
}

function ConnectFlowHeader({ icon: Icon, platformName }: ConnectFlowHeaderProps) {
  return (
    <div className="flex items-start align-bottom gap-1.5 mb-1.5">
      {Icon ? (
        <Icon className="w-3 h-3 flex-shrink-0" />
      ) : (
        <div className="w-3 h-3 flex-shrink-0 rounded-full bg-muted-foreground/20" />
      )}
      <div className="flex-1">
        <text.p size={-2} as="title" text={`Link your ${platformName}`} />
      </div>
    </div>
  )
}

function SuccessView() {
  return (
    <div className="flex items-center gap-1 text-intents-ux-feedbackHighContrastSuccess-feedbackColor">
      <text.p size={-2} text="Successfully connected!" />
    </div>
  )
}

interface ErrorViewProps {
  errorMessage: string | null
  onRetry: () => void
}

function ErrorView({ errorMessage, onRetry }: ErrorViewProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-intents-ux-error-textColor">
        <text.p size={-2} text="Connection failed" />
      </div>
      {errorMessage && <text.p size={-2} text={errorMessage} />}
      <Button design="secondary" size="sm" onClick={onRetry} text="Try Again" />
    </div>
  )
}

interface PendingViewProps {
  platformName: string
  onConnect: () => void
}

function PendingView({ platformName, onConnect }: PendingViewProps) {
  return (
    <div className="space-y-1">
      <text.p size={-2} text="A popup will open for authentication. If you don't see it, click below:" />
      <Button design="primary" size="sm" onClick={onConnect} text={`Connect ${platformName}`} />
    </div>
  )
}

function SocialConnectFlow({
  platform,
  appId,
  state,
}: SocialConnectFlowProps) {
  const generatedState = state || `${platform}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  const { data: authData, isLoading, error } = useSocialAuthUrl(
    { platform, appId, state: generatedState },
    true
  )

  const authUrl = authData?.url
  const { authStatus, errorMessage, openPopup } = useAuthPopup(authUrl || '', platform, generatedState)
  const config = PLATFORM_CONFIG[platform] || { name: platform, Icon: null }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto my-2">
        <div className="rounded-md border border-intents-ux-info-borderColor bg-intents-ux-info-backgroundColor p-2">
          <ConnectFlowHeader icon={config.Icon} platformName={config.name} />
          <div className="flex items-center gap-1.5">
            <text.p size={-2} text="Loading authorization..." />
          </div>
        </div>
      </div>
    )
  }

  if (error || !authUrl) {
    return (
      <div className="max-w-2xl mx-auto my-2">
        <div className="rounded-md border border-intents-ux-error-borderColor bg-intents-ux-error-backgroundColor p-2">
          <ConnectFlowHeader icon={config.Icon} platformName={config.name} />
          <div className="flex items-center gap-1.5">
            <text.p size={-2} className="text-intents-ux-error-textColor" text={`Failed to get authorization URL: ${error?.message || 'Unknown error'}`} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto my-2">
      <div className="rounded-md border border-intents-ux-info-borderColor bg-intents-ux-info-backgroundColor p-2">
        <ConnectFlowHeader icon={config.Icon} platformName={config.name} />

        <div className="flex items-center gap-1.5">
          {authStatus === AuthStatus.Success && <SuccessView />}
          {authStatus === AuthStatus.Error && <ErrorView errorMessage={errorMessage} onRetry={openPopup} />}
          {authStatus === AuthStatus.Pending && <PendingView platformName={config.name} onConnect={openPopup} />}
        </div>
      </div>
    </div>
  )
}

export default memo(SocialConnectFlow)
