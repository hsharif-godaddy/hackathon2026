'use client'

import { memo, useEffect, useState } from 'react'

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

  // Log impression when popover opens
  useEffect(function logPopoverImpression() {
    if (open) {
      logImpressionEvent('usage_gauge.popover.view')()
    }
  }, [open])

  // Translate the day key with time parameter (e.g., "today at {time}")
  const translatedResetTime = resetTimeData
    ? t(`builder_usage_limit_reset_${resetTimeData.dayKey}`, { time: resetTimeData.timeString })
    : null

  const { data: purchaseEnabled } = useSwitchboard('appbuilder-usage-purchase')

  // Calculate plan info
  const currentPlan = subscription ? getPlanFromSubscription(subscription) : SubscriptionPlan.None
  const isFreePlan = currentPlan === SubscriptionPlan.Free || currentPlan === SubscriptionPlan.None
  const builderEntitlementId = subscription?.builderEntitlementId

  // Disable purchase buttons when grants enabled but entitlement not yet available
  const isPurchaseDisabled = isGrantsEnabled === true && !builderEntitlementId

  // Calculate percentage for gauge
  const totalCreditsSpent = grants?.reduce((sum, g) => sum + getEffectiveCreditsSpent(g.creditsSpent, g.creditsMax), 0) ?? 0
  const totalCreditsMax = grants?.reduce((sum, g) => sum + g.creditsMax, 0) ?? 0
  const grantsPercentage = totalCreditsMax > 0 ? (totalCreditsSpent / totalCreditsMax) * 100 : 0
  const percentage = isGrantsEnabled ? grantsPercentage : (data ? Math.min(data.percentage, 100) : 0)

  // Event handlers
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

  // Loading state
  const showLoading = isGrantsEnabled
    ? (isSubscriptionLoading || isGrantsLoading)
    : (isLoading || !data)

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
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
          data-eid={generateClickEID('usage_gauge.trigger.open')}
          aria-label={t('builder_usage_gauge_aria_label', { percentage: String(Math.round(percentage)) })}
        >
          <div className="transition-transform group-hover:scale-110">
            <CircularGauge
              value={percentage}
              size={20}
              strokeWidth={3}
            />
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className={isGrantsEnabled ? 'w-48 p-3' : 'w-40 p-3'}
      >
        {isGrantsEnabled ? (
          <GrantsPopoverContent
            grants={grants}
            isFreePlan={isFreePlan}
            onUpgradeClick={handleUpgradeClick}
            onBuyCreditsClick={handleBuyCreditsClick}
            disabled={isPurchaseDisabled}
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
