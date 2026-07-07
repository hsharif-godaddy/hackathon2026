'use client'

import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

interface DomainConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isTransferring: boolean;
  error?: Error | string | null;
  domain: string;
  existingAppName?: string;
  existingAppId: string;
}

export function DomainConflictModal({
  isOpen,
  onClose,
  onConfirm,
  isTransferring,
  error,
  domain,
  existingAppName,
  existingAppId,
}: DomainConflictModalProps) {
  const t = useTranslations();

  if (!isOpen) return null;

  return (
    <Modal
      title={t('builder_domain_conflict_title', {}, 'This domain is already in use')}
      onClose={onClose}
      centered
    >
      <Box className='max-w-2xl mx-auto w-full text-left' gap='md'>
        <text.p>
          {t(
            'builder_domain_conflict_body',
            {
              domain,
              // Show the app name; when it's unnamed the control plane returns the raw app id as
              // `name` (title || app.id), so fall back to the untitled label rather than the id.
              projectName:
                existingAppName?.trim() && existingAppName !== existingAppId
                  ? existingAppName
                  : t('builder_apps_alert_delete_untitled', undefined, 'Untitled'),
            },
            '"{domain}" is currently attached to your project "{projectName}". To use it here, we\'ll need to remove it from that project first.'
          )}
        </text.p>
        {error && (
          <div className="text-intents-ux-text-destructive rounded-lg p-1.5 mt-2 text-sm">
            {error instanceof Error ? error.message : String(error)}
          </div>
        )}
        <Box orientation="horizontal" gap="md" className="w-full justify-end">
          <Button
            design="secondary"
            text={t('builder_common_cancel')}
            onClick={onClose}
            disabled={isTransferring}
            size="sm"
          />
          <Button
            design="primary"
            text={isTransferring
              ? t('builder_domain_conflict_cta_loading', {}, 'Moving…')
              : t('builder_domain_conflict_cta', {}, 'Move Domain')}
            onClick={onConfirm}
            disabled={isTransferring || !!error}
            size="sm"
          />
        </Box>
      </Box>
    </Modal>
  );
}
