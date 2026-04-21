'use client'

import { useEffect, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import CopyIcon from '@ux/icon/copy'
import Modal from '@ux/modal'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { useCloseOnReauth } from '@/hooks/useCloseOnReauth'
import { useTranslations } from '@/hooks/useTranslations'
import { appFetch, AuthDismissedError } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { generateClickEID, logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

interface TransferInitiateDialogProps {
  appId: string
  appName: string
  onClose: () => void
  onTransferCreated: (transferToken: string, expiresAt?: string) => void
}

type DialogStep = 'input' | 'token'

export default function TransferInitiateDialog({
  appId,
  appName,
  onClose,
  onTransferCreated
}: TransferInitiateDialogProps) {
  const t = useTranslations()
  useCloseOnReauth(true, onClose)

  useEffect(function trackDialogImpression() {
    logImpressionEvent('apps.transfer.initiate_dialog')()
  }, [])

  const [step, setStep] = useState<DialogStep>('input')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [transferToken, setTransferToken] = useState<string | null>(null)
  const [transferExpiresAt, setTransferExpiresAt] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  const handleInitiate = async () => {
    const trimmed = email.trim()

    if (!trimmed) {
      setError(t('builder_transfer_error_email_required', undefined, 'Email is required'))
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t('builder_transfer_error_email_invalid', undefined, 'Please enter a valid email address'))
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await appFetch(`/api/apps/${appId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail: trimmed })
      }, { authLevel: 3 })

      const data = await response.json()

      if (!response.ok) {
        logClickEvent('apps.transfer.initiate_error')()
        setError(data.error || data.message || t('builder_transfer_error_initiate_failed', undefined, 'Failed to initiate transfer'))
        return
      }

      logClickEvent('apps.transfer.initiate_success')()
      setTransferToken(data.transferToken)
      setTransferExpiresAt(data.expiresAt)
      setStep('token')
    } catch (err) {
      if (err instanceof AuthDismissedError) return
      logClickEvent('apps.transfer.initiate_error')()
      logger.error('transfer.initiate.ui.error', {
        appId,
        error: err instanceof Error ? err.message : String(err)
      })
      setError(t('builder_transfer_error_initiate_failed', undefined, 'Failed to initiate transfer'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!transferToken) return
    try {
      await navigator.clipboard.writeText(transferToken)
      setCopied(true)
      setCopyError(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError(true)
      setTimeout(() => setCopyError(false), 3000)
    }
  }

  const modalTitle = `${t('builder_transfer_initiate_title', undefined, 'Transfer')} \u201C${appName}\u201D`

  return (
    <Modal
      title={modalTitle}
      onClose={() => {
        if (transferToken) onTransferCreated(transferToken, transferExpiresAt)
        onClose()
      }}
      centered
      focusLock={false}
    >
      {step === 'input' && (
        <div className="text-left">
          <Box orientation="vertical" gap="md">
            <text.p size={0} emphasis="passive">
              {t('builder_transfer_initiate_description', { appName }, 'Start a transfer by entering the recipient\u2019s email. They must have a GoDaddy account linked to this email.')}
            </text.p>

            <ul className="list-disc pl-5 space-y-1">
              <li><text.span size={0}>{t('builder_transfer_bullet_unpublish', undefined, 'The app will be unpublished')}</text.span></li>
              <li><text.span size={0}>{t('builder_transfer_bullet_domain', undefined, 'Any connected domain will be disconnected')}</text.span></li>
              <li><text.span size={0}>{t('builder_transfer_bullet_republish', undefined, 'The recipient will need to publish again')}</text.span></li>
              <li><text.span size={0}>{t('builder_transfer_bullet_secrets', undefined, 'Any store secrets will be transferred')}</text.span></li>
            </ul>

            <text.p size={0} emphasis="passive">
              {t('builder_transfer_initiate_description_2', undefined, 'We\u2019ll generate a transfer code for you to share with them.')}
            </text.p>

            <TextInput
              id="target-email"
              label={t('builder_transfer_email_label', undefined, 'Recipient\u2019s GoDaddy email')}
              value={email}
              onChange={(value) => {
                setEmail(value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isLoading) {
                  handleInitiate()
                }
              }}
              errorMessage={error || undefined}
              disabled={isLoading}
              placeholder={t('builder_transfer_email_placeholder', undefined, 'Recipient\u2019s GoDaddy email')}
              multiline={false}
              data-eid={generateClickEID('apps.transfer.email_input')}
            />

            <Button
              onClick={handleInitiate}
              disabled={isLoading || !email.trim()}
              design="primary"
              size="sm"
              text={isLoading ? t('builder_transfer_initiating', undefined, 'Generating...') : t('builder_transfer_initiate_submit', undefined, 'Generate Code')}
              data-eid={generateClickEID('apps.transfer.initiate_submit')}
            />
          </Box>
        </div>
      )}

      {step === 'token' && transferToken && (
        <Box orientation="vertical" gap="md">
          <Box orientation="vertical" gap="sm">
            <text.p size={0} emphasis="passive">
              {t('builder_transfer_token_description', undefined, 'Share this code with the recipient. They\u2019ll need it to accept the transfer.')}
            </text.p>
            <text.p size={0} emphasis="passive">
              {t('builder_transfer_token_expiry_note', undefined, 'This code will expire in 72 hours.')}
            </text.p>
          </Box>

          <div className="border border-intents-ux-box-borderColor rounded-lg p-4 flex items-center justify-between gap-4">
            <text.p size={4} className="font-mono tracking-widest font-bold select-all">
              {transferToken}
            </text.p>
            <Button
              onClick={handleCopy}
              design="primary"
              size="sm"
              icon={<CopyIcon />}
              text={copied ? t('builder_transfer_token_copied', undefined, 'Copied!') : copyError ? t('builder_common_error', undefined, 'Error') : t('builder_transfer_copy_code', undefined, 'Copy Code')}
              data-eid={generateClickEID('apps.transfer.copy_token')}
            />
          </div>

          <Button
            onClick={() => {
              if (transferToken) onTransferCreated(transferToken, transferExpiresAt)
              onClose()
            }}
            design="primary"
            size="sm"
            text={t('builder_common_done', undefined, 'Done')}
            data-eid={generateClickEID('apps.transfer.done')}
          />
        </Box>
      )}
    </Modal>
  )
}
