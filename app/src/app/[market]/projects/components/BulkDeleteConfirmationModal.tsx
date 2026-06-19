'use client'

import text from '@ux/text'

import ProjectsActionModal, {
  ProjectsActionModalFooter,
} from '@/app/[market]/projects/components/ProjectsActionModal'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

interface BulkDeleteConfirmationModalProps {
  projectNames: string[]
  onClose: () => void
  onConfirm: () => void
  isLoading: boolean
}

export default function BulkDeleteConfirmationModal({
  projectNames,
  onClose,
  onConfirm,
  isLoading,
}: BulkDeleteConfirmationModalProps) {
  const t = useTranslations()

  return (
    <ProjectsActionModal
      title={t('builder_projects_bulk_delete_title')}
      description={t('builder_projects_bulk_delete_body')}
      onClose={onClose}
      testId="bulk-delete-confirmation-modal"
      footer={
        <ProjectsActionModalFooter
          onCancel={onClose}
          cancelText={t('builder_common_cancel')}
          onConfirm={onConfirm}
          confirmText={
            isLoading
              ? t('builder_common_deleting')
              : t('builder_common_delete')
          }
          confirmDesign="critical"
          isLoading={isLoading}
          cancelEid={generateClickEID('projects.selection.cancel')}
          confirmEid={generateClickEID('projects.selection.delete')}
          confirmTestId="bulk-delete-confirm-button"
        />
      }
    >
      <ol className="m-0 list-inside list-decimal space-y-1 pl-0 text-left">
        {projectNames.map((name, index) => (
          <li key={`${name}-${index}`}>
            <text.span size={-1}>{name}</text.span>
          </li>
        ))}
      </ol>
    </ProjectsActionModal>
  )
}
