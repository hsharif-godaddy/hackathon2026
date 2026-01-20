import { useCallback, useEffect, useRef, useState } from 'react'

import { isFullscreen } from '@/hooks/useFullscreen'
import { useTranslations } from '@/hooks/useTranslations'
import { getRootDomain } from '@/utils/getRootDomain'

interface PopupPosition {
  left: number
  top: number
}

export enum AuthStatus {
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

export function useAuthPopup(
  authUrl: string,
  platform: string,
  expectedState?: string,
  onAuthSuccess?: (data: any) => void,
  disableAutoOpen?: boolean
): AuthPopupResult {
  const t = useTranslations()
  const [authStatus, setAuthStatus] = useState<AuthStatus>(AuthStatus.Pending)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const hasAutoOpenedRef = useRef<Record<string, boolean>>({})
  const popupRef = useRef<Window | null>(null)
  const popupOpenedByThisInstanceRef = useRef(false)

  const openPopup = useCallback(() => {
    const width = 600
    const height = 700
    const windowName = `socialAuthPopup_${expectedState || platform}_${Date.now()}`

    let popup: Window | null = null

    if (isFullscreen()) {
      // In fullscreen, open as a new window/tab without specific dimensions
      // This has better browser support and maintains opener relationship for postMessage
      popup = window.open(authUrl, windowName, 'noopener=no,noreferrer=no')
    } else {
      // Normal mode: open as centered popup
      const position = calculatePopupPosition(width, height)
      const features = buildPopupFeatures(width, height, position)
      popup = window.open(authUrl, windowName, features)
    }

    if (popup) {
      popupRef.current = popup
      popupOpenedByThisInstanceRef.current = true

      // Try to focus the popup (works for both popup windows and tabs)
      try {
        popup.focus()
      } catch {
        // Ignore focus errors
      }
    } else {
      // Popup was completely blocked - try one more time without features
      const fallbackPopup = window.open(authUrl, windowName)
      if (fallbackPopup) {
        popupRef.current = fallbackPopup
        popupOpenedByThisInstanceRef.current = true
      }
    }
  }, [authUrl, platform, expectedState])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const socialAuthBaseUrl = `https://social-auth.api.${getRootDomain() || 'godaddy.com'}`
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
            if (onAuthSuccess) {
              onAuthSuccess(event.data)
            }
          } else {
            setAuthStatus(AuthStatus.Error)
            setErrorMessage(event.data.error || t('builder_social_error_authentication_failed'))
          }
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [expectedState, onAuthSuccess, t])

  useEffect(() => {
    return () => {
      if (popupOpenedByThisInstanceRef.current && popupRef.current && !popupRef.current.closed) {
        try {
          popupRef.current.close()
        } catch {
          // Silently handle popup close failures (e.g., popup already closed, cross-origin restrictions)
        }
      }
    }
  }, [])

  useEffect(() => {
    if (!authUrl || disableAutoOpen) return

    const refKey = expectedState || authUrl
    if (!hasAutoOpenedRef.current[refKey]) {
      hasAutoOpenedRef.current[refKey] = true
      const timer = setTimeout(() => {
        openPopup()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [expectedState, authUrl, openPopup, disableAutoOpen])

  return { authStatus, errorMessage, openPopup }
}
