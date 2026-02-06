import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

interface CreditProgressBarProps {
  spent: number;
  max: number;
  isExpired?: boolean;
}

/**
 * Progress bar component for credit grants
 */
export default function CreditProgressBar({ spent, max, isExpired = false }: CreditProgressBarProps) {
  const t = useTranslations();
  const percentage = max > 0 ? Math.min((spent / max) * 100, 100) : 0;
  const isFull = percentage >= 100;

  return (
    <div className="flex flex-col items-center gap-1">
      <text.span
        as="caption"
        emphasis={isExpired ? 'passive' : undefined}
        className="whitespace-nowrap self-end"
      >
        {t('builder_manageplan_credits_count', {
          spent: Math.min(spent, max).toLocaleString(),
          max: max.toLocaleString(),
        })}
      </text.span>
      <div
        role="progressbar"
        aria-valuenow={Math.min(spent, max)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={t('builder_manageplan_credits_progress')}
        className={`h-1.5 bg-[#1111111A] rounded-full overflow-hidden w-full ${isExpired ? 'opacity-50' : ''}`}
      >
        <div
          className={`h-full transition-all duration-500 ${isFull ? 'bg-ai-light' : 'bg-gradient-to-r from-ai-light/15 to-ai-light'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
