'use client'

import { useMemo } from 'react'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useSiteStore } from '@/stores/useSiteStore'
import { resolveSiteFqdn } from '@/utils/domain'
import { hasBeenPublished } from '@/utils/site'

/**
 * Published URL for analytics (page views, visitors, total clicks, click types).
 *
 * Uses `resolveSiteFqdn` for domain resolution (custom domain > prefix domain >
 * published_url). Returns null when the site hasn't been published or when the
 * resolved URL is localhost (no analytics data available locally).
 *
 * @returns Published URL or null if site not published
 */
export function usePublishedUrl(): string | null {
  const appId = useAppIdFromParams()
  const site = useSiteStore((state) => (appId ? state.getSite(appId) : null))

  return useMemo(() => {
    if (!hasBeenPublished(site)) {
      return null
    }

    const url = resolveSiteFqdn(site) || null

    // Localhost has no analytics data — return null so queries are skipped
    if (url) {
      try {
        const parsed = new URL(url)
        if (parsed.hostname === 'localhost') {
          return null
        }
      } catch {
        if (url === 'localhost' || url.startsWith('localhost:')) {
          return null
        }
      }
    }

    return url
  }, [site])
}
