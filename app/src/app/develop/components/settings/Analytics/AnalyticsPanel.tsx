'use client'

import { useMemo } from 'react'
import Box from '@ux/box'
import GraphIcon from '@ux/icon/graph'

import RUM from '@/app/develop/components/settings/Analytics/RUM'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { usePublishForDomain } from '@/app/develop/components/settings/DomainPanel/usePublishForDomain'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
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
  const appId = useAppIdFromParams()
  const site = useSiteStore((state) => appId ? state.getSite(appId) : null)

  // Get published URL from site store with priority:
  // 1. Custom domain (domainType !== 'prefix')
  // 2. Prefix domain (domainType === 'prefix')
  // 3. Published URL from site.published_url
  const publishedUrl = useMemo(() => {
    if (!hasBeenPublished(site)) {
      return null
    }

    const customDomain = site?.domains?.find(d => d.domainType && d.domainType !== 'prefix' && d.status === 'active')
    const prefixDomain = site?.domains?.find(d => d.domainType === 'prefix' && d.status === 'active')
    const publishedFqdn = site?.published_url

    if (customDomain?.fqdn) {
      return customDomain.fqdn.startsWith('https://') ? customDomain.fqdn : `https://${customDomain.fqdn}`
    }
    if (prefixDomain?.fqdn) {
      return prefixDomain.fqdn.startsWith('https://') ? prefixDomain.fqdn : `https://${prefixDomain.fqdn}`
    }
    return publishedFqdn || null
  }, [site])

  // Publish hook for empty state
  const { handlePublish, isPublishDisabled, publishState } = usePublishForDomain(appId, site)

  // Show empty state if site hasn't been published yet
  if (!publishedUrl || !hasBeenPublished(site)) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<GraphIcon width={48} height={48} />}
          title="Publish Your App to View Analytics"
          description="Analytics are only available for published websites. Please publish your app to view analytics data."
          ctaLabel={publishState.isPublishing ? "Publishing..." : "Publish Now"}
          onCtaClick={handlePublish}
          ctaDisabled={isPublishDisabled}
        />
      </Box>
    )
  }

  return (
    <Box gap="lg" className="@container">
      <RUM />
    </Box>
  )
}