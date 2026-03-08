'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import Box from '@ux/box';
import Button from '@ux/button';
import InfoIcon from '@ux/icon/information';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import type { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter';
import { SubscriptionPlan } from '@/types/credits';
import { getPlanDisplayLabelKey } from '@/utils/credits';
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation';

interface PublishLimitModalProps {
  plan: SubscriptionPlan | undefined;
  currentCount: number;
  limit: number | null;
  publishedApps: SiteInfo[];
  onClose: () => void;
  onUpgrade?: () => void;
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
  onUpgrade,
}: PublishLimitModalProps) {
  const t = useTranslations();
  const router = useRouter();
  const { data: isUnpublishEnabled } = useSwitchboard('appbuilder-unpublish');
  const { data: isHigherPlansEnabled } = useSwitchboard('appbuilder-higher-plans');
  const planName = plan ? t(getPlanDisplayLabelKey(plan)) : '';

  useEffect(() => {
    logImpressionEvent('develop.publish_limit_modal.view')();
  }, []);

  const handleClose = () => {
    onClose();
  };

  const handleManageApps = () => {
    onClose();
    router.push('/manage-plan');
  };

  return (
    <Modal
      title={t('builder_publish_limit_title')}
      onClose={handleClose}
      data-partial="componentAiro"
    >
      <Box className="md:max-w-lg" orientation="vertical" gap="lg">
        {isHigherPlansEnabled ? (
          <div className="flex flex-col gap-2">
            <text.p size={-1} text={t('builder_publish_limit_plan_info', {planName, limit, strong: (chunks) => <strong>{chunks}</strong>})}/>
            <div className="flex gap-2 bg-ai-light/15 border border-border rounded-lg p-3">
              <InfoIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <text.p>
                <FormattedMessage
                  id="builder_publish_limit_upgrade_hint"
                  values={{
                    myAppsLink: (chunks) => (
                      <Button
                        design="inline"
                        data-partial="componentAiro"
                        data-eid={generateClickEID('publish_limit.buttons.my_apps')}
                        onClick={handleManageApps}
                        text={chunks.toString()}
                      />
                    ),
                  }}
                />
              </text.p>
            </div>
          </div>
        ) : (
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
        )}

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

        {isHigherPlansEnabled && plan !== SubscriptionPlan.Ultimate && onUpgrade ? (
          <Button
            design="primary"
            data-partial="componentAiro"
            data-eid={generateClickEID('publish_limit.buttons.upgrade')}
            text={t('builder_publish_limit_upgrade')}
            onClick={() => {
              onClose();
              onUpgrade();
            }}
          />
        ) : isUnpublishEnabled ? (
          <Button
            design="secondary"
            data-partial="componentAiro"
            data-eid={generateClickEID('publish_limit.buttons.manage_apps')}
            text={t('builder_publish_limit_manage_apps')}
            onClick={handleManageApps}
          />
        ) : null}
      </Box>
    </Modal>
  );
}
