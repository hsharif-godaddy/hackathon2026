import { useQuery } from '@tanstack/react-query'

import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { useActiveStream } from '@/stores/useStreamingConversationStore'

interface NextActionSuggestion {
  text: string
}

export interface NextActionsData {
  suggestions: NextActionSuggestion[]
}

export function useNextActions(appId: string | undefined, enabled: boolean) {
  const activeStream = useActiveStream()
  const isStreamComplete = activeStream?.isComplete ?? true

  return useQuery({
    queryKey: ['next-actions', appId],
    queryFn: async () => {
      if (!appId) throw new Error('No appId')
      const url = await buildDynamicAgentUrl(`apps/${appId}/next-actions`, appId)
      const response = await agentFetch(url, { method: 'POST', siteId: appId })
      if (!response.ok) {
        throw new Error(`Failed to fetch next actions (${response.status})`)
      }
      return response.json() as Promise<NextActionsData>
    },
    enabled: enabled && !!appId && isStreamComplete,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
