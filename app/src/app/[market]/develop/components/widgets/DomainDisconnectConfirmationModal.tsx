'use client'

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { generateClickEID } from '@/utils/instrumentation';

const DISCONNECT_SUCCESS_ALERT_LIFETIME_MS = 50_000;

interface DomainDisconnectSuccessAlertProps {
  message: string | null;
  onDismiss: () => void;
}

export function DomainDisconnectSuccessAlert({
  message,
  onDismiss,
}: DomainDisconnectSuccessAlertProps) {
  const [mounted, setMounted] = useState(false);
  const chatPaneWidth = useDevelopPageStore((state) => state.chatPaneWidth);
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed);
  const isMobile = useDevelopPageStore((state) => state.isMobile);

  const contentInsetStart = isMobile ? 0 : isChatPaneCollapsed ? 8 : chatPaneWidth + 16;

  useEffect(function mountPortal() {
    setMounted(true);
  }, []);

  useEffect(function autoDismissDisconnectSuccess() {
    if (!message) return;
    const timeoutId = setTimeout(onDismiss, DISCONNECT_SUCCESS_ALERT_LIFETIME_MS);
    return function clearAutoDismiss() {
      clearTimeout(timeoutId);
    };
  }, [message, onDismiss]);

  if (!mounted || !message || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed z-[500] flex justify-end p-4 pointer-events-none"
      style={{
        top: '3.25rem',
        insetInlineStart: `${contentInsetStart}px`,
        insetInlineEnd: 0,
      }}
      aria-live="polite"
    >
      <div className="w-[20rem] max-w-[calc(100%-2rem)] shrink-0">
        <Alert
          id="domain-disconnect-success-toast"
          emphasis="success"
          onClose={onDismiss}
          stretch
          className="pointer-events-auto w-full"
          data-testid="domain-disconnect-success-toast"
        >
          {message}
        </Alert>
      </div>
    </div>,
    document.body
  );
}

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
      className="w-full max-w-[calc(100vw-2rem)] sm:max-w-[680px] !gap-1 [&_.ux-text-lockup--text]:!text-left max-sm:[&_.ux-text-lockup--title]:!text-xl [&_.ux-corner-actions_.ux-button]:!border-0 [&_.ux-corner-actions_.ux-button]:!shadow-none"
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
        <Box orientation="horizontal" gap="sm" className="w-full justify-end">
          <Button
            design="secondary"
            data-partial="componentAiro"
            data-eid={generateClickEID('domain.disconnect.cancel')}
            text={t('builder_domain_disconnect_warning_back', {}, 'No, Go Back')}
            onClick={onClose}
            disabled={isDisconnecting}
            className="!h-5 sm:!h-7 !text-sm sm:!text-base !border-intents-ux-boxHighContrast-backgroundColor !text-intents-ux-boxHighContrast-backgroundColor"
          />
          <Button
            design="primary"
            data-partial="componentAiro"
            data-eid={generateClickEID('domain.disconnect.confirm')}
            text={
              isDisconnecting
                ? t('builder_domain_disconnect_seo_warning_disconnecting', {}, 'Disconnecting…')
                : t('builder_domain_disconnect_warning_confirm', {}, 'Yes, Disconnect')
            }
            onClick={onConfirm}
            disabled={isDisconnecting}
            className="!h-5 sm:!h-7 !text-sm sm:!text-base !bg-intents-ux-boxHighContrast-backgroundColor !text-intents-ux-boxHighContrast-foregroundColor !border-intents-ux-boxHighContrast-backgroundColor"
          />
        </Box>
      </Box>
    </Modal>
  );
}
