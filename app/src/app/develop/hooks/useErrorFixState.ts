import { useCallback, useEffect, useRef, useState } from 'react'

import type { RuntimeErrorData } from '@/types/runtime-error'

export type ErrorFixState = 'none' | 'pending' | 'unresolved'

export interface PendingError {
  errorMessage?: string
  errorData?: RuntimeErrorData
}

export interface ErrorFixActions {
  /** Call when an error-fix-request message arrives from the iframe */
  handleErrorFixRequest: (error: PendingError) => void
  /** Call when user clicks "Ask Airo to Fix" on the unresolved overlay */
  handleFixError: () => void
  /** Call when an error-fix-resolved message arrives from the iframe */
  handleErrorFixResolved: () => void
}

export interface ErrorFixResult {
  errorFixState: ErrorFixState
  userRequestedFix: boolean
  pendingError: PendingError | null
  actions: ErrorFixActions
}

const FALLBACK_TIMEOUT_MS = 5000

/**
 * Manages the three-state error fix lifecycle:
 *   none → pending (agent working) → unresolved (agent done, error persists)
 *
 * @param isProcessing - whether the agent is currently processing (isLoading || isStreaming)
 * @param onSendFix - callback to send the fix request to the agent
 */
export function useErrorFixState(
  isProcessing: boolean,
  onSendFix: (error: PendingError) => void
): ErrorFixResult {
  const [errorFixState, setErrorFixState] = useState<ErrorFixState>('none')
  const [userRequestedFix, setUserRequestedFix] = useState(false)
  const [pendingError, setPendingError] = useState<PendingError | null>(null)
  const errorFixStateRef = useRef<ErrorFixState>('none')
  const pendingErrorRef = useRef<PendingError | null>(null)
  const isProcessingRef = useRef(isProcessing)

  // Refs mirror state for stable reads inside setTimeout/async closures (e.g. fallback timeout)
  errorFixStateRef.current = errorFixState
  isProcessingRef.current = isProcessing

  // When agent finishes processing, escalate pending errors to unresolved
  const prevIsProcessingRef = useRef(isProcessing)
  useEffect(() => {
    const wasProcessing = prevIsProcessingRef.current
    prevIsProcessingRef.current = isProcessing

    if (wasProcessing && !isProcessing) {
      setUserRequestedFix(false)
      if (pendingErrorRef.current) {
        setErrorFixState('unresolved')
        errorFixStateRef.current = 'unresolved'
      } else {
        setErrorFixState('none')
        errorFixStateRef.current = 'none'
      }
    }
  }, [isProcessing])

  // Fallback: if pending but isProcessing never becomes true, revert to unresolved
  useEffect(() => {
    if (errorFixState !== 'pending' || isProcessing) return
    const timeout = setTimeout(() => {
      if (errorFixStateRef.current === 'pending' && !isProcessingRef.current && pendingErrorRef.current) {
        setErrorFixState('unresolved')
        errorFixStateRef.current = 'unresolved'
        setUserRequestedFix(false)
      }
    }, FALLBACK_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [errorFixState, isProcessing])

  const handleFixError = useCallback(() => {
    const error = pendingErrorRef.current
    if (!error) return

    setErrorFixState('pending')
    errorFixStateRef.current = 'pending'
    setUserRequestedFix(true)
    onSendFix(error)
  }, [onSendFix])

  const handleErrorFixRequest = useCallback((error: PendingError) => {
    pendingErrorRef.current = error
    setPendingError(error)

    if (isProcessingRef.current) {
      setErrorFixState('pending')
      errorFixStateRef.current = 'pending'
    } else if (error.errorData) {
      // Runtime error — auto-send to agent
      setErrorFixState('pending')
      errorFixStateRef.current = 'pending'
      setUserRequestedFix(true)
      onSendFix(error)
    } else {
      // Compile error with agent idle — show unresolved dialog immediately
      setErrorFixState('unresolved')
      errorFixStateRef.current = 'unresolved'
    }
  }, [onSendFix])

  const handleErrorFixResolved = useCallback(() => {
    pendingErrorRef.current = null
    setPendingError(null)
    setErrorFixState('none')
    errorFixStateRef.current = 'none'
    setUserRequestedFix(false)
  }, [])

  return {
    errorFixState,
    userRequestedFix,
    pendingError,
    actions: {
      handleErrorFixRequest,
      handleFixError,
      handleErrorFixResolved
    }
  }
}
