'use client';

import { memo } from 'react';
import AlertIcon from '@ux/icon/alert';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import LargeCircularGauge from '@/lib/LargeCircularGauge';

interface TotalCreditsCardProps {
  /** Total credits spent across all grants */
  totalCreditsSpent: number;
  /** Total max credits across all grants */
  totalCreditsMax: number;
}

export default memo(function TotalCreditsCard({
  totalCreditsSpent,
  totalCreditsMax,
}: TotalCreditsCardProps) {
  const t = useTranslations();

  // Only show error state if max credits is 0 or undefined (indicates data loading error)
  // A user with 0 credits spent is valid and should show the gauge
  if (totalCreditsMax === undefined || totalCreditsMax === null || totalCreditsMax === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 min-h-[200px]">
        <AlertIcon className="w-8 h-8" />
        <text.strong as="title" size={0} className="text-center" text={t('builder_manageplan_total_credits')} />
        <text.p as="paragraph" size={-1} className="text-center" text={t('builder_manageplan_credits_load_error')} />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center gap-2 bg-ai-light/4 border border-ai-light/20 rounded-lg p-4 relative max-h-44 lg:max-h-40"
    >
      <text.strong as="title" size={0} className="text-center" text={t('builder_manageplan_total_credits')} />

      <text.strong as="title" size={2}>
        {t('builder_manageplan_credits_count', {
          spent: Math.min(totalCreditsSpent, totalCreditsMax).toLocaleString(),
          max: totalCreditsMax.toLocaleString(),
        })}
      </text.strong>

      <div className="my-2">
        <LargeCircularGauge
          value={totalCreditsSpent}
          max={totalCreditsMax}
          size={120}
          strokeWidth={10}
        />
      </div>
    </div>
  );
})
