'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

interface GitHubDisconnectConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDisconnecting: boolean;
}

export default function GitHubDisconnectConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  isDisconnecting,
}: GitHubDisconnectConfirmationModalProps) {
  const t = useTranslations();

  if (!isOpen) return null;

  return (
    <Modal
      title={t('builder_settings_github_disconnect_confirm_title', undefined, 'Disconnect GitHub?')}
      description={
        <text.p emphasis="passive" size={-1} className="m-0 w-full whitespace-normal break-words text-left">
          {t(
            'builder_settings_github_disconnect_confirm_description',
            undefined,
            'Your GitHub account will be disconnected and sync settings will be removed. You can reconnect at any time.',
          )}
        </text.p>
      }
      onClose={() => {
        if (!isDisconnecting) onClose();
      }}
      focusLock={false}
      portalElem={typeof document !== 'undefined' ? document.body : undefined}
      data-partial="componentAiro"
      className="w-full max-w-[calc(100vw-2rem)] sm:max-w-lg !gap-2 [&_.ux-text-lockup--text]:!w-full [&_.ux-text-lockup--text]:!text-left [&_.ux-text-lockup--title]:!text-left [&_.ux-text-lockup--title]:!whitespace-normal [&_.ux-text-lockup--body]:!mx-0 [&_.ux-text-lockup--body]:!w-full [&_.ux-text-lockup--body]:!text-left [&_.ux-text-lockup--body]:!font-normal [&_.ux-corner-actions_.ux-button]:!border-0 [&_.ux-corner-actions_.ux-button]:!shadow-none"
    >
      <Box
        orientation="horizontal"
        gap="sm"
        className="w-full justify-end"
        data-testid="github-disconnect-confirmation-modal"
      >
        <Button
          onClick={onClose}
          disabled={isDisconnecting}
          design="secondary"
          size="sm"
          data-partial="componentAiro"
          className="!bg-intents-ux-box-backgroundColor !border !border-intents-ux-boxHighContrast-backgroundColor !text-intents-ux-boxHighContrast-backgroundColor !shadow-none"
          text={t('builder_common_cancel')}
          data-eid={generateClickEID('settings.github.disconnect.cancel')}
        />
        <Button
          onClick={onConfirm}
          disabled={isDisconnecting}
          design="critical"
          size="sm"
          text={
            isDisconnecting
              ? t('builder_settings_github_disconnecting', undefined, 'Disconnecting…')
              : t('builder_settings_github_disconnect')
          }
          data-testid="github-disconnect-confirm-btn"
          data-eid={generateClickEID('settings.github.disconnect.confirm')}
        />
      </Box>
    </Modal>
  );
}
