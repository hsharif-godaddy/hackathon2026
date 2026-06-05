'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

function curlyQuotes(text: string) {
  return text.replace(/"([^"]*)"/g, '“$1”')
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
    <Modal
      title={curlyQuotes(
        t('builder_projects_delete_modal_title', { appName: projectName }, 'Delete "{appName}"')
      )}
      description={
        <text.p emphasis="passive" size={-1} className="m-0 w-full whitespace-normal break-words text-left">
          {t(
            'builder_projects_delete_modal_body',
            undefined,
            'This project will be permanently deleted and cannot be recovered.'
          )}
        </text.p>
      }
      onClose={onClose}
      focusLock={false}
      portalElem={document.body}
      data-partial="componentAiro"
      className="w-full max-w-[calc(100vw-2rem)] sm:max-w-lg !gap-2 [&_.ux-text-lockup--text]:!w-full [&_.ux-text-lockup--text]:!text-left [&_.ux-text-lockup--title]:!text-left [&_.ux-text-lockup--title]:!whitespace-normal [&_.ux-text-lockup--body]:!mx-0 [&_.ux-text-lockup--body]:!w-full [&_.ux-text-lockup--body]:!text-left [&_.ux-text-lockup--body]:!font-normal [&_.ux-corner-actions]:!hidden"
    >
      <Box
        orientation="horizontal"
        gap="sm"
        className="w-full justify-end"
        data-testid="delete-project-confirmation-modal"
      >
        <Button
          onClick={onClose}
          disabled={isLoading}
          design="secondary"
          size="sm"
          data-partial="componentAiro"
          className="!bg-intents-ux-box-backgroundColor !border !border-intents-ux-boxHighContrast-backgroundColor !text-intents-ux-boxHighContrast-backgroundColor !shadow-none"
          text={t('builder_common_cancel')}
          data-eid={generateClickEID('apps.app.cancel')}
        />
        <Button
          onClick={onConfirm}
          disabled={isLoading}
          design="critical"
          size="sm"
          text={isLoading ? t('builder_common_deleting') : t('builder_common_delete')}
          data-testid="delete-project-confirm-button"
          data-eid={generateClickEID('apps.app.confirm')}
        />
      </Box>
    </Modal>
  )
}
