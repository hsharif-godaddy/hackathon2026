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
