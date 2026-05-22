'use client'

import { Palette } from 'lucide-react'

import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import KeyValueTable from './KeyValueTable'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

export default function DesignSystemToolRenderer({
  toolName,
  toolStatus,
  toolId,
  input,
  result,
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)

  let displayName: string
  let modalTitle: string

  if (toolName === 'installDesignSystem') {
    const slug = (input && typeof input === 'object' && (input as Record<string, unknown>).slug) as string | undefined
    displayName = slug ? `Installed design system: ${slug}` : 'Installing design system…'
    modalTitle = 'Install Design System'
  } else if (toolName === 'loadUiKit') {
    displayName = 'Loaded design system reference'
    modalTitle = 'Load Design System'
  } else {
    displayName = 'Design system catalog loaded'
    modalTitle = 'Design System Catalog'
  }

  const resultText = typeof result === 'string' ? result : null
  const hasDetails = Boolean(input || result)

  return (
    <div>
      <ToolHeader
        icon={<Palette className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={modalTitle}
      >
        <div className="flex-1 overflow-y-auto space-y-2">
          {input && typeof input === 'object' && (
            <KeyValueTable data={input as Record<string, unknown>} title="Arguments" />
          )}
          {resultText && (
            <MarkdownRenderer content={resultText} className="text-sm" />
          )}
          {result && typeof result === 'object' && (
            <KeyValueTable data={result as Record<string, unknown>} title="Result" />
          )}
        </div>
      </ToolModal>
    </div>
  )
}
