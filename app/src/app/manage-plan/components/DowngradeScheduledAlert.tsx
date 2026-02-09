'use client';

import Alert from '@ux/alert';
import Button from '@ux/button';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

interface DowngradeScheduledAlertProps {
  renewalDate?: string;
  planName: string;
  onCancelChanges?: () => void;
  isLoading?: boolean;
  onDismiss?: () => void;
}

/**
 * Alert banner shown when a downgrade to Free is scheduled (autoRenew=false)
 */
export default function DowngradeScheduledAlert({
  renewalDate,
  planName,
  onCancelChanges,
  isLoading,
  onDismiss,
}: DowngradeScheduledAlertProps) {
  const t = useTranslations();

  // Format the date for display if available
  const formattedDate = renewalDate
    ? new Date(renewalDate).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <div className="mb-4">
      <Alert
        emphasis="info"
        title={t('builder_manageplan_downgrade_scheduled_title')}
        onClose={onDismiss}
        actions={
          onCancelChanges ? (
            <Button
              design="inline"
              size="sm"
              data-partial="componentAiro"
              data-eid={generateClickEID('manageplan.buttons.downgrade_cancel_changes')}
              text={isLoading ? t('builder_manageplan_downgrade_canceling') : t('builder_manageplan_downgrade_cancel_changes')}
              onClick={onCancelChanges}
              disabled={isLoading}
            />
          ) : undefined
        }
      >
        {formattedDate
          ? t('builder_manageplan_downgrade_scheduled_message', {
              planName,
              date: formattedDate,
            })
          : t('builder_manageplan_downgrade_scheduled_message_no_date', {
              planName,
            })}
      </Alert>
    </div>
  );
}
