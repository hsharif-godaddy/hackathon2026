'use client';

import Button from '@ux/button';
import InfoIcon from '@ux/icon/information';
import XIcon from '@ux/icon/x';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

interface FreeAutoRenewAlertProps {
  renewalDate?: string;
  planName: string;
  onCancelChanges?: () => void;
  isLoading?: boolean;
  onDismiss?: () => void;
}

/**
 * Alert banner shown when a downgrade to Free is scheduled (autoRenew=false)
 */
export default function FreeAutoRenewAlert({
  renewalDate,
  planName,
  onCancelChanges,
  isLoading,
  onDismiss,
}: FreeAutoRenewAlertProps) {
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
        {formattedDate
          ? t('builder_manageplan_downgrade_scheduled_message', {
              planName,
              date: formattedDate,
            })
          : t('builder_manageplan_downgrade_scheduled_message_no_date', {
              planName,
            })}
      </text.p>
      {onCancelChanges && (
        <div className="flex pl-6">
          <Button
            design="secondary"
            size="sm"
            data-partial="componentAiro"
            data-eid={generateClickEID('manageplan.buttons.downgrade_cancel_changes')}
            text={isLoading ? t('builder_manageplan_downgrade_canceling') : t('builder_manageplan_downgrade_cancel_changes')}
            onClick={onCancelChanges}
            disabled={isLoading}
          />
        </div>
      )}
    </div>
  );
}
