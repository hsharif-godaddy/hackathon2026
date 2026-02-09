'use client';

import { FormattedMessage } from 'react-intl';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import InfoIcon from '@ux/icon/information';
import XIcon from '@ux/icon/x';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { getRootDomain } from '@/utils/getRootDomain';
import { generateClickEID } from '@/utils/instrumentation';

interface DowngradeModalProps {
  planName: string;
  planCreditsMax: number;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  error?: Error | null;
}

/**
 * Modal for confirming downgrade from Starter to Free plan
 */
export default function DowngradeModal({
  planName,
  planCreditsMax,
  onClose,
  onConfirm,
  isLoading,
  error,
}: DowngradeModalProps) {
  const t = useTranslations();
  const rootDomain = getRootDomain() || 'godaddy.com';
  const renewalsUrl = `https://account.${rootDomain}/myrenewals`;
  const contactUsUrl = `https://www.${rootDomain}/contact-us`;

  const lossItems = [
    t('builder_manageplan_downgrade_lose_publishing'),
    t('builder_manageplan_downgrade_lose_domains'),
    <FormattedMessage
      key="lose-credits"
      id="builder_manageplan_downgrade_lose_credits"
      values={{ maxCredits: planCreditsMax }}
    />,
  ];

  return (
    <Modal
      title={t('builder_manageplan_downgrade_title')}
      onClose={onClose}
    >
      <Box className="md:max-w-xl" orientation="vertical" gap="lg">
      {error && (
          <Alert emphasis="critical">
            {t('builder_manageplan_downgrade_error')}
          </Alert>
        )}

        <div className="flex flex-col gap-3">
          <text.p>
            <FormattedMessage
              id="builder_manageplan_downgrade_subtitle"
              values={{
                planName: planName,
                strong: (chunks) => <strong>{chunks}</strong>
              }}
            />
          </text.p>
          <div className="flex flex-col gap-1">
            <text.strong text={t('builder_manageplan_downgrade_lose_title')}/>
            <ul className="space-y-1">
              {lossItems.map((item, index) => (
                <li key={index} className="flex items-start gap-2">
                  <XIcon className="w-3 h-3 flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex gap-2 bg-ai-light/15 rounded-lg p-3">
          <InfoIcon className="w-3 h-3 flex-shrink-0" />
          <text.p size={-1}>
            <FormattedMessage
              id="builder_manageplan_downgrade_info"
              values={{
                planName: planName.charAt(0).toUpperCase() + planName.slice(1),
                renewalsLink: (
                  <a
                    key="renewals-link"
                    href={renewalsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline !cursor-pointer !normal-case"
                  >
                    {t('builder_manageplan_downgrade_renewals_link')}
                  </a>
                ),
                strong: (chunks) => <strong>{chunks}</strong>
              }}
            />
          </text.p>
        </div>

        <text.p>
          <FormattedMessage
            id="builder_manageplan_downgrade_support"
            values={{
              contactLink: (
                <a
                  key="contact-link"
                  href={contactUsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline !cursor-pointer !normal-case"
                >
                  {t('builder_manageplan_downgrade_contact_us')}
                </a>
              ),
            }}
          />
        </text.p>

      <div className="flex flex-wrap gap-2">
          <Button
            design="primary"
            data-partial="componentAiro"
            data-eid={generateClickEID('manageplan.buttons.downgrade_keep')}
            text={t('builder_manageplan_downgrade_keep')}
            onClick={onClose}
            disabled={isLoading}
          />
          <Button
            design="secondary"
            data-partial="componentAiro"
            data-eid={generateClickEID('manageplan.buttons.downgrade_confirm')}
            text={isLoading ? t('builder_manageplan_downgrade_switching') : t('builder_manageplan_downgrade_confirm')}
            onClick={onConfirm}
            disabled={isLoading}
          />
        </div>
      </Box>
    </Modal>
  );
}
