'use client'

import { FileText } from 'lucide-react'

import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import KeyValueTable from './KeyValueTable'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

export default function ShowDocToolRenderer({
  toolName: _toolName,
  toolStatus,
  toolId,
  input,
  result,
}: DefaultToolRendererProps): React.ReactElement {
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)

  const path: string | null =
    input && typeof input === 'object' && typeof (input as { path?: unknown }).path === 'string'
      ? (input as { path: string }).path
      : null

  const openDoc = useDevelopPageStore((state) => state.openDoc)
  const hasDetails: boolean = Boolean(input || result)
  const displayName: string = path ? `Showing ${path}` : 'Showing document'

  const handleClick = (): void => {
    if (path) {
      openDoc(path)
    } else {
      setIsModalOpen(true)
    }
  }

  return (
    <div>
      <ToolHeader
        icon={<FileText className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={handleClick}
      />
      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Show Document"
      >
        <div className="flex-1 overflow-y-auto space-y-2">
          {input && typeof input === 'object' && (
            <KeyValueTable data={input as Record<string, unknown>} title="Arguments" />
          )}
          {result && typeof result === 'object' && (
            <KeyValueTable data={result as Record<string, unknown>} title="Result" />
          )}
        </div>
      </ToolModal>
    </div>
  )
}
