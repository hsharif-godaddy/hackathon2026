'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import text from '@ux/text'

import { Automation } from '@/app/[market]/develop/components/automations/types'
import { useTranslations } from '@/hooks/useTranslations'

interface AutomationDeleteModalProps {
  automation: Automation
  onConfirm: () => void
  onCancel: () => void
  isDeleting?: boolean
}

export default function AutomationDeleteModal({ automation, onConfirm, onCancel, isDeleting = false }: AutomationDeleteModalProps) {
  const t = useTranslations()

  return (
    <Modal
      title={t('builder_automations_delete_title', undefined, 'Delete automation?')}
      onClose={onCancel}
      centered
      ariaLabels={{ close: t('builder_common_close', undefined, 'Close') }}
      actionAlignment="end"
      actions={
        <Box orientation="horizontal" gap="md">
          <Button
            design="secondary"
            text={t('builder_common_cancel', undefined, 'Cancel')}
            onClick={onCancel}
            disabled={isDeleting}
          />
          <Button
            design="critical"
            text={isDeleting ? t('builder_common_deleting', undefined, 'Deleting...') : t('builder_common_delete', undefined, 'Delete')}
            onClick={onConfirm}
            disabled={isDeleting}
          />
        </Box>
      }
    >
      <text.p>
        {t('builder_automations_delete_body', undefined, 'This automation will be removed from your automations.')}
      </text.p>
    </Modal>
  )
}
