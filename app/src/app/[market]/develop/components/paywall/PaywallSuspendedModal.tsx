'use client'

import { useCallback } from 'react'
import Button from '@ux/button'
import AlertIcon from '@ux/icon/alert'
import Modal from '@ux/modal'
import text from '@ux/text'

import { useEcommSubscriptionAutoRenewStatus } from '@/hooks/useEcommSubscriptionAutoRenewStatus'
import { useIsEnterpriseUser } from '@/hooks/useIsEnterpriseUser'
import { useSubscriptionRenewal } from '@/hooks/useSubscriptionRenewal'
import { useTranslations } from '@/hooks/useTranslations'

interface PaywallSuspendedModalProps {
  onClose: () => void
  builderEntitlementId?: string | null
}

export function PaywallSuspendedModal({ onClose, builderEntitlementId }: PaywallSuspendedModalProps) {
  const t = useTranslations()
  const isEnterpriseUser: boolean = useIsEnterpriseUser()
  const { renewSubscription, isRenewing, error: renewalError, resetError } = useSubscriptionRenewal()
  // Skip the ecomm subscription fetch for enterprise members — their
  // billing is centrally managed and there is no per-member ecomm
  // subscription / auto-renew to read. Calling the BFF would 404
  // (subscriptions-shim can't resolve a builder entitlement against the
  // member's personal customerId). Pass null to short-circuit the hook's
  // `enabled` guard so no request is fired. The component-level
  // early-return below ensures we never render the suspended-renewal UI
  // for an ent member; this hook-level guard prevents needless 404s.
  const entitlementForLookup: string | null = isEnterpriseUser ? null : (builderEntitlementId ?? null)
  const { data: autoRenewStatus } = useEcommSubscriptionAutoRenewStatus(entitlementForLookup)

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

  // Enterprise members never see the self-serve renewal modal — there's no
  // actionable renewal flow for them (the enterprise admin owns billing).
  // The early-return must follow all hook calls above to satisfy
  // react-hooks/rules-of-hooks; the hooks short-circuit cheaply when
  // `isEnterpriseUser` is true (entitlementForLookup=null disables the
  // network fetch).
  if (isEnterpriseUser) {
    return null
  }

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
