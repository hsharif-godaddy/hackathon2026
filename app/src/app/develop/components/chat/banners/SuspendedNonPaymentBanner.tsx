'use client'

import { useEffect, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import Button from '@ux/button'
import text from '@ux/text'

import { useEcommSubscriptionAutoRenewStatus } from '@/hooks/useEcommSubscriptionAutoRenewStatus'
import { useGasketData } from '@/hooks/useGasketData'
import { useSubscriptionRenewal } from '@/hooks/useSubscriptionRenewal'
import { useTranslations } from '@/hooks/useTranslations'
import ChatBanner from '@/lib/ChatBanner'
import { FREEMIUM_CREDIT_LIMIT, getFormattedUnpublishDate } from '@/lib/paywall/shared'
import { generateClickEID, logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

interface SuspendedNonPaymentBannerProps {
  /** Builder entitlement ID for fetching term data */
  builderEntitlementId?: string | null
  /** When the subscription renews (unpublish date is calculated from this) */
  renewsAt?: string
}

/**
 * Chat input banner shown when subscription is suspended due to non-payment.
 *
 * Displays a warning banner with a renew button that allows users to
 * renew their subscription directly from the chat interface.
 *
 * This banner is dismissible via session state (useState) and takes
 * precedence over usage warning and upgrade banners.
 */
export default function SuspendedNonPaymentBanner({
  builderEntitlementId,
  renewsAt,
}: SuspendedNonPaymentBannerProps) {
  const t = useTranslations()
  const { intl } = useGasketData()
  const [isDismissed, setIsDismissed] = useState(false)
  const hasLoggedImpressionRef = useRef(false)
  const { renewSubscription, isRenewing, error: renewalError, resetError } = useSubscriptionRenewal()
  const { data: autoRenewStatus } = useEcommSubscriptionAutoRenewStatus(builderEntitlementId)

  useEffect(() => {
    if (!isDismissed && !hasLoggedImpressionRef.current) {
      logImpressionEvent('chat.suspendedNonPaymentBanner.view')()
      hasLoggedImpressionRef.current = true
    }
  }, [isDismissed])

  const formattedUnpublishDate = getFormattedUnpublishDate(renewsAt, intl?.locale)

  if (isDismissed) return null

  const handleClose = () => {
    logClickEvent('chat.suspendedNonPaymentBanner.close')()
    setIsDismissed(true)
  }

  const handleRenew = async () => {
    if (!autoRenewStatus?.subscriptionId) {
      return
    }
    await renewSubscription(autoRenewStatus.subscriptionId)
  }

  const canRenew = !!autoRenewStatus?.subscriptionId

  const handleRetry = async () => {
    resetError()
    await handleRenew()
  }

  // Show error state if renewal failed
  if (renewalError) {
    return (
      <ChatBanner variant="critical" onClose={resetError}>
        <div className="flex flex-col gap-1">
          <text.span as="caption" size={-1} className="flex-1" text={t('builder_chat_suspended_renewal_failed')} />
          <Button
            design="inline"
            size="sm"
            className="!p-0 !h-auto underline !normal-case self-start"
            onClick={handleRetry}
            disabled={isRenewing}
            text={t('builder_common_retry')}
            data-eid={generateClickEID('chat.suspendedNonPaymentBanner.retry')}
          />
        </div>
      </ChatBanner>
    )
  }

  return (
    <ChatBanner variant="warning" onClose={handleClose}>
      <div className="flex flex-col gap-1">
        <text.span as="caption" size={-1} className="flex-1">
          <FormattedMessage
            id="builder_chat_suspended_message"
            values={{
              unpublishDate: <strong>{formattedUnpublishDate}</strong>,
              creditLimit: <strong>{FREEMIUM_CREDIT_LIMIT}</strong>,
            }}
          />
        </text.span>
        <Button
          design="inline"
          size="sm"
          className="!p-0 !h-auto underline !normal-case self-start"
          onClick={handleRenew}
          disabled={isRenewing || !canRenew}
          text={isRenewing ? t('builder_chat_suspended_renewing') : t('builder_chat_suspended_renew_button')}
          data-eid={generateClickEID('chat.suspendedNonPaymentBanner.renew')}
        />
      </div>
    </ChatBanner>
  )
}
