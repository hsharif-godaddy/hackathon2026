import { useQuery } from '@tanstack/react-query'

import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { useActiveStream } from '@/stores/useStreamingConversationStore'

export interface PageInfo {
  slug: string
  title: string
  url: string
  isBuilt: boolean
}

export interface RebuildPagesData {
  sourceUrl: string
  availablePages: PageInfo[]
  totalPages: number
  builtPages: number
}

/**
 * Homepage aliases CMSes serve as a duplicate of `/` (Squarespace/Wix `/home`,
 * legacy `/index`). Best-effort slug heuristic — it won't catch `home-1`,
 * `index.html`, or locale-prefixed variants; proper source-side de-duplication is
 * tracked in AIROBUILD-2255/2257. Shared so the selector renderer and the panel's
 * mount gate agree on what counts as a real unbuilt page.
 */
export const HOMEPAGE_ALIAS_SLUGS = new Set(['home', 'index'])

/** Pages worth offering in the selector: not yet built and not a homepage alias. */
export function unbuiltRebuildPages(pages: PageInfo[]): PageInfo[] {
  return pages.filter(p => !p.isBuilt && !HOMEPAGE_ALIAS_SLUGS.has(p.slug))
}

export function useRebuildPages(appId: string | undefined, hasRebuildSignal: boolean = true) {
  const activeStream = useActiveStream()
  const isStreamComplete = activeStream?.isComplete ?? true

  return useQuery({
    queryKey: ['rebuild-pages', appId],
    queryFn: async () => {
      if (!appId) throw new Error('No appId')
      const url = await buildDynamicAgentUrl(`apps/${appId}/rebuild/pages`, appId)
      const response = await agentFetch(url, { siteId: appId })
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`Failed to fetch rebuild pages (${response.status})`)
      }
      return response.json() as Promise<RebuildPagesData>
    },
    enabled: !!appId && isStreamComplete && hasRebuildSignal,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
