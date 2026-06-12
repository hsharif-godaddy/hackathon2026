import { useTranslations } from '@/hooks/useTranslations'
import { useActiveAwaitAgentsCount, useActiveRunningToolName } from '@/stores/useStreamingConversationStore'
import { getToolActiveDisplayName } from '@/utils/toolNameMapping'

export function useThinkerLabel(): string {
  const t = useTranslations()
  const runningToolName = useActiveRunningToolName()
  const awaitCount = useActiveAwaitAgentsCount()

  // awaitAgents blocks while sub-agent jobs finish — surface a count-aware
  // "Waiting for N task(s) to finish" instead of the generic thinking label.
  if (runningToolName === 'awaitAgents') {
    return t(
      'builder_tools_active_await_agents',
      { count: awaitCount },
      'Waiting for {count, plural, one {# task} other {# tasks}} to finish',
    )
  }

  const activeLabel = runningToolName ? getToolActiveDisplayName(runningToolName, t) : null
  return activeLabel ?? t('builder_agent_thinking')
}
