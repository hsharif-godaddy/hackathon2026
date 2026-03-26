'use client';

import { useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import Alert from '@ux/alert';
import Button from '@ux/button';
import InfoIcon from '@ux/icon/information';
import XIcon from '@ux/icon/x';
import text from '@ux/text';

import { useGasketData } from '@/hooks/useGasketData';
import { useTranslations } from '@/hooks/useTranslations';
import { FREEMIUM_CREDIT_LIMIT, getFormattedUnpublishDate } from '@/lib/paywall/shared';
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation';

interface SuspendedNonPaymentAlertProps {
  planName: string;
  renewsAt?: string;
  onRenew: () => void;
  onDismiss?: () => void;
  isRenewing?: boolean;
  error?: Error | null;
  onErrorDismiss?: () => void;
}

/**
 * Alert banner shown when a subscription is suspended due to non-payment.
 */
export default function SuspendedNonPaymentAlert({
  planName,
  renewsAt,
  onRenew,
  onDismiss,
  isRenewing,
  error,
  onErrorDismiss,
}: SuspendedNonPaymentAlertProps) {
  const t = useTranslations();
  const { intl } = useGasketData();

  useEffect(() => {
    logImpressionEvent('manageplan.suspended.nonpayment.view')();
  }, []);

  const formattedUnpublishDate = getFormattedUnpublishDate(renewsAt, intl?.locale);

  // Show error state if renewal failed
  if (error) {
    return (
      <div className="mb-4">
        <Alert
          emphasis="critical"
          title={t('builder_manageplan_renewal_error_title')}
          onClose={onErrorDismiss}
          actions={
            <Button
              design="inline"
              size="sm"
              data-partial="componentAiro"
              data-eid={generateClickEID('manageplan.buttons.renewal_retry')}
              text={t('builder_common_retry')}
              onClick={onRenew}
              disabled={isRenewing}
            />
          }
        >
          {t('builder_manageplan_renewal_error_message')}
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 bg-ai-light/15 border border-border rounded-lg p-2 mb-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <InfoIcon className="w-3 h-3 flex-shrink-0" />
          <text.h3 as="title" size={-2} text={t('builder_manageplan_suspended_title', { currentPlan: planName })} />
        </div>
        {onDismiss && (
          <Button
            design="tertiary"
            size="sm"
            onClick={onDismiss}
            icon={<XIcon className="w-4 h-4" />}
          />
        )}
      </div>
      <text.p className="pl-4 md:pl-6 pr-2">
        <FormattedMessage
          id="builder_manageplan_suspended_message"
          values={{
            unpublishDate: formattedUnpublishDate,
            creditLimit: FREEMIUM_CREDIT_LIMIT,
            strong: (chunks) => <strong>{chunks}</strong>,
          }}
        />
      </text.p>
      <div className="flex mt-1 pl-6">
        <Button
          design="secondary"
          size="sm"
          data-partial="componentAiro"
          data-eid={generateClickEID('manageplan.buttons.renew_subscription')}
          text={isRenewing
            ? t('builder_manageplan_renewal_processing')
            : t('builder_manageplan_suspended_renew_button', { planName })
          }
          onClick={onRenew}
          disabled={isRenewing}
        />
      </div>
    </div>
  );
}
