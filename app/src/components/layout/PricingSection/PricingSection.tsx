'use client'

import { useInView } from 'framer-motion'
import React, { useCallback, useEffect, useRef } from 'react'
import { FormattedMessage } from 'react-intl'
import Box from '@ux/box'
import Button from '@ux/button'
import CloudUploadIcon from '@ux/icon/cloud-upload'
import DatabaseIcon from '@ux/icon/database'
import DesktopIcon from '@ux/icon/desktop'
import DomainIcon from '@ux/icon/domain'
import DownloadIcon from '@ux/icon/download'
import ServerIcon from '@ux/icon/server'
import UserIcon from '@ux/icon/user'
import text from '@ux/text'

import { UpgradePollingModal } from '@/app/[market]/develop/components/paywall'
import PageSection from '@/components/layout/PageSection'
import PlanPriceDisplay from '@/components/layout/PricingSection/PlanPriceDisplay'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { InfoTooltip } from '@/components/ui/InfoTooltip'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { useIsInCohort } from '@/hooks/useHivemind'
import { usePricingOffers } from '@/hooks/usePricingOffers'
import { useSsoSignIn } from '@/hooks/useSsoSignIn'
import { useSubscription } from '@/hooks/useSubscription'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsUpgradePolling } from '@/hooks/useUpgradePurchase'
import { shipAnalyticsLog } from '@/lib/logging'
import { PLAN_PUBLISH_LIMITS } from '@/lib/publish-limit'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { SubscriptionPlan } from '@/types/credits'
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation'

// Session-scoped storage key for pending upgrade action
const PENDING_UPGRADE_KEY = 'airo-pending-pricing-upgrade'

export interface PricingSectionProps {
  onPricingViewEnd?: (detail: { viewDurationMs: number }) => void
}

interface PlanFeature {
  icon: React.ComponentType<{ className?: string }>
  titleKey: string
  titleParams?: Record<string, string | number>
  tooltipKey?: string
}

const FREE_FEATURES: PlanFeature[] = [
  { icon: DatabaseIcon, titleKey: 'builder_pricing_item_credits', titleParams: { count: 50 }, tooltipKey: 'builder_pricing_item_credits_tooltip' },
  { icon: DesktopIcon, titleKey: 'builder_pricing_free_item_creation' },
]

const STARTER_FEATURES: PlanFeature[] = [
  { icon: DatabaseIcon, titleKey: 'builder_pricing_item_credits', titleParams: { count: 150 }, tooltipKey: 'builder_pricing_item_credits_tooltip' },
  { icon: CloudUploadIcon, titleKey: 'builder_pricing_item_published', titleParams: { count: PLAN_PUBLISH_LIMITS[SubscriptionPlan.Starter] ?? 0 } },
  { icon: DesktopIcon, titleKey: 'builder_pricing_starter_item_creation' },
  { icon: ServerIcon, titleKey: 'builder_pricing_starter_item_hosting', tooltipKey: 'builder_pricing_starter_item_hosting_tooltip' },
  { icon: DomainIcon, titleKey: 'builder_pricing_starter_item_domain', tooltipKey: 'builder_pricing_item_domain_tooltip' },
  { icon: DownloadIcon, titleKey: 'builder_pricing_starter_item_download', tooltipKey: 'builder_pricing_item_download_tooltip' },
]

const PROFESSIONAL_FEATURES: PlanFeature[] = [
  { icon: DatabaseIcon, titleKey: 'builder_pricing_item_credits', titleParams: { count: 300 }, tooltipKey: 'builder_pricing_item_credits_tooltip' },
  { icon: CloudUploadIcon, titleKey: 'builder_pricing_item_published', titleParams: { count: PLAN_PUBLISH_LIMITS[SubscriptionPlan.Professional] ?? 0 } },
  { icon: DesktopIcon, titleKey: 'builder_pricing_unlimited_creation' },
  { icon: ServerIcon, titleKey: 'builder_pricing_starter_item_hosting', tooltipKey: 'builder_pricing_starter_item_hosting_tooltip' },
  { icon: DomainIcon, titleKey: 'builder_pricing_starter_item_domain', tooltipKey: 'builder_pricing_item_domain_tooltip' },
  { icon: DownloadIcon, titleKey: 'builder_pricing_starter_item_download', tooltipKey: 'builder_pricing_item_download_tooltip' },
  { icon: UserIcon, titleKey: 'builder_pricing_item_shared_access' },
]

const ULTIMATE_FEATURES: PlanFeature[] = [
  { icon: DatabaseIcon, titleKey: 'builder_pricing_item_credits', titleParams: { count: 750 }, tooltipKey: 'builder_pricing_item_credits_tooltip' },
  { icon: CloudUploadIcon, titleKey: 'builder_pricing_item_published', titleParams: { count: PLAN_PUBLISH_LIMITS[SubscriptionPlan.Ultimate] ?? 0 } },
  { icon: DesktopIcon, titleKey: 'builder_pricing_unlimited_creation' },
  { icon: ServerIcon, titleKey: 'builder_pricing_starter_item_hosting', tooltipKey: 'builder_pricing_starter_item_hosting_tooltip' },
  { icon: DomainIcon, titleKey: 'builder_pricing_starter_item_domain', tooltipKey: 'builder_pricing_item_domain_tooltip' },
  { icon: DownloadIcon, titleKey: 'builder_pricing_starter_item_download', tooltipKey: 'builder_pricing_item_download_tooltip' },
  { icon: UserIcon, titleKey: 'builder_pricing_item_shared_access' },
  // TODO: uncomment when git hosting feature is added
  // { icon: CodeIcon, titleKey: 'builder_pricing_item_git_hosting', tooltipKey: 'builder_pricing_item_git_hosting_tooltip' },
]

export default function PricingSection({ onPricingViewEnd }: PricingSectionProps) {
  const t = useTranslations();
  const { data: pricingData, isLoading } = usePricingOffers()
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const isUpgradePolling = useIsUpgradePolling()

  const { isAuthenticated, isAuthDisabled, isLoading: authIsLoading } = useAuthContext()
  const { signIn } = useSsoSignIn()
  // Disabled by default - only refetch when restoring pending upgrade to avoid unnecessary API calls
  const { refetch: refetchSubscription } = useSubscription({ enabled: false })

  const sectionRef = useRef<HTMLDivElement | null>(null)
  const isInView = useInView(sectionRef, { amount: 0.1 })
  const visibleSinceRef = useRef<number | null>(null)
  const hasLoggedViewRef = useRef(false)
  const hasLoggedPricingImpressionRef = useRef(false)

  useEffect(() => {
    if (isInView && !hasLoggedPricingImpressionRef.current) {
      hasLoggedPricingImpressionRef.current = true
      logImpressionEvent('homepage.pricing.view')()
    }
  }, [isInView])

  useEffect(() => {
    if (!onPricingViewEnd || hasLoggedViewRef.current) return
    if (isInView) {
      if (visibleSinceRef.current === null) visibleSinceRef.current = performance.now()
    } else if (visibleSinceRef.current !== null) {
      onPricingViewEnd({ viewDurationMs: Math.round(performance.now() - visibleSinceRef.current) })
      hasLoggedViewRef.current = true
      visibleSinceRef.current = null
    }
  }, [isInView, onPricingViewEnd])

  useEffect(() => {
    if (!onPricingViewEnd) return
    function flush() {
      if (hasLoggedViewRef.current || visibleSinceRef.current === null) return
      onPricingViewEnd({ viewDurationMs: Math.round(performance.now() - visibleSinceRef.current) })
      hasLoggedViewRef.current = true
      visibleSinceRef.current = null
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [onPricingViewEnd])

  useEffect(() => {
    if (authIsLoading || !isAuthenticated) return

    const pendingUpgrade = sessionStorage.getItem(PENDING_UPGRADE_KEY)
    if (!pendingUpgrade) return

    sessionStorage.removeItem(PENDING_UPGRADE_KEY)

    // fetch subscription to get latest data
    refetchSubscription()

    // Scroll to pricing section in background while opening modal
    const pricingSection = document.getElementById('pricing-section')
    if (pricingSection) {
      pricingSection.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    openUpgradeModal('pricing_section.upgrade', 'slp_airo_ai_builder')
    shipAnalyticsLog('pricing_section.upgrade_modal.opened_after_login', {})
  }, [authIsLoading, isAuthenticated, refetchSubscription, openUpgradeModal])

  const handleUpgradeClick = useCallback(() => {
    if (!isAuthDisabled && !isAuthenticated) {
      try {
        sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      } catch (error) {
        logger.warn('pricing_section.pending_upgrade.save_error', {
          error: error instanceof Error ? error.message : String(error)
        })
      }

      signIn()
      return
    }

    openUpgradeModal('pricing_section.upgrade', 'slp_airo_ai_builder')
  }, [isAuthDisabled, isAuthenticated, signIn, openUpgradeModal])

  const handleStartBuildingClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const PricingItem = ({ icon, feature }: { icon: React.ReactNode, feature: PlanFeature }) => {
    const tooltipContent = feature.tooltipKey ? t(feature.tooltipKey) : undefined

    return (
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
        {icon}
        <text.p size={0}>
          <FormattedMessage
            id={feature.titleKey}
            values={{
              ...feature.titleParams,
              tooltip: tooltipContent ? <InfoTooltip content={tooltipContent} /> : null
            }}
          />
        </text.p>
      </Box>
    )
  }

  const renderFeatures = (features: PlanFeature[]) => {
    return features.map((feature) => (
      <PricingItem
        key={feature.titleKey}
        icon={<feature.icon className="size-2" />}
        feature={feature}
      />
    ))
  }

  const isInTreatment = useIsInCohort(EXPERIMENT_IDS.recommendedPlan, 'treatment')
  const recommendedPlan = isInTreatment ? SubscriptionPlan.Ultimate : SubscriptionPlan.Professional;

  const paidCardStyles = "flex flex-col h-full bg-intents-ux-boxLowContrast-backgroundColor border border-intents-ux-box-borderColor rounded-2xl text-intents-ux-boxLowContrast-foregroundColor overflow-hidden"
  const recommendedCardStyles = `${paidCardStyles} border-2 border-ring-ai relative overflow-visible shadow-[0_0_18px_rgba(139,92,246,0.8)]`

  return (
    <div ref={sectionRef}>
    {isUpgradePolling && (
      <div className="relative z-[50]">
        <UpgradePollingModal />
      </div>
    )}
    <PageSection data-testid="pricing-section" id="pricing-section">
      <div className="w-full max-w-[1700px] mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 xl:gap-2 items-stretch">

          {/* Free Plan */}
          <div
            className="flex flex-col h-auto md:h-full xl:h-auto xl:self-center border border-intents-ux-box-borderColor rounded-2xl overflow-hidden"
            data-partial="inverted"
          >
            <div className="p-4">
              <text.h3 as="heading" size={1} className="mb-2" text={t('builder_pricing_free_title')} />
              <text.p size={1} className="mb-4" text={t('builder_pricing_free_desc')} />
              <Button
                design="primary"
                text={t('builder_pricing_free_cta')}
                onClick={handleStartBuildingClick}
                className="!mb-6"
              />
              <div className="space-y-3">
                {renderFeatures(FREE_FEATURES)}
              </div>
            </div>
          </div>

          {/* Starter Plan */}
          <div className={paidCardStyles}>
            <div className="p-4 flex flex-col h-full">
              <text.h3 as="heading" size={0} className="mb-2" text={t('builder_pricing_starter_title')} />
              <text.p size={1} className="mb-2 min-h-8" emphasis="passive" text={t('builder_pricing_starter_desc')} />
              <PlanPriceDisplay planOffer={pricingData?.[SubscriptionPlan.Starter] ?? null} isLoading={isLoading} />
              <Button
                design="primary"
                text={t('builder_pricing_starter_cta')}
                onClick={handleUpgradeClick}
                data-eid={generateClickEID('pricing_section.upgrade_button.starter')}
                disabled={authIsLoading}
                className="!mb-6"
              />
              <div className="space-y-3">
                {renderFeatures(STARTER_FEATURES)}
              </div>
            </div>
          </div>

          {/* Professional Plan */}
          <div className={recommendedPlan === SubscriptionPlan.Professional ? recommendedCardStyles : paidCardStyles}>
            {recommendedPlan === SubscriptionPlan.Professional && (
              <text.span
                as="paragraph"
                className="absolute -top-3 left-1/2 -translate-x-1/2 bg-ring-ai text-intents-ux-boxHighContrast-foregroundColor font-semibold px-4 py-1.5 rounded-full whitespace-nowrap shadow-lg z-10"
                text={t('builder_pricing_recommended')}
              />
            )}
            <div className={`p-4 flex flex-col h-full`}>
              <text.h3 as="heading" size={0} className="mb-2" text={t('builder_pricing_professional_title')} />
              <text.p size={1} className="mb-2 min-h-8" emphasis="passive" text={t('builder_pricing_professional_desc')} />
              <PlanPriceDisplay planOffer={pricingData?.[SubscriptionPlan.Professional] ?? null} isLoading={isLoading} />
              <Button
                design="primary"
                text={t('builder_pricing_free_cta')}
                onClick={handleUpgradeClick}
                data-eid={generateClickEID('pricing_section.upgrade_button.professional')}
                disabled={authIsLoading}
                className="!mb-6"
              />
              <div className="space-y-3">
                {renderFeatures(PROFESSIONAL_FEATURES)}
              </div>
            </div>
          </div>

          {/* Ultimate Plan */}
          <div className={recommendedPlan === SubscriptionPlan.Ultimate ? recommendedCardStyles : paidCardStyles}>
            {recommendedPlan === SubscriptionPlan.Ultimate && (
              <text.span
                as="paragraph"
                className="absolute -top-3 left-1/2 -translate-x-1/2 bg-ring-ai text-intents-ux-boxHighContrast-foregroundColor font-semibold px-4 py-1.5 rounded-full whitespace-nowrap shadow-lg z-10"
                text={t('builder_pricing_recommended')}
              />
            )}
            <div className={`p-4 flex flex-col h-full`}>
              <text.h3 as="heading" size={0} className="mb-2" text={t('builder_pricing_ultimate_title')} />
              <text.p size={1} className="mb-2 min-h-8" emphasis="passive" text={t('builder_pricing_ultimate_desc')} />
              <PlanPriceDisplay planOffer={pricingData?.[SubscriptionPlan.Ultimate] ?? null} isLoading={isLoading} />
              <Button
                design="primary"
                text={t('builder_pricing_free_cta')}
                data-eid={generateClickEID('pricing_section.upgrade_button.ultimate')}
                onClick={handleUpgradeClick}
                disabled={authIsLoading}
                className="!mb-6"
              />
              <div className="space-y-3">
                {renderFeatures(ULTIMATE_FEATURES)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageSection>
    </div>
  )
}
