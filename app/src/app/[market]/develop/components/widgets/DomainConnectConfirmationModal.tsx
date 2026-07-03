'use client';

import { type ReactElement } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

interface DomainConnectConfirmationModalProps {
  isOpen: boolean;
  isConnecting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * "Are you sure you want to connect this domain?" confirmation shown before attaching a custom
 * domain on publish — connecting repoints DNS, so anything currently using the domain stops working.
 * Mirrors the domain-canvas connect confirmation (same i18n keys) for a consistent experience.
 */
export function DomainConnectConfirmationModal({
  isOpen,
  isConnecting,
  onClose,
  onConfirm,
}: DomainConnectConfirmationModalProps): ReactElement | null {
  const t = useTranslations();

  if (!isOpen) return null;

  return (
    <Modal
      title={t('builder_domain_connect_confirmation_title')}
      onClose={() => !isConnecting && onClose()}
      centered
    >
      <Box className='text-center max-w-2xl mx-auto' gap='md' inlineAlignChildren='center'>
        <text.span as='paragraph'>{t('builder_domain_connect_confirmation_description')}</text.span>
        <Box orientation='horizontal' gap='md' className='justify-center'>
          <Button
            design='primary'
            onClick={onConfirm}
            disabled={isConnecting}
            text={isConnecting
              ? t('builder_domain_attach_connecting')
              : t('builder_custom_domain_modal_button_continue')}
            data-eid={generateClickEID('develop.publish.connect_continue')}
            size='sm'
          />
          <Button
            design='secondary'
            onClick={onClose}
            disabled={isConnecting}
            text={t('builder_custom_domain_modal_button_cancel')}
            data-eid={generateClickEID('develop.publish.connect_cancel')}
            size='sm'
          />
        </Box>
      </Box>
    </Modal>
  );
}
