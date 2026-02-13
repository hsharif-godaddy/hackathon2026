'use client';

import { useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import Box from '@ux/box';
import InfoIcon from '@ux/icon/information';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import type { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter';
import { SubscriptionPlan } from '@/types/credits';
import { getPlanDisplayLabelKey } from '@/utils/credits';
import { logImpressionEvent } from '@/utils/instrumentation';

interface PublishLimitModalProps {
  plan: SubscriptionPlan | undefined;
  currentCount: number;
  limit: number | null;
  publishedApps: SiteInfo[];
  onClose: () => void;
}

/**
 * Modal shown when user has reached their plan's publish limit
 */
export default function PublishLimitModal({
  plan,
  currentCount,
  limit,
  publishedApps,
  onClose,
}: PublishLimitModalProps) {
  const t = useTranslations();
  const planName = plan ? t(getPlanDisplayLabelKey(plan)) : '';

  useEffect(() => {
    logImpressionEvent('develop.publish_limit_modal.view')();
  }, []);

  const handleClose = () => {
    onClose();
  };

  return (
    <Modal
      title={t('builder_publish_limit_title')}
      onClose={handleClose}
      data-partial="componentAiro"
    >
      <Box className="md:max-w-lg" orientation="vertical" gap="lg">
        <div className="flex gap-2 bg-ai-light/15 rounded-lg p-3">
          <InfoIcon className="w-3 h-3 flex-shrink-0" />
            <text.p>
              <FormattedMessage
                id="builder_publish_limit_message"
                values={{
                  planName,
                  count: currentCount,
                  limit: limit ?? 0,
                  strong: (chunks) => <strong>{chunks}</strong>,
                }}
              />
            </text.p>
        </div>

        {publishedApps.length > 0 ? (
          <div className="flex flex-col gap-2">
            <text.strong>
              {t('builder_publish_limit_apps_published')}
            </text.strong>
            <ul className="space-y-1 pl-4">
              {publishedApps.map((app) => (
                <li key={app.id} className="list-disc">
                  <text.p size={-1}>{app.name}</text.p>
                </li>
              ))}
            </ul>
          </div>
        ) : currentCount > 0 ? (
          <text.p size={-1} className="text-secondary">
            {t('builder_publish_limit_no_apps_found')}
          </text.p>
        ) : null}
      </Box>
    </Modal>
  );
}
