'use client'

import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useCloseOnReauth } from '@/hooks/useCloseOnReauth';
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
  useCloseOnReauth(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <Modal
      title={t('builder_domain_conflict_title', {}, 'This domain is already in use')}
      onClose={onClose}
      centered
    >
      <Box className='text-center max-w-2xl mx-auto' gap='md' inlineAlignChildren='center'>
        <text.p>
          {t(
            'builder_domain_conflict_body',
            { domain, projectName: existingAppName || existingAppId },
            '"{domain}" is currently attached to your project "{projectName}." To use it here, we\'ll need to remove it from that project first.'
          )}
        </text.p>
        {error && (
          <div className="text-intents-ux-text-destructive rounded-lg p-1.5 mt-2 text-sm">
            {error instanceof Error ? error.message : String(error)}
          </div>
        )}
        <Box orientation="horizontal" gap="md" className="justify-center">
          <Button
            design="primary"
            text={isTransferring
              ? t('builder_domain_conflict_cta_loading', {}, 'Moving…')
              : t('builder_domain_conflict_cta', {}, 'Move Domain')}
            onClick={onConfirm}
            disabled={isTransferring || !!error}
            size="sm"
          />
          <Button
            design="secondary"
            text={t('builder_common_cancel')}
            onClick={onClose}
            disabled={isTransferring}
            size="sm"
          />
        </Box>
      </Box>
    </Modal>
  );
}
