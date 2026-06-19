'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { TRANSFER_TOKEN_LENGTH, TRANSFER_TOKEN_PATTERN, transferEventProps } from '@/app/[market]/apps/components/transfer-constants'
import ProjectsActionModal, {
  ProjectsActionModalFooter,
} from '@/app/[market]/projects/components/ProjectsActionModal'
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
  const transferAppIdRef = useRef<string | undefined>(undefined)

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
      logClickEvent('apps.transfer.accept_error', transferEventProps(transferAppIdRef.current))()
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
            logClickEvent('apps.transfer.accept_error', transferEventProps(transferAppIdRef.current))()
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

        if (typeof data.appId === 'string') {
          transferAppIdRef.current = data.appId
        }

        if (data.status === 'completed') {
          logClickEvent('apps.transfer.accept_success', transferEventProps(transferAppIdRef.current))()
          stopPolling()
          refreshSites()
          onAccepted?.()
          onClose()
          return
        }

        if (data.status === 'failed') {
          logClickEvent('apps.transfer.accept_error', transferEventProps(transferAppIdRef.current))()
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
          logClickEvent('apps.transfer.accept_error', transferEventProps(transferAppIdRef.current))()
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

      if (typeof data.appId === 'string') {
        transferAppIdRef.current = data.appId
      }

      logClickEvent('apps.transfer.accept_submit', transferEventProps(transferAppIdRef.current))()

      if (!response.ok) {
        logClickEvent('apps.transfer.accept_error', transferEventProps(transferAppIdRef.current))()
        setError(data.error || data.message || t('builder_transfer_error_accept_failed'))
        setStep('error')
        return
      }

      if (data.status === 'processing') {
        setStep('processing')
        pollStatus(trimmed)
      } else {
        logClickEvent('apps.transfer.accept_success', transferEventProps(transferAppIdRef.current))()
        refreshSites()
        onAccepted?.()
        onClose()
      }
    } catch (err) {
      if (err instanceof AuthDismissedError) return
      logClickEvent('apps.transfer.accept_error', transferEventProps(transferAppIdRef.current))()
      logger.error('transfer.accept.ui.error', {
        error: err instanceof Error ? err.message : String(err)
      })
      setError(t('builder_transfer_error_accept_failed'))
      setStep('error')
    } finally {
      setIsLoading(false)
    }
  }

  const footer =
    step === 'input' ? (
      <ProjectsActionModalFooter
        onCancel={onClose}
        cancelText={t('builder_common_cancel')}
        onConfirm={handleAccept}
        confirmText={
          isLoading
            ? t('builder_transfer_accepting')
            : t('builder_transfer_accept_submit')
        }
        isLoading={isLoading}
        confirmDisabled={transferToken.trim().length !== TRANSFER_TOKEN_LENGTH}
        cancelEid={generateClickEID('apps.transfer.accept_cancel')}
        confirmEid={generateClickEID('apps.transfer.accept_submit')}
      />
    ) : step === 'processing' ? (
      <Button
        onClick={handleClose}
        design="secondary"
        size="sm"
        data-partial="componentAiro"
        className="w-full md:w-auto"
        data-eid={generateClickEID('apps.transfer.processing_dismiss')}
        text={t('builder_transfer_processing_dismiss')}
      />
    ) : (
      <ProjectsActionModalFooter
        onCancel={() => {
          transferAppIdRef.current = undefined
          setStep('input')
          setError(null)
        }}
        cancelText={t('builder_common_try_again')}
        onConfirm={onClose}
        confirmText={t('builder_common_close')}
        cancelEid={generateClickEID('apps.transfer.accept_retry')}
        confirmEid={generateClickEID('apps.transfer.accept_close')}
      />
    )

  return (
    <ProjectsActionModal
      title={t('builder_transfer_accept_title')}
      description={
        step === 'input'
          ? t('builder_transfer_accept_description')
          : undefined
      }
      onClose={handleClose}
      footer={footer}
      testId="accept-transfer-dialog"
    >
      {step === 'input' && (
        <TextInput
          id="transfer-token"
          data-eid={generateClickEID('apps.transfer.accept_token_input')}
          label={t('builder_transfer_token_label')}
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
          placeholder={t('builder_transfer_token_placeholder')}
          multiline={false}
        />
      )}

      {step === 'processing' && (
        <Box orientation="vertical" gap="md" className="w-full items-center py-2">
          <Spinner size="md" />
          <text.p size={0} emphasis="passive" className="text-center">
            {t('builder_transfer_processing', undefined, 'Transfer in progress. This may take a moment...')}
          </text.p>
        </Box>
      )}

      {step === 'error' && (
        <div className="rounded-lg border border-intents-ux-criticalBox-borderColor bg-intents-ux-criticalBox-backgroundColor p-4 text-center">
          <text.p size={0} emphasis="critical">
            {error || t('builder_transfer_error_accept_failed')}
          </text.p>
        </div>
      )}
    </ProjectsActionModal>
  )
}
