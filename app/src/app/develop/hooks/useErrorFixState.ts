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
  /** Call when user clicks "Dismiss" on the unresolved overlay */
  handleDismissError: () => void
}

export interface ErrorFixResult {
  errorFixState: ErrorFixState
  userRequestedFix: boolean
  pendingError: PendingError | null
  fixAttemptCount: number
  actions: ErrorFixActions
}

const FALLBACK_TIMEOUT_MS = 5000

/**
 * Grace period (ms) after agent finishes processing before escalating
 * to unresolved. Transient HMR errors resolve on their own once Vite
 * processes all file changes. This delay avoids flashing "Preview Error"
 * for errors that clear within seconds of the agent completing its work.
 */
const POST_PROCESSING_GRACE_MS = 3000

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
  const [fixAttemptCount, setFixAttemptCount] = useState(0)
  const errorFixStateRef = useRef<ErrorFixState>('none')
  const pendingErrorRef = useRef<PendingError | null>(null)
  const isProcessingRef = useRef(isProcessing)
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inGraceWindowRef = useRef(false)
  // Track which error signature was already auto-sent to avoid infinite loops
  const autoSentSignatureRef = useRef<string | null>(null)

  // Refs mirror state for stable reads inside setTimeout/async closures (e.g. fallback timeout)
  errorFixStateRef.current = errorFixState
  isProcessingRef.current = isProcessing

  // When agent finishes processing, delay escalation by 3 seconds to let
  // transient HMR errors resolve. If the error clears during the grace
  // period (via handleErrorFixResolved / vite:afterUpdate), the "Preview
  // Error" dialog never appears.
  const prevIsProcessingRef = useRef(isProcessing)
  useEffect(() => {
    const wasProcessing = prevIsProcessingRef.current
    prevIsProcessingRef.current = isProcessing

    if (wasProcessing && !isProcessing) {
      setUserRequestedFix(false)
      inGraceWindowRef.current = true
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current)
      graceTimerRef.current = setTimeout(() => {
        graceTimerRef.current = null
        inGraceWindowRef.current = false
        if (pendingErrorRef.current && !isProcessingRef.current) {
          setErrorFixState('unresolved')
          errorFixStateRef.current = 'unresolved'
        } else if (!pendingErrorRef.current) {
          setErrorFixState('none')
          errorFixStateRef.current = 'none'
        }
      }, POST_PROCESSING_GRACE_MS)
    }

    return () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current)
        graceTimerRef.current = null
      }
      inGraceWindowRef.current = false
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
    setFixAttemptCount(n => n + 1)
    onSendFix(error)
  }, [onSendFix])

  const handleErrorFixRequest = useCallback((error: PendingError) => {
    pendingErrorRef.current = error
    setPendingError(error)

    if (errorFixStateRef.current === 'pending') return // already working on a fix

    if (isProcessingRef.current || inGraceWindowRef.current) {
      // Agent is actively writing OR just finished — error is likely transient.
      // Hold it as pending; the grace timer will escalate if it persists.
      setErrorFixState('pending')
      errorFixStateRef.current = 'pending'
    } else if (error.errorData) {
      // Runtime error — auto-send to agent (but only once per error signature)
      const sig = `${error.errorData.name}::${error.errorData.message}`
      if (autoSentSignatureRef.current === sig) {
        // Same error came back after agent already tried - show unresolved
        setErrorFixState('unresolved')
        errorFixStateRef.current = 'unresolved'
        return
      }
      autoSentSignatureRef.current = sig
      setErrorFixState('pending')
      errorFixStateRef.current = 'pending'
      setUserRequestedFix(true)
      setFixAttemptCount(n => n + 1)
      onSendFix(error)
    } else {
      // Compile error with agent idle (no recent processing) — show immediately
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
    setFixAttemptCount(0)
    autoSentSignatureRef.current = null
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
      inGraceWindowRef.current = false
    }
  }, [])

  const handleDismissError = useCallback(() => {
    pendingErrorRef.current = null
    setPendingError(null)
    setErrorFixState('none')
    errorFixStateRef.current = 'none'
    setUserRequestedFix(false)
    setFixAttemptCount(0)
    autoSentSignatureRef.current = null
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
      inGraceWindowRef.current = false
    }
  }, [])

  return {
    errorFixState,
    userRequestedFix,
    pendingError,
    fixAttemptCount,
    actions: {
      handleErrorFixRequest,
      handleFixError,
      handleErrorFixResolved,
      handleDismissError
    }
  }
}
