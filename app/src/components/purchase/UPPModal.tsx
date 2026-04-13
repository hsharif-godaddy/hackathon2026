'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '@ux/modal'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { getRootDomain } from '@/utils/getRootDomain'
import { buildUPPDomainSearchUrl, getUPPAllowedOrigins, UPP_MESSAGE_TYPES } from './constants'

/**
 * Props for the UPP Modal component
 */
export interface UPPModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal is closed */
  onClose: () => void
  /** Domain to purchase */
  domain: string
  /** Callback when purchase is completed successfully */
  onPurchaseComplete?: (domain: string) => void
  /** Callback when purchase fails */
  onPurchaseError?: (error: string) => void
  /** App ID for analytics */
  appId?: string
}

/**
 * UPP (Universal Purchase Path) Modal for Domain Purchase
 *
 * Displays a GoDaddy domain purchase flow in an iframe modal.
 * Handles postMessage events from the UPP iframe for purchase completion.
 *
 * Note: The actual UPP URL and postMessage protocol will need to be
 * configured based on GoDaddy's UPP integration documentation.
 */
export default function UPPModal({
  isOpen,
  onClose,
  domain,
  onPurchaseComplete,
  onPurchaseError,
  appId,
}: UPPModalProps) {
  const t = useTranslations()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [isLoading, setIsLoading] = useState(true)

  /**
   * Build the UPP URL for domain purchase
   *
   * Domain parameter should be validated upstream before reaching this component to prevent XSS.
   * UPP URL configuration is in constants.ts and can be overridden via NEXT_PUBLIC_UPP_BASE_URL.
   */
  const getUPPUrl = useCallback(() => {
    const rootDomain = getRootDomain()
    return buildUPPDomainSearchUrl(rootDomain, domain)
  }, [domain])

  /**
   * Handle postMessage events from UPP iframe
   */
  useEffect(() => {
    if (!isOpen) return

    // Reset loading state when modal opens
    setIsLoading(true)

    function handleMessage(event: MessageEvent) {
      // Validate origin with exact match to prevent domain spoofing
      const rootDomain = getRootDomain()
      const allowedOrigins = getUPPAllowedOrigins(rootDomain)

      if (!allowedOrigins.includes(event.origin) ||
          event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const { data } = event

      logger.info('upp-modal.message.received', {
        type: data?.type,
        domain,
        appId,
      })

      // Handle different message types from UPP
      const messageType = data?.type

      if (UPP_MESSAGE_TYPES.PURCHASE_COMPLETE.includes(messageType)) {
        shipAnalyticsLog('domain.purchase.success', {
          domain,
          appId,
        })
        onPurchaseComplete?.(domain)
        onClose()
      } else if (UPP_MESSAGE_TYPES.PURCHASE_CANCELLED.includes(messageType)) {
        shipAnalyticsLog('domain.purchase.cancelled', {
          domain,
          appId,
        })
        onClose()
      } else if (UPP_MESSAGE_TYPES.PURCHASE_ERROR.includes(messageType)) {
        shipAnalyticsLog('domain.purchase.error', {
          domain,
          appId,
          error: data?.error,
        })
        onPurchaseError?.(data?.error || 'Purchase failed')
      } else if (UPP_MESSAGE_TYPES.CLOSE.includes(messageType)) {
        onClose()
      }
    }

    window.addEventListener('message', handleMessage)

    shipAnalyticsLog('domain.purchase.started', {
      domain,
      appId,
    })

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [isOpen, domain, appId, onClose, onPurchaseComplete, onPurchaseError])

  if (!isOpen) return null

  return (
    <Modal
      title={t('builder_domain_purchase_title', { domain }, `Purchase ${domain}`)}
      onClose={onClose}
      className="max-w-4xl"
    >
      <div className="relative w-full min-h-[500px]">
        {/* Loading state - only show while iframe is loading */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-intents-ux-box-backgroundColor">
            <Spinner size="lg" />
            <text.p className="mt-2 text-intents-ux-text-secondary">
              {t('builder_domain_purchase_loading')}
            </text.p>
          </div>
        )}

        {/* UPP iframe */}
        <iframe
          ref={iframeRef}
          src={getUPPUrl()}
          title={`Purchase ${domain}`}
          className="relative w-full h-[500px] border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          onLoad={() => {
            setIsLoading(false)
            logger.info('upp-modal.iframe.loaded', {
              domain,
              appId,
            })
          }}
        />
      </div>
    </Modal>
  )
}
