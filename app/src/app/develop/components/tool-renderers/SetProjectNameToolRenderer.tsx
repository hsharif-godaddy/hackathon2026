'use client'

import { FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { useSitesStore } from '@/stores/useSitesStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import KeyValueTable from './KeyValueTable'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

/**
 * Custom renderer for setProjectName tool
 *
 * Shows "Project name set to {name}" with a file icon.
 * Updates control plane (via updateSite API) and all relevant UI stores when the tool completes.
 */
export default function SetProjectNameToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [hasUpdatedControlPlane, setHasUpdatedControlPlane] = useState(false)
  const params = useParams()
  const router = useRouter()
  const appId = params?.id as string | undefined

  // Extract project name from input
  const projectName = (input && typeof input === 'object' && (input as any).name) || null

  // Update control plane and UI stores when tool completes successfully
  useEffect(
    function updateControlPlaneAndStores() {
      if (
        toolStatus === 'completed' &&
        appId &&
        projectName &&
        !hasUpdatedControlPlane
      ) {
        // Mark as updated to prevent duplicate calls
        setHasUpdatedControlPlane(true)

        logger.info('set-project-name.renderer.updating', {
          appId,
          projectName
        })

        // Update control plane via updateSite API
        appFetch(`/api/sites/${appId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: projectName }),
        }).then(async (response) => {
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error || `Update failed: ${response.status}`)
          }

          logger.info('set-project-name.control-plane.success', {
            appId,
            projectName
          })

          // Update site store (main cache)
          useSiteStore.getState().updateSite(appId, { name: projectName })

          // Update sites list store (used by dropdown)
          useSitesStore.getState().updateSite(appId, { name: projectName })

          // Update develop page store's local site state
          useDevelopPageStore.setState((state) => {
            if (state.site) {
              state.site.name = projectName
            } 
          })

          // Refresh router to update any cached data
          router.refresh()
        }).catch((error) => {
          logger.error('set-project-name.control-plane.error', {
            appId,
            projectName,
            error: error instanceof Error ? error.message : String(error)
          })
        })
      }
    },
    [toolStatus, appId, projectName, t, hasUpdatedControlPlane, router]
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

