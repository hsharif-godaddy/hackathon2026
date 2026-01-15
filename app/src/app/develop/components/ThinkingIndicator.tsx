'use client'

import { useTranslations } from '@/hooks/useTranslations'
import { useCurrentAgentName } from '@/stores/useStreamingConversationStore'

// Map agent names for consistency with existing UI conventions
// "AI Developer" -> "Airo Developer" to match branding across the app
// Other agents use their actual agent name
const AGENT_NAME_MAP: Record<string, string> = {
  'AI Developer': 'Airo Developer'
}

/**
 * Thinking indicator component for active streams
 *
 * Displays a subtle "{Agent Name} is thinking" message with animated dots
 * to indicate that the system is processing but hasn't produced content yet.
 *
 * @returns React element for the thinking indicator
 */
export default function ThinkingIndicator() {
  const t = useTranslations()
  const currentAgentName = useCurrentAgentName()

  const rawAgentName = currentAgentName || t('builder_default_agent_name')
  const agentName = AGENT_NAME_MAP[rawAgentName] || rawAgentName

  return (
    <div className="flex items-center gap-2 text-sm mt-2">
      <div className="bg-ai-light/40 rounded-sm px-1 py-0.5">
        {t('builder_agent_thinking', { agentName })}
      </div>
      <div className="flex space-x-0.5">
        <div className="w-1 h-1 bg-ai-light rounded-full animate-bounce"></div>
        <div className="w-1 h-1 bg-ai rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
        <div className="w-1 h-1 bg-ai-dark rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
      </div>
    </div>
  )
}

