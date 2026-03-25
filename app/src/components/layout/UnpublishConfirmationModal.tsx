'use client';

import { FormattedMessage } from 'react-intl';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import InfoIcon from '@ux/icon/information';
import Modal from '@ux/modal';
import text from '@ux/text';

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

  return (
    <Modal
      title={t('builder_unpublish_modal_title')}
      onClose={onClose}
      data-partial="componentAiro"
    >
      <Box className="md:max-w-lg" orientation="vertical" gap="lg">
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

      <Box orientation="vertical" gap="sm">
        <text.p>
          <FormattedMessage
            id="builder_unpublish_confirmation_message"
            values={{
              publishedUrl: publishedUrl?.replace(/^https?:\/\//, ''),
              strong: (chunks) => <strong>{chunks}</strong>,
            }}
          />
        </text.p>
        <Box orientation="horizontal" gap="sm" className="bg-ai-light/15 rounded-lg p-3">
          <InfoIcon className="w-3 h-3 flex-shrink-0" />
          <text.p size={-1}>
            <FormattedMessage
              id="builder_unpublish_info"
            />
          </text.p>
        </Box>
          {
            customDomain && (
              <FormattedMessage
                id="builder_unpublish_confirmation_description_with_domain"
              />
            )
          }
      </Box>
        { customDomain ? (
          <Box orientation="vertical" gap="sm">
            <Button
              design="primary"
              data-partial="componentAiro"
              data-eid={generateClickEID('unpublish.buttons.confirm')}
              text={t('builder_unpublish_confirm')}
              onClick={handleConfirm}
              disabled={isLoading}
            />
            <Button
              design="secondary"
              data-partial="componentAiro"
              data-eid={generateClickEID('unpublish.buttons.disconnect_and_unpublish')}
              text={t('builder_unpublish_disconnect_and_unpublish')}
              onClick={handleDisconnectAndUnpublish}
              disabled={isLoading}
            />
          </Box>
        ) : (
          <Box orientation="horizontal" gap="sm">
            <Button
              design="primary"
              data-partial="componentAiro"
              data-eid={generateClickEID('unpublish.buttons.confirm')}
              text={isLoading ? t('builder_unpublish_processing') : t('builder_unpublish_confirm')}
              onClick={handleConfirm}
              disabled={isLoading}
            />
            <Button
              design="secondary"
              data-partial="componentAiro"
              data-eid={generateClickEID('unpublish.buttons.cancel')}
              text={t('builder_unpublish_cancel')}
              onClick={onClose}
              disabled={isLoading}
            />
          </Box>
        )}
      </Box>
    </Modal>
  );
}
