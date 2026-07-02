import { useTranslations } from '@/hooks/useTranslations'
import { useActiveAwaitAgentsCount, useActiveRunningToolName, useInterimStatus } from '@/stores/useStreamingConversationStore'
import { getToolActiveDisplayName } from '@/utils/toolNameMapping'

export function useThinkerLabel(): string {
  const t = useTranslations()
  const runningToolName = useActiveRunningToolName()
  const awaitCount = useActiveAwaitAgentsCount()
  const interimStatus = useInterimStatus()

  // awaitAgents blocks while sub-agent jobs finish — surface a count-aware
  // "Waiting for N task(s) to finish" instead of the generic thinking label.
  if (runningToolName === 'awaitAgents') {
    return t(
      'builder_tools_active_await_agents',
      { count: awaitCount },
      'Waiting for {count, plural, one {# task} other {# tasks}} to finish',
    )
  }

  // A running tool's own label wins; otherwise a server-narrated interim status
  // (design-kit gathering pause) overrides the generic "Thinking…" default.
  const activeLabel = runningToolName ? getToolActiveDisplayName(runningToolName, t) : null
  return activeLabel ?? interimStatus ?? t('builder_agent_thinking')
}
