'use client';

import clsx from 'clsx';
import { useCallback } from 'react';
import Box from '@ux/box';
import { text } from '@ux/text';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

export interface HeroScrollButtonProps {
  sectionId: string;
  className?: string;
}

export function HeroScrollButton({
  sectionId,
  className,
}: HeroScrollButtonProps) {
  const t = useTranslations();
  const { isAuthenticated } = useAuthContext();
  const { logAnalytics } = useAnalytics({ baseData: { isAuthenticated } });

  const handleClick = useCallback(() => {
    logAnalytics(
      'homepage.hero.scroll_cta_click',
      { msFromPageLoad: Math.round(performance.now()) },
      { kind: 'click', eid: 'homepage.hero.scroll_cta' }
    );

    const nextSection = document.getElementById(sectionId);
    const targetPosition = nextSection
      ? window.pageYOffset + nextSection.getBoundingClientRect().top
      : window.pageYOffset + window.innerHeight;

    const startPosition = window.pageYOffset;
    const duration = 1000;
    const startTime = Date.now();

    const animateScroll = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeInOutQuad = (x: number): number => (x < 0.5 ? 2 * x * x : -1 + (4 - 2 * x) * x);
      const easedProgress = easeInOutQuad(progress);
      window.scrollTo(0, startPosition + (targetPosition - startPosition) * easedProgress);
      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      }
    };

    requestAnimationFrame(animateScroll);
  }, [logAnalytics, sectionId]);

  return (
    <button
      onClick={handleClick}
      data-eid={generateClickEID('homepage.hero.see_how_it_works')}
      className={clsx(
        'flex items-center gap-1',
        'mx-auto mt-2 text-sm',
        'opacity-60 hover:opacity-100 hover:cursor-pointer transition-opacity group',
        className
      )}
    >
      <Box blockAlignChildren="center" inlineAlignChildren="center" gap="md">
        <text.p size={0} className="font-medium">
          {t('builder_homepage_hero_scroll')}
        </text.p>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 8 37"
          className="w-1 group-hover:translate-y-1 transition-all duration-500"
        >
          <path
            fill="#d3c1f7"
            d="M3.646 36.789a.5.5 0 0 0 .708 0l3.182-3.182a.5.5 0 1 0-.708-.707L4 35.728 1.172 32.9a.5.5 0 0 0-.708.707zM4 0h-.5v36.435h1V0z"
            opacity=".5"
          />
        </svg>
      </Box>
    </button>
  );
}
