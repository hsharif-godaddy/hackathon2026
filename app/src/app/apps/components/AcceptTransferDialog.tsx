'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import Spinner from '@ux/spinner'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { TRANSFER_TOKEN_LENGTH, TRANSFER_TOKEN_PATTERN } from '@/app/apps/components/transfer-constants'
import { useCloseOnReauth } from '@/hooks/useCloseOnReauth'
import { useTranslations } from '@/hooks/useTranslations'
import { appFetch, AuthDismissedError } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { useSitesStore } from '@/stores/useSitesStore'
import { generateClickEID, logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

interface AcceptTransferDialogProps {
  onClose: () => void
  onAccepted?: () => void
}

type AcceptStep = 'input' | 'processing' | 'error'

const POLL_INTERVAL = 3000
const MAX_POLL_ATTEMPTS = 40
const MAX_CONSECUTIVE_ERRORS = 5

export default function AcceptTransferDialog({ onClose, onAccepted }: AcceptTransferDialogProps) {
  const t = useTranslations()
  useCloseOnReauth(true, onClose)

  useEffect(function trackDialogImpression() {
    logImpressionEvent('apps.transfer.accept_dialog')()
  }, [])

  const refreshSites = useSitesStore((state) => state.refreshSites)
  const [step, setStep] = useState<AcceptStep>('input')
  const [transferToken, setTransferToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)
  const errorCountRef = useRef(0)

  const stopPolling = useCallback(function stop() {
    if (pollRef.current) {
      clearTimeout(pollRef.current)
      pollRef.current = null
    }
    attemptRef.current = 0
    errorCountRef.current = 0
  }, [])

  const pollStatus = useCallback(function poll(token: string) {
    attemptRef.current += 1

    if (attemptRef.current > MAX_POLL_ATTEMPTS) {
      logClickEvent('apps.transfer.accept_error')()
      stopPolling()
      setError(t('builder_transfer_error_timeout', undefined, 'The transfer is taking longer than expected. Please check your apps list later.'))
      setStep('error')
      return
    }

    pollRef.current = setTimeout(async () => {
      try {
        const response = await appFetch(`/api/transfer?transferToken=${encodeURIComponent(token)}`)

        if (!response.ok) {
          errorCountRef.current += 1
          if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
            logClickEvent('apps.transfer.accept_error')()
            stopPolling()
            setError(t('builder_transfer_error_status_check_failed', undefined, 'Unable to check transfer status. Please close and try again.'))
            setStep('error')
            return
          }
          pollStatus(token)
          return
        }

        errorCountRef.current = 0
        const data = await response.json()

        if (data.status === 'completed') {
          logClickEvent('apps.transfer.accept_success')()
          stopPolling()
          refreshSites()
          onAccepted?.()
          onClose()
          return
        }

        if (data.status === 'failed') {
          logClickEvent('apps.transfer.accept_error')()
          stopPolling()
          setError(t('builder_transfer_error_transfer_failed', undefined, 'The transfer failed. Please try again or contact support.'))
          setStep('error')
          return
        }

        pollStatus(token)
      } catch (err) {
        logger.error('transfer.poll.error', {
          error: err instanceof Error ? err.message : String(err)
        })
        errorCountRef.current += 1
        if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
          logClickEvent('apps.transfer.accept_error')()
          stopPolling()
          setError(t('builder_transfer_error_status_check_failed', undefined, 'Unable to check transfer status. Please close and try again.'))
          setStep('error')
          return
        }
        pollStatus(token)
      }
    }, POLL_INTERVAL)
  }, [refreshSites, stopPolling, t, onAccepted, onClose])

  useEffect(function cleanup() {
    return stopPolling
  }, [stopPolling])

  const handleClose = () => {
    stopPolling()
    onClose()
  }

  const handleAccept = async () => {
    const trimmed = transferToken.trim()

    if (!trimmed) {
      setError(t('builder_transfer_error_token_required', undefined, 'Transfer code is required'))
      return
    }

    if (trimmed.length !== TRANSFER_TOKEN_LENGTH || !TRANSFER_TOKEN_PATTERN.test(trimmed)) {
      setError(t('builder_transfer_error_token_invalid', undefined, 'Invalid transfer code format'))
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await appFetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferToken: trimmed })
      }, { authLevel: 3 })

      const data = await response.json()

      if (!response.ok) {
        logClickEvent('apps.transfer.accept_error')()
        setError(data.error || data.message || t('builder_transfer_error_accept_failed', undefined, 'Failed to accept transfer'))
        setStep('error')
        return
      }

      if (data.status === 'processing') {
        setStep('processing')
        pollStatus(trimmed)
      } else {
        logClickEvent('apps.transfer.accept_success')()
        refreshSites()
        onAccepted?.()
        onClose()
      }
    } catch (err) {
      if (err instanceof AuthDismissedError) return
      logClickEvent('apps.transfer.accept_error')()
      logger.error('transfer.accept.ui.error', {
        error: err instanceof Error ? err.message : String(err)
      })
      setError(t('builder_transfer_error_accept_failed', undefined, 'Failed to accept transfer'))
      setStep('error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      title={t('builder_transfer_accept_title', undefined, 'Accept Transfer')}
      onClose={handleClose}
      centered
      focusLock={false}
    >
      {step === 'input' && (
        <Box orientation="vertical" gap="md" className="max-w-md">
          <text.p size={0} emphasis="passive">
            {t('builder_transfer_accept_description', undefined, 'Enter the 6-character code you received from the app owner.')}
          </text.p>

          <Box orientation="vertical" gap="sm">
            <TextInput
              id="transfer-token"
              label={t('builder_transfer_token_label', undefined, 'Transfer Code')}
              value={transferToken}
              onChange={(value) => {
                setTransferToken(value.replace(/[^a-zA-Z0-9]/g, '').slice(0, TRANSFER_TOKEN_LENGTH))
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isLoading) {
                  handleAccept()
                }
              }}
              errorMessage={error || undefined}
              disabled={isLoading}
              visualSize="sm"
              placeholder={t('builder_transfer_token_placeholder', undefined, 'Enter 6-character code')}
              multiline={false}
              data-eid={generateClickEID('apps.transfer.accept_token_input')}
            />
          </Box>

          <Box orientation="horizontal" gap="sm" className="pt-4 justify-end">
            <Button
              onClick={onClose}
              disabled={isLoading}
              design="secondary"
              size="sm"
              text={t('builder_common_cancel', undefined, 'Cancel')}
              data-eid={generateClickEID('apps.transfer.accept_cancel')}
            />
            <Button
              onClick={handleAccept}
              disabled={isLoading || transferToken.trim().length !== TRANSFER_TOKEN_LENGTH}
              design="primary"
              size="sm"
              text={isLoading ? t('builder_transfer_accepting', undefined, 'Accepting...') : t('builder_transfer_accept_submit', undefined, 'Accept Transfer')}
              data-eid={generateClickEID('apps.transfer.accept_submit')}
            />
          </Box>
        </Box>
      )}

      {step === 'processing' && (
        <Box orientation="vertical" gap="md" className="max-w-md items-center py-4">
          <Spinner size="md" />
          <text.p size={0} emphasis="passive" className="text-center">
            {t('builder_transfer_processing', undefined, 'Transfer in progress. This may take a moment...')}
          </text.p>
          <Button
            onClick={handleClose}
            design="secondary"
            size="sm"
            text={t('builder_transfer_processing_dismiss', undefined, 'Dismiss')}
            data-eid={generateClickEID('apps.transfer.processing_dismiss')}
          />
        </Box>
      )}

      {step === 'error' && (
        <Box orientation="vertical" gap="md" className="max-w-md">
          <div className="bg-intents-ux-criticalBox-backgroundColor border border-intents-ux-criticalBox-borderColor rounded-lg p-4 text-center">
            <text.p size={0} emphasis="critical">
              {error || t('builder_transfer_error_accept_failed', undefined, 'Failed to accept transfer')}
            </text.p>
          </div>

          <Box orientation="horizontal" gap="sm" className="pt-2 justify-end">
            <Button
              onClick={() => {
                setStep('input')
                setError(null)
              }}
              design="secondary"
              size="sm"
              text={t('builder_common_try_again', undefined, 'Try Again')}
              data-eid={generateClickEID('apps.transfer.accept_retry')}
            />
            <Button
              onClick={onClose}
              design="primary"
              size="sm"
              text={t('builder_common_close', undefined, 'Close')}
              data-eid={generateClickEID('apps.transfer.accept_close')}
            />
          </Box>
        </Box>
      )}
    </Modal>
  )
}
