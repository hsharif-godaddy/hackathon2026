'use client'

import { Bot } from 'lucide-react'
import { useState } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import KeyValueTable from './KeyValueTable'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

/**
 * Get agent display name from agent ID
 */
function getAgentDisplayName(agentId: string, t: (key: string) => string): string {
  const nameMap: Record<string, string> = {
    'api': t('builder_tools_handoff_display_api'),
    'develop': t('builder_tools_handoff_display_develop'),
    'database':  t('builder_tools_handoff_display_database'),
    'color-scheme': t('builder_tools_handoff_display_color'),
    'colorScheme': t('builder_tools_handoff_display_color'),
    'marketing':  t('builder_tools_handoff_display_marketing')
  }
  return nameMap[agentId] || agentId
}

/**
 * Custom renderer for handoff tool
 *
 * Shows "Now talking with {Agent Name}" with a robot icon.
 * Clickable to show modal with handoff details (arguments and results).
 */
export default function HandoffToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Extract target agent from input or result
  let targetAgent = t('builder_tools_handoff_display_unknown')
  if (input && typeof input === 'object') {
    const inputObj = input as any
    targetAgent = getAgentDisplayName(inputObj.targetAgent || inputObj.target_agent || '', t)
  }
  if (result && typeof result === 'object') {
    const resultObj = result as any
    if (resultObj.targetAgent) {
      targetAgent = getAgentDisplayName(resultObj.targetAgent, t)
    }
  }

  const hasDetails = Boolean(input || result)

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={t('builder_tools_handoff_to', {targetAgent})}
    >
      <div className="flex-1 overflow-y-auto space-y-2">
        {/* Arguments */}
        {input && typeof input === 'object' && (
          <KeyValueTable data={input as Record<string, any>} title={t('builder_tools_default_arguments')} />
        )}

        {/* Results */}
        {result && typeof result === 'object' && (
          <KeyValueTable data={result as Record<string, any>} title={t('builder_tools_default_result')} />
        )}
      </div>
    </ToolModal>
  )

  const displayName = t('builder_tools_handoff_talking_with', {targetAgent})

  return (
    <div>
      <ToolHeader
        icon={<Bot className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}
