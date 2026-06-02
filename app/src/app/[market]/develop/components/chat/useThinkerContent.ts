import { useMemo } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { useActiveRunningToolName, useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { getToolActiveDisplayName } from '@/utils/toolNameMapping'

export interface SubAgentStep {
  toolId: string
  title: string
  detail: string
}

export interface ThinkerContent {
  label: string
  subAgentSteps: SubAgentStep[]
}

interface StructuredToolDetail {
  toolName: string
  path?: string
  command?: string
  slot?: string
  url?: string
  error?: string
}

function formatToolDetail(raw: string): string {
  let parsed: StructuredToolDetail | undefined
  try {
    parsed = JSON.parse(raw) as StructuredToolDetail
  } catch {
    return raw
  }

  const { toolName, path, command, slot, url, error } = parsed

  if (error) return error
  if (toolName === 'media' && slot) return slot
  if (toolName === 'str_replace_based_edit_tool' && path) return path
  if (toolName === 'readFile' && path) return path
  if (toolName === 'directoryListing' && path) return path
  if (toolName === 'showDoc' && path) return path
  if (toolName === 'terminalCommand' && command) return command
  if (toolName === 'websiteScraper' && url) return url
  if (path) return path

  return toolName
}

export function useThinkerContent(): ThinkerContent {
  const t = useTranslations()
  const runningToolName = useActiveRunningToolName()
  const activeLabel = runningToolName ? getToolActiveDisplayName(runningToolName, t) : null
  const label = activeLabel ?? t('builder_agent_thinking')

  const activeStream = useStreamingConversationStore((state) => state.activeStream)
  const subagentEvents = useStreamingConversationStore((state) => state.subagentEvents)

  const subAgentSteps = useMemo((): SubAgentStep[] => {
    const runningTools = activeStream?.toolCalls?.filter(
      (tc) => tc.name === 'runAgent' && tc.status === 'running'
    )
    if (!runningTools?.length) return []

    return runningTools.map((tc) => {
      const title = (tc.input as { title?: string })?.title ?? 'Sub-agent task'
      const events = subagentEvents[tc.id]
      const detail = events?.length ? formatToolDetail(events[events.length - 1]!.detail) : ''
      return { toolId: tc.id, title, detail }
    })
  }, [activeStream?.toolCalls, subagentEvents])

  return { label, subAgentSteps }
}
