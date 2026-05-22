'use client'

import Box from '@ux/box'
import DiamondIcon from '@ux/icon/diamond'
import GraphIcon from '@ux/icon/graph'

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import RUM from '@/app/[market]/develop/components/settings/Analytics/RUM'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { usePublishForDomain } from '@/app/[market]/develop/components/settings/DomainPanel/usePublishForDomain'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { usePaywallModal } from '@/hooks/usePaywallModal'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { isStarterOrAbove, PAYWALL_ITC } from '@/lib/paywall/shared'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { SubscriptionPlan } from '@/types/credits'
import { getPlanFromSubscription } from '@/utils/credits'
import { logClickEvent } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'

/**
 * Analytics panel component for settings view
 *
 * Displays website analytics data including metrics, charts, and tables
 * in a format suitable for the settings panel.
 * Supports multiple time periods with caching and background refresh.
 *
 * @returns Analytics panel component
 */
export default function AnalyticsPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const site = useSiteStore((state) => (appId ? state.getSite(appId) : null))
  const publishedUrl = usePublishedUrl()

  // Feature flag — gate analytics until paid-feature handling is in place
  const isAnalyticsEnabled = useSwitchboard('appbuilder-analytics')

  const {
    data: subscription,
    isError: isSubscriptionError,
    isFetching: isSubscriptionFetching,
    isLoading: isSubscriptionLoading,
    refetch: refetchSubscription,
  } = useSubscription()
  const currentPlan = subscription ? getPlanFromSubscription(subscription) : SubscriptionPlan.None

  const { handlePublish, isPublishDisabled, publishState } = usePublishForDomain(appId, site)

  const { checkAndShowPaywall, paywallModal, isPaywallLoading, isPublishLimitLoading } = usePaywallModal({
    appId: appId ?? undefined,
    source: 'publish',
    itc: PAYWALL_ITC.PUBLISH,
  })

  const handlePublishWithPaywall = async () => {
    await checkAndShowPaywall(async () => {
      await handlePublish()
    })
  }

  if (!isAnalyticsEnabled) {
    return null
  }

  // Site fetch hasn't resolved yet — show spinner
  // We cannot determine which skeleton to show as published state is unknown.
  if (!site) {
    return <SettingsLoadingState fullPage />
  }

  if (isSubscriptionLoading) {
    return <PanelSkeleton panelType={ChatTab.ANALYTICS} hasContent={hasBeenPublished(site)} />
  }

  if (isSubscriptionError && !subscription) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<GraphIcon width={48} height={48} />}
          title={t('builder_common_subscription_error_title')}
          description={t('builder_common_subscription_error_desc')}
          ctaLabel={t('builder_common_retry')}
          onCtaClick={refetchSubscription}
          ctaDisabled={isSubscriptionFetching}
        />
      </Box>
    )
  }

  if (!isStarterOrAbove(currentPlan)) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<GraphIcon width={48} height={48} />}
          title={t('builder_analytics_paywall_title')}
          description={t('builder_analytics_paywall_desc')}
          ctaLabel={t('builder_upgrade_button')}
          onCtaClick={() => {
            logClickEvent('settings.analytics.panel_upgrade')()
            useDevelopPageStore.getState().openUpgradeModal('analytics.panel', PAYWALL_ITC.UPGRADE)
          }}
          ctaIcon={<DiamondIcon />}
        />
      </Box>
    )
  }

  if (!publishedUrl || !hasBeenPublished(site)) {
    return (
      <Box gap="lg" className="@container">
        {paywallModal}
        <EmptyStateCard
          icon={<GraphIcon width={48} height={48} />}
          title={t('builder_analytics_empty_title')}
          description={t('builder_analytics_empty_desc')}
          ctaLabel={publishState.isPublishing ? t('builder_common_publishing') : t('builder_domain_publish_now')}
          onCtaClick={handlePublishWithPaywall}
          ctaDisabled={isPublishDisabled || isPaywallLoading || isPublishLimitLoading}
        />
      </Box>
    )
  }

  return (
    <Box gap="lg" className="@container min-h-full">
      <RUM />
    </Box>
  )
}
