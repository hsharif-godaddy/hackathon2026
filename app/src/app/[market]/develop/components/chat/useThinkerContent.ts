import { useMemo } from 'react'

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { deriveSubAgentLifecycle } from '@/utils/subagentStatus'
import { useThinkerLabel } from './useThinkerLabel'

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
  const label = useThinkerLabel()

  const activeStream = useStreamingConversationStore((state) => state.activeStream)
  const subagentEvents = useStreamingConversationStore((state) => state.subagentEvents)

  const subAgentSteps = useMemo((): SubAgentStep[] => {
    // A runAgent tool call completes the instant its dispatch is acked, but the
    // sub-agent keeps running detached. Derive "still running" from the event
    // stream, not the tool call's own status, so the timeline reflects sub-agents
    // that are actually in flight.
    const runningTools = activeStream?.toolCalls?.filter((tc) => {
      if (tc.name !== 'runAgent') return false
      const events = subagentEvents[tc.id] ?? []
      return deriveSubAgentLifecycle(events, tc.status) === 'running'
    })
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
