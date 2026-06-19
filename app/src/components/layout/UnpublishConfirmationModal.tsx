'use client';

import { FormattedMessage } from 'react-intl';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import InfoIcon from '@ux/icon/information';
import text from '@ux/text';

import ProjectsActionModal, {
  ProjectsActionModalFooter,
} from '@/app/[market]/projects/components/ProjectsActionModal';
import { useTranslations } from '@/hooks/useTranslations';
import { getRootDomain } from '@/utils/getRootDomain';
import { generateClickEID } from '@/utils/instrumentation';

interface UnpublishConfirmationModalProps {
  appName: string;
  customDomain?: string | null;
  publishedUrl: string | null;
  onClose: () => void;
  onConfirm: (disconnectDomain: boolean) => void;
  isLoading: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export default function UnpublishConfirmationModal({
  publishedUrl,
  customDomain,
  onClose,
  onConfirm,
  isLoading,
  error,
  onRetry,
}: UnpublishConfirmationModalProps) {
  const t = useTranslations();
  const rootDomain = getRootDomain() || 'godaddy.com';
  const contactSupportUrl = `https://www.${rootDomain}/help/contact_us`;

  const handleConfirm = () => {
    onConfirm(false);
  };

  const handleDisconnectAndUnpublish = () => {
    onConfirm(true);
  };

  const footer = customDomain ? (
    <Box orientation="vertical" gap="sm" className="w-full">
      <Button
        design="primary"
        data-partial="componentAiro"
        data-eid={generateClickEID('unpublish.buttons.confirm')}
        text={t('builder_unpublish_confirm')}
        onClick={handleConfirm}
        disabled={isLoading}
        className="w-full md:w-auto"
      />
      <Button
        design="secondary"
        data-partial="componentAiro"
        data-eid={generateClickEID('unpublish.buttons.disconnect_and_unpublish')}
        text={t('builder_unpublish_disconnect_and_unpublish')}
        onClick={handleDisconnectAndUnpublish}
        disabled={isLoading}
        className="w-full md:w-auto"
      />
      <Button
        design="secondary"
        data-partial="componentAiro"
        data-eid={generateClickEID('unpublish.buttons.cancel')}
        text={t('builder_unpublish_cancel')}
        onClick={onClose}
        disabled={isLoading}
        className="w-full md:w-auto"
      />
    </Box>
  ) : (
    <ProjectsActionModalFooter
      onCancel={onClose}
      cancelText={t('builder_unpublish_cancel')}
      onConfirm={handleConfirm}
      confirmText={isLoading ? t('builder_unpublish_processing') : t('builder_unpublish_confirm')}
      isLoading={isLoading}
      cancelEid={generateClickEID('unpublish.buttons.cancel')}
      confirmEid={generateClickEID('unpublish.buttons.confirm')}
    />
  );

  const confirmationMessage = (
    <FormattedMessage
      id="builder_unpublish_confirmation_message"
      values={{
        publishedUrl: publishedUrl?.replace(/^https?:\/\//, ''),
        strong: (chunks) => <strong>{chunks}</strong>,
      }}
    />
  )

  return (
    <ProjectsActionModal
      title={t('builder_unpublish_modal_title')}
      description={confirmationMessage}
      onClose={onClose}
      footer={footer}
      testId="unpublish-confirmation-modal"
    >
      <Box orientation="vertical" gap="sm" className="w-full text-left md:max-w-lg">
        {error && (
          <Alert
            emphasis="critical"
            actions={
              <Box orientation="horizontal" gap="sm">
                {onRetry && (
                  <Button
                    design="primary"
                    size="sm"
                    data-partial="componentAiro"
                    data-eid={generateClickEID('unpublish.buttons.retry')}
                    text={t('builder_unpublish_retry')}
                    onClick={onRetry}
                    disabled={isLoading}
                  />
                )}
                <Button
                  design="secondary"
                  size="sm"
                  data-partial="componentAiro"
                  data-eid={generateClickEID('unpublish.buttons.contact_support')}
                  text={t('builder_unpublish_contact_support')}
                  onClick={() => window.open(contactSupportUrl, '_blank')}
                />
              </Box>
            }
          >
            {t('builder_unpublish_error')}
          </Alert>
        )}

        <Box
          orientation="horizontal"
          gap="sm"
          className="items-start rounded-lg bg-ai-light/15 p-3 text-left"
        >
          <InfoIcon className="mt-0.5 h-3 w-3 shrink-0" />
          <text.p size={-1} className="m-0 text-left">
            <FormattedMessage id="builder_unpublish_info" />
          </text.p>
        </Box>
        {customDomain && (
          <text.p className="m-0 text-left">
            <FormattedMessage id="builder_unpublish_confirmation_description_with_domain" />
          </text.p>
        )}
      </Box>
    </ProjectsActionModal>
  );
}
