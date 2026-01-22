'use client';

import AlertIcon from '@ux/icon/alert';
import text from '@ux/text';

import ActiveTag from '@/app/manage-plan/components/ActiveTag';
import { useTranslations } from '@/hooks/useTranslations';
import LargeCircularGauge from '@/lib/LargeCircularGauge';
import type { CreditGrant } from '@/types/credits';
import { getBillingPeriod } from '@/utils/credits';

interface PlanCreditCardProps {
  grant?: CreditGrant;
  isActive?: boolean;
  locale?: string;
}

export default function PlanCreditCard({ grant, isActive = false, locale }: PlanCreditCardProps) {
  const t = useTranslations();

  if (!grant) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 min-h-[200px]">
        <AlertIcon className="w-8 h-8" />
        <text.strong as="title" size={0} className="text-center" text={t('builder_manageplan_monthly_credits')} />
        <text.p as="paragraph" size={-1} className="text-center" text={t('builder_manageplan_credits_load_error')} />
      </div>
    );
  }

  const { periodStart, periodEnd } = getBillingPeriod(grant.createdAt);
  const formatOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const periodStartFormatted = periodStart.toLocaleDateString(locale, formatOptions);
  const periodEndFormatted = periodEnd.toLocaleDateString(locale, formatOptions);

  return (
    <div
      className="flex flex-col items-center gap-2 bg-ai-light/4 border border-ai-light/20 rounded-lg p-4 relative"
    >
      {isActive && (
        <ActiveTag tooltipText={t('builder_manageplan_using_monthly')} />
      )}

      <text.strong as="title" size={0} className="text-center" text={t('builder_manageplan_monthly_credits')} />

      <text.span as="caption">
        {periodStartFormatted} - {periodEndFormatted}
      </text.span>

      <div className="flex items-baseline gap-1">
        <text.span as="title" size={2} emphasis="passive">
          {grant.creditsSpent.toLocaleString()}
        </text.span>
        <text.strong as="title" size={2}>
          / {grant.creditsMax.toLocaleString()}
        </text.strong>
      </div>

      {/* Large circular gauge */}
      <div className="my-2">
        <LargeCircularGauge
          value={grant.creditsSpent}
          max={grant.creditsMax}
          size={120}
          strokeWidth={10}
        />
      </div>

    </div>
  );
}
