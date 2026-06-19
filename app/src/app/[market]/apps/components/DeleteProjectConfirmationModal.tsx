'use client'

import ProjectsActionModal, {
  ProjectsActionModalFooter,
} from '@/app/[market]/projects/components/ProjectsActionModal'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

function curlyQuotes(text: string) {
  return text.replace(/"([^"]*)"/g, '"$1"')
}

interface DeleteProjectConfirmationModalProps {
  projectName: string
  onClose: () => void
  onConfirm: () => void
  isLoading: boolean
}

export default function DeleteProjectConfirmationModal({
  projectName,
  onClose,
  onConfirm,
  isLoading,
}: DeleteProjectConfirmationModalProps) {
  const t = useTranslations()

  return (
    <ProjectsActionModal
      title={curlyQuotes(
        t('builder_projects_delete_modal_title', { appName: projectName }, 'Delete "{appName}"')
      )}
      description={t('builder_projects_delete_modal_body')}
      onClose={onClose}
      testId="delete-project-confirmation-modal"
      footer={
        <ProjectsActionModalFooter
          onCancel={onClose}
          cancelText={t('builder_common_cancel')}
          onConfirm={onConfirm}
          confirmText={
            isLoading ? t('builder_common_deleting') : t('builder_common_delete')
          }
          confirmDesign="critical"
          isLoading={isLoading}
          cancelEid={generateClickEID('apps.app.cancel')}
          confirmEid={generateClickEID('apps.app.confirm')}
          confirmTestId="delete-project-confirm-button"
        />
      }
    />
  )
}
