'use client'

import { memo, useEffect, useRef, useState } from 'react'

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useDailyUsage } from '@/hooks/useDailyUsage'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import CircularGauge from '@/lib/CircularGauge'
import { shipAnalyticsLog } from '@/lib/logging'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { SubscriptionPlan } from '@/types/credits'
import { getEffectiveCreditsSpent, getPlanFromSubscription } from '@/utils/credits'
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation'
import { GrantsPopoverContent, LegacyPopoverContent } from '.'

/** Internal Tracking Codes for usage gauge */
const USAGE_GAUGE_ITC = {
  UPGRADE: PAYWALL_ITC.UPGRADE,
  CREDITS: PAYWALL_ITC.CREDITS,
} as const

interface UsageGaugeProps {
  appId: string | null
}

export default memo(function UsageGauge({ appId }: UsageGaugeProps) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const previousPercentageRef = useRef<number | null>(null)

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setOpen(true)
  }

  const handleMouseLeave = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false)
      closeTimeoutRef.current = null
    }, 200)
  }

  // Cleanup timeout on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
        closeTimeoutRef.current = null
      }
    }
  }, [])

  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const openCreditsModal = useDevelopPageStore((state) => state.openCreditsModal)
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants')

  // Daily usage for non-grants mode
  const { data, isLoading, formattedResetTime: resetTimeData } = useDailyUsage({
    appId,
    enabled: !!appId && !isGrantsEnabled
  })

  // Subscription and grants for grants mode
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription()
  const { data: grants, isLoading: isGrantsLoading } = useCreditGrants({
    subscriptionId: isGrantsEnabled ? subscription?.id : undefined,
  })

  useEffect(function logPopoverImpression() {
    if (open) {
      logImpressionEvent('usage_gauge.popover.view')()
    }
  }, [open])

  const translatedResetTime = resetTimeData
    ? t(`builder_usage_limit_reset_${resetTimeData.dayKey}`, { time: resetTimeData.timeString })
    : null

  const { data: purchaseEnabled } = useSwitchboard('appbuilder-usage-purchase')

  const currentPlan = subscription ? getPlanFromSubscription(subscription) : SubscriptionPlan.None

  const totalCreditsSpent = grants?.reduce((sum, g) => sum + getEffectiveCreditsSpent(g.creditsSpent, g.creditsMax), 0) ?? 0
  const totalCreditsMax = grants?.reduce((sum, g) => sum + g.creditsMax, 0) ?? 0
  const grantsPercentage = totalCreditsMax > 0 ? (totalCreditsSpent / totalCreditsMax) * 100 : 0
  const percentage = isGrantsEnabled ? grantsPercentage : (data ? Math.min(data.percentage, 100) : 0)

  // Loading state - compute before threshold effect to gate it
  const showLoading = isGrantsEnabled
    ? (isSubscriptionLoading || isGrantsLoading)
    : (isLoading || !data)

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

  const handleBuyTokensClick = () => {
    // When grants feature is on, open credits modal; otherwise fall back to upgrade modal
    if (isGrantsEnabled) {
      openCreditsModal('usage_gauge.buy_tokens', USAGE_GAUGE_ITC.CREDITS)
    } else {
      openUpgradeModal('usage_gauge.buy_tokens', USAGE_GAUGE_ITC.UPGRADE)
    }
    setOpen(false)
    shipAnalyticsLog('usage_gauge.buy_tokens.clicked', { appId, percentage })
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
          className="relative w-5 h-5 flex items-center justify-center cursor-pointer focus:outline-none rounded-full group"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(!open)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          data-eid={generateClickEID('usage_gauge.trigger.open')}
          aria-label={t('builder_usage_gauge_aria_label', { percentage: String(Math.round(percentage)) })}
        >
          <div className="transition-transform group-hover:scale-110">
            <CircularGauge
              value={percentage}
              size={20}
              strokeWidth={4}
            />
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className={isGrantsEnabled ? 'w-48 p-3' : 'w-40 p-3'}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {isGrantsEnabled ? (
          <GrantsPopoverContent
            grants={grants}
            onUpgradeClick={handleUpgradeClick}
            onBuyCreditsClick={handleBuyCreditsClick}
          />
        ) : (
          <LegacyPopoverContent
            percentage={percentage}
            translatedResetTime={translatedResetTime}
            purchaseEnabled={!!purchaseEnabled}
            onUpgradeClick={handleUpgradeClick}
            onBuyTokensClick={handleBuyTokensClick}
          />
        )}
      </PopoverContent>
    </Popover>
  )
})
