'use client'

import Button from '@ux/button';
import Modal from '@ux/modal';
import SiblingSet from '@ux/sibling-set';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

interface DeleteRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  error?: Error | string | null;
}

/**
 * Modal dialog for confirming row deletion
 *
 * Displays a confirmation dialog when user attempts to delete a database row,
 * with options to cancel or proceed with the deletion.
 */
export function DeleteRowModal({ isOpen, onClose, onConfirm, isDeleting, error }: DeleteRowModalProps) {
  const t = useTranslations();

  if (!isOpen) return null;

  return (
    <Modal
      title={t('builder_settings_database_delete_row_title')}
      onClose={onClose}
      centered
      actions={
        <SiblingSet gap="md">
          <Button
            design="secondary"
            text={t('builder_common_cancel')}
            onClick={onClose}
            disabled={isDeleting}
          />
          <Button
            design="critical"
            text={isDeleting ? t('builder_common_deleting') : t('builder_common_delete')}
            onClick={onConfirm}
            disabled={isDeleting}
          />
        </SiblingSet>
      }
    >
      <text.p>{t('builder_settings_database_delete_row_warning')}</text.p>
      {error && (
        <div className="bg-destructive/10 text-destructive rounded-lg p-1.5 mt-2 text-sm">
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}
    </Modal>
  );
}

