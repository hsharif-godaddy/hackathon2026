'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useIntl } from 'react-intl'
import Button from '@ux/button'
import text from '@ux/text'

import StreamingAlertMessage from '@/app/develop/components/StreamingAlertMessage'
import { useBudgetService } from '@/hooks/useBudgetService'
import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { DomainStatus, DomainType } from '@/lib/control-plane/types'
import { canUpgradePlan, PAYWALL_ITC } from '@/lib/paywall/shared'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { SubscriptionPlan } from '@/types/credits'
import { getMonthlyPlanGrant, getPlanFromSubscription } from '@/utils/credits'
import { logImpressionEvent } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'

/**
 * The "Usage Limit Reached" alert with Upgrade / Buy AI Credits actions.
 * Single source of truth used in two places:
 *   - StreamingIntegratedResponse: shown after the AI message that was cut off mid-stream
 *   - ChatPane: shown above the disabled input when credits are already exhausted on page load
 */
interface BudgetExceededBannerProps {
  onClose?: () => void
}

export default function BudgetExceededBanner({ onClose }: BudgetExceededBannerProps) {
  const t = useTranslations()
  const intl = useIntl()
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const openCreditsModal = useDevelopPageStore((state) => state.openCreditsModal)

  const { data: isBudgetServiceEnabled = false } = useSwitchboard('app-builder-budget-service')
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription()

  // Gate grants fetch: disabled when budget path active
  const { data: grants } = useCreditGrants({
    subscriptionId: !isBudgetServiceEnabled ? subscription?.id : undefined,
  })

  // Budget path: fetch credit status from BFF
  const { data: budgetData } = useBudgetService({
    subscriptionId: subscription?.id,
    enabled: isBudgetServiceEnabled,
  })

  const currentPlan = subscription ? getPlanFromSubscription(subscription) : SubscriptionPlan.None
  const isNotUltimatePlan = !isSubscriptionLoading && canUpgradePlan(currentPlan)
  const builderEntitlementId = subscription?.builderEntitlementId
  const isPurchaseDisabled = !builderEntitlementId

  const site = useDevelopPageStore((state) => state.site)
  const hasPublishedApp = hasBeenPublished(site)
  const hasCustomDomain = Boolean(
    site?.domains?.some((d) => d.domainType !== DomainType.PREFIX && d.status === DomainStatus.ACTIVE)
  )

  const hasLoggedImpressionRef = useRef(false)
  useEffect(() => {
    if (hasLoggedImpressionRef.current || site === null) return
    hasLoggedImpressionRef.current = true
    logImpressionEvent('chat.budgetExceeded.view', { "has_published_app": hasPublishedApp, "has_custom_domain": hasCustomDomain })()
  }, [hasPublishedApp, hasCustomDomain, site])

  const resetTime = useMemo(() => {
    if (isBudgetServiceEnabled) {
      if (!budgetData) return undefined
      const planItem = budgetData.items.find(function findPlanMonthly(item) { return item.type === 'plan-monthly' })
      if (planItem?.expiresAt) {
        const expiresDate = new Date(planItem.expiresAt)
        const date = intl.formatDate(expiresDate, { month: 'long', day: 'numeric' })
        const time = intl.formatDate(expiresDate, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        return t('builder_usage_limit_reset_on_date', { date, time })
      }
      return undefined
    }

    if (!grants) return undefined
    const planGrant = getMonthlyPlanGrant(grants)
    if (planGrant?.useBefore) {
      const useByDate = new Date(planGrant.useBefore)
      const date = intl.formatDate(useByDate, { month: 'long', day: 'numeric' })
      const time = intl.formatDate(useByDate, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
      return t('builder_usage_limit_reset_on_date', { date, time })
    }
    return undefined
  }, [intl, t, grants, isBudgetServiceEnabled, budgetData])

  const actions = useMemo(() => {
    const buyCreditsButton = (
      <Button
        size="sm"
        design="secondary"
        onClick={() => openCreditsModal('budget_exceeded.buy_credits', PAYWALL_ITC.CREDITS)}
        text={t('builder_usage_gauge_buy_tokens')}
        disabled={isPurchaseDisabled}
      />
    )

    return isNotUltimatePlan ? (
      <>
        <Button
          size="sm"
          design="secondary"
          onClick={() => openUpgradeModal('budget_exceeded.upgrade', PAYWALL_ITC.UPGRADE)}
          text={t('builder_usage_gauge_upgrade')}
          disabled={isPurchaseDisabled}
        />
        {buyCreditsButton}
      </>
    ) : buyCreditsButton
  }, [isNotUltimatePlan, isPurchaseDisabled, t, openUpgradeModal, openCreditsModal])

  return (
    <StreamingAlertMessage
      type="Critical"
      title={t('builder_usage_limit_title')}
      onClose={onClose}
      message={
        resetTime ? (
          <text.p
            size={0}
            dangerouslySetInnerHTML={{
              __html: t('builder_usage_limit_message', {
                resetTime,
                strong: (chunks: string) => `<strong>${chunks}</strong>`
              })
            }}
          />
        ) : (
          t('builder_usage_limit_message_no_reset_time')
        )
      }
      actions={actions}
    />
  )
}
