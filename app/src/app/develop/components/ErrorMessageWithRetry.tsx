'use client'

import { useState, useEffect } from 'react'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import { useRetryLastMessage, useClearErrorState } from '@/stores/useStreamingConversationStore'

interface ErrorMessageWithRetryProps {
  errorMessage: string
}

export default function ErrorMessageWithRetry({ errorMessage }: ErrorMessageWithRetryProps) {
  const [isRetrying, setIsRetrying] = useState(false)
  const retryLastMessage = useRetryLastMessage()
  const clearErrorState = useClearErrorState()

  const handleRetry = async () => {
    setIsRetrying(true)
    try {
      await retryLastMessage()
      // retryLastMessage dispatches a custom event and clears error state synchronously.
      // If the retry succeeds, this component unmounts (error state cleared). If it fails
      // and an error is re-set later, we'll remount with isRetrying reset below.
      setIsRetrying(false)
    } catch (error) {
      // retryLastMessage currently doesn't throw; defensive fallback.
      setIsRetrying(false)
    }
  }

  // Safety: if error state was cleared externally while isRetrying stayed true (e.g. store action order), reset.
  useEffect(() => {
    if (!errorMessage && isRetrying) {
      setIsRetrying(false)
    }
  }, [errorMessage, isRetrying])

  const handleDismiss = () => {
    clearErrorState()
  }

  // Get user-friendly error message
  const displayMessage = errorMessage.includes('connect')
    ? 'Lost connection. You can try again by clicking the button below.'
    : errorMessage.includes('timeout')
    ? 'Request timed out. You can try again by clicking the button below.'
    : 'Something went wrong, but you can try again by clicking the button below.'

  return (
    <div className="w-full" aria-live="polite" role="alert">
      <div className="rounded-md max-w-full p-4 bg-intents-ux-boxNegative-backgroundColor border border-intents-ux-borderNegative-color" aria-busy={isRetrying}>
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 mt-0.5">
              <svg
                className="w-5 h-5"
                fill="currentColor"
                viewBox="0 0 20 20"
                style={{ color: 'var(--intents-ux-textNegative-color)' }}
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--intents-ux-textNegative-color)' }}>
                Error
              </p>
              <p className="text-sm" style={{ color: 'var(--intents-ux-textNegative-color)' }}>
                {displayMessage}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 justify-end">
            <Button
              onClick={handleDismiss}
              disabled={isRetrying}
              design="tertiary"
              size="sm"
            >
              Dismiss
            </Button>
            <Button
              onClick={handleRetry}
              disabled={isRetrying}
              design="primary"
              size="sm"
              aria-label={isRetrying ? 'Retrying message' : 'Retry sending message'}
            >
              {isRetrying ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" /> Retrying...
                </span>
              ) : (
                'Try Again'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
