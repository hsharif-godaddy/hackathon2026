'use client'

import Box from '@ux/box'
import GraphIcon from '@ux/icon/graph'

import RUM from '@/app/[market]/develop/components/settings/Analytics/RUM'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { usePublishForDomain } from '@/app/[market]/develop/components/settings/DomainPanel/usePublishForDomain'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { usePaywallModal } from '@/hooks/usePaywallModal'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { useSiteStore } from '@/stores/useSiteStore'
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
  const { data: isAnalyticsEnabled, isLoading: isAnalyticsFlagLoading } = useSwitchboard('appbuilder-analytics')

  const { handlePublish, isPublishDisabled, publishState } = usePublishForDomain(appId, site)

  const { checkAndShowPaywall, PaywallModal, isPaywallLoading, isPublishLimitLoading } = usePaywallModal({
    appId: appId ?? undefined,
    source: 'publish',
    itc: PAYWALL_ITC.PUBLISH,
  })

  const handlePublishWithPaywall = async () => {
    await checkAndShowPaywall(async () => {
      await handlePublish()
    })
  }

  if (isAnalyticsFlagLoading || !isAnalyticsEnabled) {
    return null
  }

  // Site fetch hasn't resolved yet — show spinner
  // We cannot determine which skeleton to show as published state is unknown.
  if (!site) {
    return <SettingsLoadingState fullPage />
  }

  if (!publishedUrl || !hasBeenPublished(site)) {
    return (
      <Box gap="lg" className="@container">
        <PaywallModal />
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
