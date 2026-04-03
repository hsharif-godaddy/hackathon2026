'use client'

import { useEffect, useRef } from 'react'

import { shipAnalyticsLog } from '@/lib/logging'
import { PaywallErrorModal } from './PaywallErrorModal'

interface PaywallErrorFallbackProps {
  error: Error
  onClose: () => void
  onError?: (error: Error) => void
  /** Source identifier for analytics */
  source?: string
  /** Product ID for analytics */
  productId?: string
  /** Component name for analytics */
  component?: string
}

/**
 * Error fallback component for paywall error boundaries.
 * Logs errors via useEffect to prevent duplicate logs on re-renders.
 */
export function PaywallErrorFallback({
  error,
  onClose,
  onError,
  source,
  productId,
  component,
}: PaywallErrorFallbackProps) {
  const lastLoggedErrorRef = useRef<Error | null>(null)
  const hasLoggedDisplayedRef = useRef(false)

  // Log error to parent callback
  useEffect(() => {
    // Only log if this is a new error (different instance)
    if (lastLoggedErrorRef.current !== error) {
      lastLoggedErrorRef.current = error
      onError?.(error)
    }
  }, [error, onError])

  // Log analytics once per distinct error instance or context change.
  // Effect ordering matters: React fires same-component effects top-to-bottom,
  // so the reset effect runs before the logging effect within the same render cycle.
  useEffect(() => {
    hasLoggedDisplayedRef.current = false
  }, [error, source, productId, component])

  useEffect(() => {
    if (!hasLoggedDisplayedRef.current) {
      hasLoggedDisplayedRef.current = true
      shipAnalyticsLog('paywall.error.displayed', {
        source,
        productId,
        error: error.message,
        errorType: 'fallback_displayed',
        component,
      })
    }
  }, [source, productId, error, component])

  return <PaywallErrorModal onClose={onClose} />
}
