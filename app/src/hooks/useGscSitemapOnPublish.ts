'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { socialV2Client } from '@/lib/social'
import { gscClient } from '@/lib/social-gsc'
import { useSiteStore } from '@/stores/useSiteStore'
import type { GoogleSearchConsoleConnection, SiteAssociation } from '@/types/social'
import { SocialPlatformKey } from '@/types/social'
import { resolveSiteFqdn } from '@/utils/domain'

const FIVE_MINUTES = 5 * 60 * 1000

export function useGscSitemapOnPublish(appId: string | null, enabled: boolean): void {
  const queryClient = useQueryClient()
  const getSite = useSiteStore((state) => state.getSite)

  useEffect(() => {
    if (!appId || !enabled) return

    const handlePublishSnapshot = (event: Event): void => {
      const detail = (event as CustomEvent).detail as { appId?: string } | undefined
      if (!detail || detail.appId !== appId) return

      void (async () => {
        try {
          const associationsData = await queryClient.fetchQuery<{ associations: SiteAssociation[] }>({
            queryKey: ['site-associations', appId],
            queryFn: async () => {
              const apiUrl = await buildDynamicApiUrl('social/associations', appId)
              const response = await agentFetch(apiUrl, { siteId: appId, method: 'GET' })
              if (!response.ok) throw new Error(`Failed to fetch site associations: ${response.status}`)
              return response.json() as Promise<{ associations: SiteAssociation[] }>
            },
            staleTime: FIVE_MINUTES,
          })

          const gscAssociation = associationsData?.associations?.find(
            (a) => a.platform === SocialPlatformKey.GOOGLE_SEARCH_CONSOLE
          )
          if (!gscAssociation) return

          const connections = await queryClient.fetchQuery<GoogleSearchConsoleConnection[]>({
            queryKey: ['social-connections'],
            queryFn: () => socialV2Client.getSocialConnections() as Promise<GoogleSearchConsoleConnection[]>,
            staleTime: FIVE_MINUTES,
          })

          const gscConnection = connections?.find(
            (c): c is GoogleSearchConsoleConnection => c.socialId === gscAssociation.socialId
          )
          const userTokenId = gscConnection?.userTokenId
          if (!userTokenId) return

          const site = getSite(appId)
          const publishedUrl = resolveSiteFqdn(site)
          if (!publishedUrl) return

          logger.info('gsc.sitemap-submit.publish-triggered', { appId, publishedUrl })

          await gscClient.submitGscSitemap(publishedUrl, userTokenId)
          logger.info('gsc.sitemap-submit.success', { appId, publishedUrl })
        } catch (err: unknown) {
          logger.warn('gsc.sitemap-submit.error', {
            appId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })()
    }

    window.addEventListener('publish-snapshot-request', handlePublishSnapshot)
    return () => window.removeEventListener('publish-snapshot-request', handlePublishSnapshot)
  }, [appId, enabled, queryClient, getSite])
}
