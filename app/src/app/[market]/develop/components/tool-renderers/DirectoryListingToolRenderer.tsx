'use client'

import { File } from 'lucide-react'

import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

export default function DirectoryListingToolRenderer({
  toolStatus,
  toolId,
  input,
  result,
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)

  const path = (input && typeof input === 'object' && (input as Record<string, unknown>).path) as string | undefined
  const displayName = path ? `Listed ${path}` : 'Directory listing'
  const resultText = typeof result === 'string' ? result : null
  const hasDetails = Boolean(resultText)

  return (
    <div>
      <ToolHeader
        icon={<File className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={displayName}
      >
        <div className="flex-1 overflow-y-auto">
          {resultText && (
            <pre className="text-xs whitespace-pre-wrap p-3 rounded bg-muted font-mono">{resultText}</pre>
          )}
        </div>
      </ToolModal>
    </div>
  )
}
