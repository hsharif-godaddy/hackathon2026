'use client'

import AlertIcon from '@ux/icon/alert'
import Modal from '@ux/modal'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'

interface PaywallErrorModalProps {
  onClose: () => void
}

/**
 * Error modal shown when CDS/UPP fails to load
 */
export function PaywallErrorModal({ onClose }: PaywallErrorModalProps) {
  const t = useTranslations()

  return (
    <Modal
      title=""
      onClose={onClose}
      centered
      aria-labelledby="paywall-error-title"
    >
      <div className="flex flex-col items-center gap-2 -mt-6">
        <AlertIcon className="w-10 h-10" />
        <text.h2 id="paywall-error-title" as="title" size={2} className="text-center">
          {t('builder_paywall_error_title')}
        </text.h2>
        <text.p className="text-center">
          {t('builder_paywall_error_description')}
        </text.p>
      </div>
    </Modal>
  )
}
