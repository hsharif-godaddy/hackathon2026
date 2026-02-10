'use client'

import AlertIcon from '@ux/icon/alert'
import Modal from '@ux/modal'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'

interface PaywallErrorModalProps {
  onClose: () => void
  onRetry?: () => void
}

/**
 * Error modal shown when CDS fails to load
 */
export function PaywallErrorModal({ onClose, onRetry }: PaywallErrorModalProps) {
  const t = useTranslations()

  return (
    <Modal
      title={t('builder_common_something_went_wrong')}
      onClose={onClose}
      centered
    >
      <div className="flex flex-col items-center gap-3">
        <AlertIcon className="w-8 h-8 text-intents-ux-critical-textColor" />
        <text.p>{t('builder_paywall_load_error')}</text.p>
      </div>
    </Modal>
  )
}
