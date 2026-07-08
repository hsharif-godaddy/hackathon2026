import clsx from "clsx";
import text from "@ux/text"

import { useTranslations } from "@/hooks/useTranslations";

interface CreditsProgressBarProps {
    label?: string;
    spent: number;
    left: number;
    max: number;
    progressBarColor: string;
    size?: 'sm' | 'md';
}

export const CreditsProgressBar = ({ label, spent, left, max, progressBarColor, size='sm' }: CreditsProgressBarProps) => {
    const t = useTranslations();
    const percentage = max > 0 ? Math.min((spent / max) * 100, 100) : 0;

    return (
    <div className="flex flex-col gap-1">
        <div className={clsx("flex items-center justify-between", label ? 'justify-between' : 'justify-end')}>
          { label && size === 'md' ? (
            <text.strong as="label" size={-1}>
              {label}
            </text.strong>
          ) : label ? (
            <text.p as="label" size={-1}>
              {label}
            </text.p>
          ) : null}
          <text.span as="caption" emphasis="passive" size={-1}>
            {t("builder_manageplan_left", { left: left.toLocaleString(), max: max.toLocaleString() })}
          </text.span>
        </div>
        <div
        role="progressbar"
        aria-valuenow={Math.min(spent, max)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={t('builder_manageplan_credits_progress')}
        className={clsx(size === 'sm' ? 'h-1.5' : 'h-3', 'bg-progress-track rounded-full overflow-hidden w-full')}
      >
        <div
          className={`h-full rounded-full transition-all duration-500`}
          style={{ width: `${percentage}%`, background: `var(--${progressBarColor})` }}
        />
      </div>
      </div>
    )
}