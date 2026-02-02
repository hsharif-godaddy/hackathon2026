'use client'

import { FileText } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import KeyValueTable from './KeyValueTable'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

/**
 * Custom renderer for setProjectName tool
 *
 * Shows "Project name set to {name}" with a file icon.
 * 
 * IMPORTANT: This is a display-only component for historical tool results.
 * The actual control plane update happens in ToolResultHandler when the tool
 * first completes. Re-applying updates here would overwrite manual renames.
 */
export default function SetProjectNameToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)
  const params = useParams()
  const appId = params?.id as string | undefined

  // Extract project name from input
  const projectName = (input && typeof input === 'object' && (input as any).name) || null

  // DON'T update control plane when re-rendering historical tool results!
  // This tool renderer is purely for display when viewing conversation history.
  // The actual name update happens server-side when the tool first executes.
  // Re-applying it here would overwrite any manual renames the user made.
  useEffect(
    function logToolRendering() {
      if (toolStatus === 'completed' && appId && projectName) {
        logger.info('set-project-name.renderer.display-only', {
          appId,
          projectName,
          message: 'Rendering historical setProjectName tool result (display only, no updates)'
        })
      }
    },
    [toolStatus, appId, projectName]
  )

  const hasDetails = Boolean(input || result)

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={t('builder_tools_setprojectname_title', undefined, 'Set Project Name')}
    >
      <div className="flex-1 overflow-y-auto space-y-2">
        {/* Arguments */}
        {input && typeof input === 'object' && (
          <KeyValueTable data={input as Record<string, any>} title={t('builder_tools_default_arguments', undefined, 'Arguments')} />
        )}

        {/* Results */}
        {result && typeof result === 'object' && (
          <KeyValueTable data={result as Record<string, any>} title={t('builder_tools_default_result', undefined, 'Result')} />
        )}
      </div>
    </ToolModal>
  )

  const displayName = projectName 
    ? t('builder_tools_setprojectname_display', { name: projectName }, `Project name: ${projectName}`)
    : t('builder_tools_setprojectname_unknown', undefined, 'Unknown project name')

  return (
    <div>
      <ToolHeader
        icon={<FileText className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}

