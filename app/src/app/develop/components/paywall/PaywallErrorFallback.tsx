'use client'

import { useEffect, useRef } from 'react'

import { PaywallErrorModal } from './PaywallErrorModal'

interface PaywallErrorFallbackProps {
  error: Error
  reset: () => void
  onClose: () => void
  onError?: (error: Error) => void
}

/**
 * Error fallback component for paywall error boundaries.
 * Logs errors via useEffect to prevent duplicate logs on re-renders.
 */
export function PaywallErrorFallback({
  error,
  reset,
  onClose,
  onError,
}: PaywallErrorFallbackProps) {
  const lastLoggedErrorRef = useRef<Error | null>(null)

  useEffect(() => {
    // Only log if this is a new error (different instance)
    if (lastLoggedErrorRef.current !== error) {
      lastLoggedErrorRef.current = error
      onError?.(error)
    }
  }, [error, onError])

  return <PaywallErrorModal onClose={onClose} onRetry={reset} />
}
