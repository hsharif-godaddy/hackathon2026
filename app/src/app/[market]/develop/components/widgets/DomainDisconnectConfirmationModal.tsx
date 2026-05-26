'use client'

import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

interface DomainDisconnectConfirmationModalProps {
  isOpen: boolean;
  domain: string;
  fallbackUrl: string;
  onClose: () => void;
  onConfirm: () => void;
  isDisconnecting: boolean;
}

export function DomainDisconnectConfirmationModal({
  isOpen,
  domain,
  fallbackUrl,
  onClose,
  onConfirm,
  isDisconnecting,
}: DomainDisconnectConfirmationModalProps) {
  const t = useTranslations();

  if (!isOpen) return null;

  return (
    <Modal
      title={t(
        'builder_domain_disconnect_warning_title',
        {},
        'What happens when you disconnect a domain from your app'
      )}
      onClose={onClose}
      className="max-w-[680px] w-full !gap-1 [&_.ux-text-lockup--text]:!text-left [&_.ux-corner-actions_.ux-button]:!border-0 [&_.ux-corner-actions_.ux-button]:!shadow-none"
      data-partial="componentAiro"
    >
      <Box className="text-left" orientation="vertical">
        <text.p size={-1} className="mb-5">
          {t(
            'builder_domain_disconnect_warning_subtitle',
            { fallbackUrl },
            'After disconnecting, your site will still be live at {fallbackUrl}. However:'
          )}
        </text.p>
        <ul className="list-disc pl-2 space-y-1 mb-5">
          <li>
            <text.p size={-1}>
              {t(
                'builder_domain_disconnect_warning_bullet_search',
                { domain },
                'Links, search results, and social posts that use {domain} may stop working or show outdated previews'
              )}
            </text.p>
          </li>
          <li>
            <text.p size={-1}>
              {t(
                'builder_domain_disconnect_warning_bullet_seo',
                { domain },
                'SEO settings will still point to {domain} until you update them and republish'
              )}
            </text.p>
          </li>
          <li>
            <text.p size={-1}>
              {t(
                'builder_domain_disconnect_warning_bullet_redirect',
                { domain },
                "We don't automatically redirect visitors from {domain} to your new address"
              )}
            </text.p>
          </li>
        </ul>
        <Box orientation="horizontal" gap="md" className="w-full justify-end">
          <Button
            design="secondary"
            data-partial="componentAiro"
            data-eid={generateClickEID('domain.disconnect.buttons.cancel')}
            text={t('builder_domain_disconnect_warning_back', {}, 'No, Go Back')}
            onClick={onClose}
            disabled={isDisconnecting}
            className="!h-7 !border-intents-ux-boxHighContrast-backgroundColor !text-intents-ux-boxHighContrast-backgroundColor"
          />
          <Button
            design="primary"
            data-partial="componentAiro"
            data-eid={generateClickEID('domain.disconnect.buttons.confirm')}
            text={
              isDisconnecting
                ? t('builder_domain_disconnect_seo_warning_disconnecting', {}, 'Disconnecting…')
                : t('builder_domain_disconnect_warning_confirm', {}, 'Yes, Disconnect')
            }
            onClick={onConfirm}
            disabled={isDisconnecting}
            className="!h-7 !bg-intents-ux-boxHighContrast-backgroundColor !text-intents-ux-boxHighContrast-foregroundColor !border-intents-ux-boxHighContrast-backgroundColor"
          />
        </Box>
      </Box>
    </Modal>
  );
}
