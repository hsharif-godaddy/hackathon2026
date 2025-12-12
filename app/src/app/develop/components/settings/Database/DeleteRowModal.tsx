'use client'

import Button from '@ux/button';
import Modal from '@ux/modal';
import SiblingSet from '@ux/sibling-set';
import text from '@ux/text';

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
  if (!isOpen) return null;

  return (
    <Modal
      title="Delete Row"
      onClose={onClose}
      centered
      actions={
        <SiblingSet gap="md">
          <Button
            design="secondary"
            text="Cancel"
            onClick={onClose}
            disabled={isDeleting}
          />
          <Button
            design="critical"
            text={isDeleting ? 'Deleting...' : 'Delete'}
            onClick={onConfirm}
            disabled={isDeleting}
          />
        </SiblingSet>
      }
    >
      <text.p>Are you sure you want to delete this row? This action cannot be undone.</text.p>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-lg p-1.5 mt-2 text-sm">
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}
    </Modal>
  );
}

