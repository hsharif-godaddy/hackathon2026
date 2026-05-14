'use client'

import { FileCode } from 'lucide-react'

import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/[market]/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'
import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

function getDiagnostics(result: DefaultToolRendererProps['result']): string {
  if (typeof result === 'string') return result
  if (result && typeof result.diagnostics === 'string') return result.diagnostics
  return result ? JSON.stringify(result, null, 2) : ''
}

export default function ValidateCodeToolRenderer({
  toolStatus,
  toolId,
  result,
  error
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)
  const displayName = toolStatus === 'running'
    ? t('builder_tools_validate_code_running', undefined, 'Validating Code')
    : t('builder_tools_validate_code_title', undefined, 'Validate Code')
  const hasDetails = Boolean(result || error)

  return (
    <div>
      <ToolHeader
        icon={<FileCode className="w-2 h-2" />}
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
        <div className="flex-1 overflow-y-auto space-y-2">
          {result && !error && (
            <div className="bg-muted p-1.5 rounded border border-border max-h-48 overflow-y-auto">
              <MarkdownRenderer
                content={getDiagnostics(result)}
                className="text-sm leading-relaxed break-words"
              />
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 p-1.5 rounded">
              <pre className="text-xs whitespace-pre-wrap font-mono text-destructive-foreground">
                {error}
              </pre>
            </div>
          )}
        </div>
      </ToolModal>
    </div>
  )
}
