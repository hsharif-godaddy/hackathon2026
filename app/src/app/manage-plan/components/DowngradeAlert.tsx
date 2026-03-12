'use client';

import { useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import Button from '@ux/button';
import InfoIcon from '@ux/icon/information';
import XIcon from '@ux/icon/x';
import text from '@ux/text';

import { useSubscription } from '@/hooks/useSubscription';
import { useTranslations } from '@/hooks/useTranslations';
import { getPlanDisplayLabelKey, getPlanFromSubscription } from '@/utils/credits';
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation';

interface DowngradeScheduledAlertProps {
  /** Callback when user clicks to keep their current plan */
  onKeepPlan?: () => void;
  /** Callback when user dismisses the alert */
  onDismiss?: () => void;
}

/**
 * Alert banner shown when a user has scheduled a downgrade to a lower plan.
 * The downgrade will take effect at the end of their current billing period.
 * This is different from FreeAutoRenewAlert which handles autoRenew=false.
 *
 * Shows when subscription has downgradedAt and downgradedPlan fields.
 */
export default function DowngradeScheduledAlert({
  onKeepPlan,
  onDismiss,
}: DowngradeScheduledAlertProps) {
  const t = useTranslations();
  const { data: subscription } = useSubscription();

  const downgradedAt = subscription?.downgradedAt;
  const downgradedPlan = subscription?.downgradedPlan;

  const currentPlan = subscription ? getPlanFromSubscription(subscription) : null;
  const planLabelKey = currentPlan ? getPlanDisplayLabelKey(currentPlan) : null;
  const currentPlanName = planLabelKey ? t(planLabelKey) : '';

  const hasScheduledDowngrade = !!(downgradedAt && downgradedPlan);

  useEffect(() => {
    if (hasScheduledDowngrade) {
      logImpressionEvent('manageplan.downgrade.scheduled')();
    }
  }, [hasScheduledDowngrade]);

  if (!hasScheduledDowngrade) {
    return null;
  }

  // Format the date for display
  const formattedDate = new Date(downgradedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const downgradedPlanLabelKey = getPlanDisplayLabelKey(downgradedPlan);
  const downgradedPlanName = downgradedPlanLabelKey ? t(downgradedPlanLabelKey) : downgradedPlan;

  return (
    <div className="flex flex-col gap-1 bg-ai-light/15 border border-border rounded-lg p-2 mb-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <InfoIcon className="w-3 h-3 flex-shrink-0" />
          <text.h3 as="title" size={-2} text={t('builder_manageplan_downgrade_plan_title')} />
        </div>
        <Button
          design="tertiary"
          size="sm"
          onClick={onDismiss}
          icon={<XIcon className="w-4 h-4" />}
        />
      </div>
      <text.p className="pl-4 md:pl-6 pr-2">
        <FormattedMessage
          id="builder_manageplan_downgrade_to_plan_message"
          values={{
            currentPlanName,
            downgradedPlanName,
            formattedDate,
            strong: (chunks) => <strong>{chunks}</strong>,
          }}
        />
      </text.p>
      <div className="flex mt-1 pl-6">
        <Button
          design="secondary"
          size="sm"
          data-partial="componentAiro"
          data-eid={generateClickEID('manageplan.buttons.downgrade_keep_plan')}
          text={t('builder_manageplan_downgrade_keep_plan', { currentPlan: currentPlanName })}
          onClick={onKeepPlan}
        />
      </div>
    </div>
  );
}
