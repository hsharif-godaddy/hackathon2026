'use client'

import { useCallback } from 'react'
import Button from '@ux/button'
import AlertIcon from '@ux/icon/alert'
import Modal from '@ux/modal'
import text from '@ux/text'

import { useEcommSubscriptionAutoRenewStatus } from '@/hooks/useEcommSubscriptionAutoRenewStatus'
import { useSubscriptionRenewal } from '@/hooks/useSubscriptionRenewal'
import { useTranslations } from '@/hooks/useTranslations'

interface PaywallSuspendedModalProps {
  onClose: () => void
  builderEntitlementId?: string | null
}

export function PaywallSuspendedModal({ onClose, builderEntitlementId }: PaywallSuspendedModalProps) {
  const t = useTranslations()
  const { renewSubscription, isRenewing, error: renewalError, resetError } = useSubscriptionRenewal()
  const { data: autoRenewStatus } = useEcommSubscriptionAutoRenewStatus(builderEntitlementId)

  const canRenew = !!autoRenewStatus?.subscriptionId

  const handleRenew = useCallback(async () => {
    if (!autoRenewStatus?.subscriptionId) return
    const result = await renewSubscription(autoRenewStatus.subscriptionId)
    if (result.success) onClose()
  }, [autoRenewStatus?.subscriptionId, renewSubscription, onClose])

  const handleRetry = useCallback(async () => {
    resetError()
    await handleRenew()
  }, [resetError, handleRenew])

  return (
    <Modal title="" onClose={onClose} centered aria-labelledby="paywall-suspended-title">
      <div className="flex flex-col items-center gap-2 -mt-6 max-w-sm">
        <AlertIcon className="w-10 h-10" />
        <text.h2 id="paywall-suspended-title" as="title" size={2} className="text-center">
          {t('builder_paywall_suspended_title')}
        </text.h2>
        <text.p className="text-center">
          {t('builder_paywall_suspended_description')}
        </text.p>
        {renewalError ? (
          <div className="flex flex-col items-center gap-2">
            <text.p className="text-center" emphasis="critical">
              {t('builder_chat_suspended_renewal_failed')}
            </text.p>
            <Button design="primary" size="md" onClick={handleRetry} disabled={isRenewing} text={t('builder_common_retry')} />
          </div>
        ) : (
          <Button
            design="primary"
            size="md"
            onClick={handleRenew}
            disabled={isRenewing || !canRenew}
            text={isRenewing ? t('builder_chat_suspended_renewing') : t('builder_chat_suspended_renew_button')}
          />
        )}
      </div>
    </Modal>
  )
}
