'use client';

import { text } from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

export function HeroBenefits() {
  const t = useTranslations();
  return (
    <div className="mx-auto flex flex-col items-center justify-center gap-0.5 opacity-60 sm:flex-row sm:gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-1.5">
        <text.p size={1} className="!font-normal max-sm:!text-xs whitespace-nowrap">
          {t('builder_homepage_hero_value_prop_start_free', undefined, 'Get started for free')}
        </text.p>
        <span className="opacity-40" aria-hidden>
          ·
        </span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 max-sm:h-[11px] max-sm:w-[11px]"
            aria-hidden
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          <text.p size={1} className="!font-normal max-sm:!text-xs">
            {t('builder_homepage_hero_value_prop_credits', undefined, '50 AI credits/mo')}
          </text.p>
        </span>
      </div>
      <span className="hidden opacity-40 sm:inline" aria-hidden>
        ·
      </span>
      <text.p size={1} className="!font-normal max-sm:!text-xs">
        {t('builder_homepage_hero_value_prop_no_card', undefined, 'No credit card required')}
      </text.p>
    </div>
  );
}
