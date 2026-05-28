'use client'

import clsx from 'clsx'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TokenBudgetButton } from '@airo-ux/pattern-library/input/prompt-box'

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { Popover, PopoverAnchor, PopoverContent } from '@/lib/shadcn/popover'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { SubscriptionPlan } from '@/types/credits'
import { getPlanFromSubscription, getTotalCreditsFromGrants } from '@/utils/credits'
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation'
import { GrantsPopoverContent } from '.'

/** Internal Tracking Codes for usage gauge */
const USAGE_GAUGE_ITC = {
  UPGRADE: PAYWALL_ITC.UPGRADE,
  CREDITS: PAYWALL_ITC.CREDITS,
} as const

interface UsageGaugeProps {
  appId: string | null
}

/**
 * Credit usage gauge component.
 *
 * Data source (BMS vs legacy grants) is determined by the BFF based on
 * feature flag. The client always receives CreditGrant[] format.
 */
export default memo(function UsageGauge({ appId }: UsageGaugeProps) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const previousPercentageRef = useRef<number | null>(null)

  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const openCreditsModal = useDevelopPageStore((state) => state.openCreditsModal)

  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription()
  const { data: grants, isLoading: isGrantsLoading } = useCreditGrants({
    subscriptionId: subscription?.id,
  })

  useEffect(function logPopoverImpression() {
    if (open) {
      logImpressionEvent('usage_gauge.popover.view')()
    }
  }, [open])

  const currentPlan = subscription ? getPlanFromSubscription(subscription) : SubscriptionPlan.None

  // Use the same totals the popover displays so the gauge percentage always
  // matches the "X / Y" the user reads in the popover. Summing over all grants
  // (not just active ones) is required; excluding exhausted grants here causes
  // the gauge and popover to disagree, e.g. 687/800 rendering as ~62% instead
  // of ~86% when the monthly plan grant is already fully consumed.
  // Semantically: 0% = credits available but not used; 100% = no usable credits left.
  const { totalCreditsSpent, totalCreditsMax } = getTotalCreditsFromGrants(grants)
  const percentage = totalCreditsMax > 0 ? (totalCreditsSpent / totalCreditsMax) * 100 : 100
  const remainingBudgetPercent = Math.round(Math.max(0, Math.min(100, 100 - percentage)))

  const showLoading = isSubscriptionLoading || isGrantsLoading

  useEffect(function trackCreditThresholds() {
    // Don't track thresholds until data is ready to avoid false crossings on initial load
    if (showLoading) {
      return
    }

    const prevPercentage = previousPercentageRef.current

    if (prevPercentage !== null) {
      if (prevPercentage < 80 && percentage >= 80) {
        logImpressionEvent('credits.threshold.warning')()
      }

      if (prevPercentage < 100 && percentage >= 100) {
        logImpressionEvent('credits.threshold.depleted')()
      }
    }

    previousPercentageRef.current = percentage
  }, [percentage, showLoading])

  const handleUpgradeClick = () => {
    openUpgradeModal('usage_gauge.upgrade', USAGE_GAUGE_ITC.UPGRADE)
    setOpen(false)
    shipAnalyticsLog('usage_gauge.upgrade.clicked', { appId, percentage, plan: currentPlan })
  }

  const handleBuyCreditsClick = () => {
    openCreditsModal('usage_gauge.buy_credits', USAGE_GAUGE_ITC.CREDITS)
    setOpen(false)
    shipAnalyticsLog('usage_gauge.buy_credits.clicked', { appId, percentage, plan: currentPlan })
  }

  const triggerButtonRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(
    function syncUsageGaugeTriggerDom() {
      const el = triggerButtonRef.current
      if (!el) {
        return
      }
      el.setAttribute('data-eid', generateClickEID('usage_gauge.trigger.open'))
      el.setAttribute('data-percentage', String(Math.round(percentage)))
      function preventFocusSteal(e: MouseEvent) {
        e.preventDefault()
      }
      el.addEventListener('mousedown', preventFocusSteal)
      return () => {
        el.removeEventListener('mousedown', preventFocusSteal)
      }
    },
    [percentage],
  )

  if (showLoading) {
    return (
      <div className="w-5 h-5 flex items-center justify-center">
        <div className="w-3 h-3 rounded-full bg-intents-ux-boxLowContrast-backgroundColor animate-pulse" />
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <TokenBudgetButton
          ref={triggerButtonRef}
          percent={remainingBudgetPercent}
          aria-label={t('builder_usage_gauge_aria_label', { percentage: String(Math.round(percentage)) })}
          className={clsx('transition-transform duration-200', open && 'scale-105')}
          onPress={function toggleUsagePopover() {
            setOpen((v) => !v)
          }}
        />
      </PopoverAnchor>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-48 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <GrantsPopoverContent
          grants={grants}
          onUpgradeClick={handleUpgradeClick}
          onBuyCreditsClick={handleBuyCreditsClick}
        />
      </PopoverContent>
    </Popover>
  )
})
