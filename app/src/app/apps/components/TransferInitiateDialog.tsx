'use client'

import { useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import text from '@ux/text'
import TextInput from '@ux/text-input'

import { useTranslations } from '@/hooks/useTranslations'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { generateClickEID } from '@/utils/instrumentation'

interface TransferInitiateDialogProps {
  appId: string
  appName: string
  onClose: () => void
  onTransferCreated: (transferToken: string) => void
}

type DialogStep = 'input' | 'token'

export default function TransferInitiateDialog({
  appId,
  appName,
  onClose,
  onTransferCreated
}: TransferInitiateDialogProps) {
  const t = useTranslations()
  const [step, setStep] = useState<DialogStep>('input')
  const [shopperId, setShopperId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [transferToken, setTransferToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  const handleInitiate = async () => {
    const trimmed = shopperId.trim()

    if (!trimmed) {
      setError(t('builder_transfer_error_shopper_required', undefined, 'Shopper ID is required'))
      return
    }

    if (!/^\d+$/.test(trimmed)) {
      setError(t('builder_transfer_error_shopper_invalid', undefined, 'Shopper ID must be numeric'))
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await appFetch(`/api/apps/${appId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetShopperId: trimmed })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || data.message || t('builder_transfer_error_initiate_failed', undefined, 'Failed to initiate transfer'))
        return
      }

      setTransferToken(data.transferToken)
      setStep('token')
      onTransferCreated(data.transferToken)
    } catch (err) {
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

  return (
    <Modal
      title={t('builder_transfer_initiate_title', undefined, 'Transfer App')}
      onClose={onClose}
      centered
      focusLock={false}
    >
      {step === 'input' && (
        <Box orientation="vertical" gap="md" className="max-w-md">
          <text.p size={0} emphasis="passive">
            {t('builder_transfer_initiate_description', { appName }, 'Enter the recipient\'s shopper ID to transfer {appName}.')}
          </text.p>

          <Box orientation="vertical" gap="sm">
            <TextInput
              id="target-shopper-id"
              label={t('builder_transfer_shopper_label', undefined, 'Recipient Shopper ID')}
              value={shopperId}
              onChange={(value) => {
                setShopperId(value.replace(/\D/g, ''))
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isLoading) {
                  handleInitiate()
                }
              }}
              errorMessage={error || undefined}
              disabled={isLoading}
              visualSize="sm"
              placeholder={t('builder_transfer_shopper_placeholder', undefined, 'Enter shopper ID')}
              multiline={false}
              data-eid={generateClickEID('apps.transfer.shopper_input')}
            />
          </Box>

          <Box orientation="horizontal" gap="sm" className="pt-4 justify-end">
            <Button
              onClick={onClose}
              disabled={isLoading}
              design="secondary"
              size="sm"
              text={t('builder_common_cancel', undefined, 'Cancel')}
              data-eid={generateClickEID('apps.transfer.initiate_cancel')}
            />
            <Button
              onClick={handleInitiate}
              disabled={isLoading || !shopperId.trim()}
              design="primary"
              size="sm"
              text={isLoading ? t('builder_transfer_initiating', undefined, 'Transferring...') : t('builder_transfer_initiate_submit', undefined, 'Transfer')}
              data-eid={generateClickEID('apps.transfer.initiate_submit')}
            />
          </Box>
        </Box>
      )}

      {step === 'token' && transferToken && (
        <Box orientation="vertical" gap="md" className="max-w-md">
          <text.p size={0} emphasis="passive">
            {t('builder_transfer_token_description', undefined, 'Share this code with the recipient. They will need it to accept the transfer.')}
          </text.p>

          <Box orientation="vertical" gap="sm" className="items-center">
            <div className="bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor rounded-lg p-4 text-center w-full">
              <text.p size={4} className="font-mono tracking-widest font-bold select-all">
                {transferToken}
              </text.p>
            </div>

            <Button
              onClick={handleCopy}
              design="secondary"
              size="sm"
              text={copied ? t('builder_transfer_token_copied', undefined, 'Copied!') : copyError ? t('builder_common_error', undefined, 'Error') : t('builder_transfer_token_copy', undefined, 'Copy Code')}
              data-eid={generateClickEID('apps.transfer.copy_token')}
            />
          </Box>

          <text.p size={-1} emphasis="passive" className="text-center">
            {t('builder_transfer_token_expiry_note', undefined, 'This code expires in 72 hours.')}
          </text.p>

          <Box orientation="horizontal" gap="sm" className="pt-2 justify-end">
            <Button
              onClick={onClose}
              design="primary"
              size="sm"
              text={t('builder_common_done', undefined, 'Done')}
              data-eid={generateClickEID('apps.transfer.done')}
            />
          </Box>
        </Box>
      )}
    </Modal>
  )
}
