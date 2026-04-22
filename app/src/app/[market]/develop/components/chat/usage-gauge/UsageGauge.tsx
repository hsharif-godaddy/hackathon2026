'use client'

import clsx from 'clsx'
import { memo, useEffect, useRef, useState } from 'react'

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { useTranslations } from '@/hooks/useTranslations'
import CircularGauge from '@/lib/CircularGauge'
import { shipAnalyticsLog } from '@/lib/logging'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { SubscriptionPlan } from '@/types/credits'
import { getActiveGrants, getEffectiveCreditsSpent, getPlanFromSubscription } from '@/utils/credits'
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

  // Compute percentage from grants (BFF handles source selection)
  // Semantically: 0% = credits available but not used; 100% = no usable credits left
  const activeGrants = grants ? getActiveGrants(grants) : []
  const totalCreditsSpent = activeGrants.reduce((sum, g) => sum + getEffectiveCreditsSpent(g.creditsSpent, g.creditsMax), 0)
  const totalCreditsMax = activeGrants.reduce((sum, g) => sum + g.creditsMax, 0)
  // When no active grants remain, show 100% (exhausted) instead of 0% (available)
  const percentage = totalCreditsMax > 0 ? (totalCreditsSpent / totalCreditsMax) * 100 : 100

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

  if (showLoading) {
    return (
      <div className="w-5 h-5 flex items-center justify-center">
        <div className="w-3 h-3 rounded-full bg-intents-ux-boxLowContrast-backgroundColor animate-pulse" />
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={clsx(
            'relative flex items-center justify-center cursor-pointer rounded-full transition-all duration-200 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open && 'scale-105'
          )}
          onMouseDown={(e) => e.preventDefault()}
          data-eid={generateClickEID('usage_gauge.trigger.open')}
          aria-label={t('builder_usage_gauge_aria_label', { percentage: String(Math.round(percentage)) })}
        >
          <div>
            <CircularGauge
              value={percentage}
              size={22}
              strokeWidth={4}
            />
          </div>
        </button>
      </PopoverTrigger>

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
