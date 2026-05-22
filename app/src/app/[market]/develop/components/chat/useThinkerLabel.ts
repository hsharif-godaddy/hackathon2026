import { useTranslations } from '@/hooks/useTranslations'
import { useActiveRunningToolName } from '@/stores/useStreamingConversationStore'
import { getToolActiveDisplayName } from '@/utils/toolNameMapping'

export function useThinkerLabel(): string {
  const t = useTranslations()
  const runningToolName = useActiveRunningToolName()
  const activeLabel = runningToolName ? getToolActiveDisplayName(runningToolName, t) : null
  return activeLabel ?? t('builder_agent_thinking')
}
