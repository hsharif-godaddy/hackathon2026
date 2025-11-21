'use client'

import { useState, useEffect } from 'react'
import KeyValueTable from './KeyValueTable'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { Bot } from 'lucide-react'

/**
 * Get agent display name from agent ID
 */
function getAgentDisplayName(agentId: string): string {
  const nameMap: Record<string, string> = {
    'api': 'Backend Designer',
    'develop': 'Developer',
    'database': 'Database Designer',
    'color-scheme': 'Color Scheme Designer',
    'colorScheme': 'Color Scheme Designer'
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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Extract target agent from input or result
  let targetAgent = 'Unknown Agent'
  if (input && typeof input === 'object') {
    const inputObj = input as any
    targetAgent = getAgentDisplayName(inputObj.targetAgent || inputObj.target_agent || '')
  }
  if (result && typeof result === 'object') {
    const resultObj = result as any
    if (resultObj.targetAgent) {
      targetAgent = getAgentDisplayName(resultObj.targetAgent)
    }
  }

  const hasDetails = Boolean(input || result)

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={`Handoff to ${targetAgent}`}
      mounted={mounted}
    >
      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Arguments */}
        {input && typeof input === 'object' && (
          <KeyValueTable data={input as Record<string, any>} title="Arguments" />
        )}

        {/* Results */}
        {result && typeof result === 'object' && (
          <KeyValueTable data={result as Record<string, any>} title="Result" />
        )}
      </div>
    </ToolModal>
  )

  const displayName = `Now talking with ${targetAgent}`

  return (
    <div>
      <ToolHeader
        icon={<Bot className="w-4 h-4" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}
