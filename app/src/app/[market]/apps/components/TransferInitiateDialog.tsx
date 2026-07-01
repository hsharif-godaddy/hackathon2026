'use client'

import { useEffect, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import CopyIcon from '@ux/icon/copy'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { transferEventProps } from '@/app/[market]/apps/components/transfer-constants'
import ProjectsActionModal, {
  ProjectsActionModalFooter,
} from '@/app/[market]/projects/components/ProjectsActionModal'
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
  const eventProps = useMemo(() => transferEventProps(appId), [appId])

  useEffect(function trackDialogImpression() {
    logImpressionEvent('apps.transfer.initiate_dialog', eventProps)()
  }, [eventProps])

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
    logClickEvent('apps.transfer.initiate_submit', eventProps)()

    try {
      const response = await appFetch(`/api/apps/${appId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail: trimmed })
      }, { authLevel: 3 })

      const data = await response.json()

      if (!response.ok) {
        logClickEvent('apps.transfer.initiate_error', eventProps)()
        setError(data.error || data.message || t('builder_transfer_error_initiate_failed', undefined, 'Failed to initiate transfer'))
        return
      }

      logClickEvent('apps.transfer.initiate_success', eventProps)()
      setTransferToken(data.transferToken)
      setTransferExpiresAt(data.expiresAt)
      setStep('token')
    } catch (err) {
      if (err instanceof AuthDismissedError) return
      logClickEvent('apps.transfer.initiate_error', eventProps)()
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
      logClickEvent('apps.transfer.copy_token', eventProps)()
      setCopied(true)
      setCopyError(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError(true)
      setTimeout(() => setCopyError(false), 3000)
    }
  }

  const modalTitle = `${t('builder_transfer_initiate_title', undefined, 'Transfer')} \u201C${appName}\u201D`

  const handleClose = () => {
    if (transferToken) onTransferCreated(transferToken, transferExpiresAt)
    onClose()
  }

  const footer =
    step === 'input' ? (
      <ProjectsActionModalFooter
        onCancel={handleClose}
        cancelText={t('builder_common_cancel')}
        onConfirm={handleInitiate}
        confirmText={
          isLoading
            ? t('builder_transfer_initiating')
            : t('builder_transfer_initiate_submit')
        }
        isLoading={isLoading}
        confirmDisabled={!email.trim()}
        cancelEid={generateClickEID('apps.transfer.initiate_cancel')}
        confirmEid={generateClickEID('apps.transfer.initiate_submit')}
      />
    ) : (
      <Button
        onClick={() => {
          logClickEvent('apps.transfer.done', eventProps)()
          if (transferToken) onTransferCreated(transferToken, transferExpiresAt)
          onClose()
        }}
        design="primary"
        size="sm"
        data-partial="componentAiro"
        className="w-full md:w-auto"
        text={t('builder_common_done', undefined, 'Done')}
      />
    )

  return (
    <ProjectsActionModal
      title={modalTitle}
      description={
        step === 'input'
          ? t('builder_transfer_initiate_description', { appName })
          : step === 'token'
            ? t('builder_transfer_token_description')
            : undefined
      }
      onClose={handleClose}
      footer={footer}
      testId="transfer-initiate-dialog"
    >
      {step === 'input' && (
        <Box orientation="vertical" gap="md" className="w-full text-left">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <text.span size={-1}>
                {t('builder_transfer_bullet_unpublish\t')}
              </text.span>
            </li>
            <li>
              <text.span size={-1}>
                {t('builder_transfer_bullet_domain\t')}
              </text.span>
            </li>
            <li>
              <text.span size={-1}>
                {t('builder_transfer_bullet_republish')}
              </text.span>
            </li>
            <li>
              <text.span size={-1}>
                {t('builder_transfer_bullet_secrets')}
              </text.span>
            </li>
          </ul>

          <text.p size={-1} emphasis="passive">
            {t('builder_transfer_initiate_description_2\t')}
          </text.p>

          <TextInput
            id="target-email"
            data-eid={generateClickEID('apps.transfer.email_input')}
            label={t('builder_transfer_email_label')}
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
            placeholder={t('builder_transfer_email_placeholder\t')}
            multiline={false}
          />
        </Box>
      )}

      {step === 'token' && transferToken && (
        <Box orientation="vertical" gap="md" className="w-full">
          <text.p size={-1} emphasis="passive">
            {t('builder_transfer_token_expiry_note')}
          </text.p>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-intents-ux-box-borderColor p-4">
            <text.p size={4} className="select-all font-mono font-bold tracking-widest">
              {transferToken}
            </text.p>
            <Button
              onClick={handleCopy}
              design="primary"
              size="sm"
              data-partial="componentAiro"
              icon={<CopyIcon />}
              text={
                copied
                  ? t('builder_transfer_token_copied')
                  : copyError
                    ? t('builder_common_error')
                    : t('builder_transfer_copy_code')
              }
            />
          </div>
        </Box>
      )}
    </ProjectsActionModal>
  )
}
