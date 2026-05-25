'use client';

import clsx from 'clsx';
import { FormattedMessage } from 'react-intl';
import Button from '@ux/button';
import { text } from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

export interface AnimatedDisclaimerProps {
  isVisible: boolean;
}

export function AnimatedDisclaimer({ isVisible }: AnimatedDisclaimerProps) {
  const t = useTranslations();

  return (
    <div
      className={clsx('grid transition-all duration-300 ease-in-out', {
        'grid-rows-[1fr] opacity-100': isVisible,
        'grid-rows-[0fr] opacity-0': !isVisible,
      })}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="overflow-hidden">
        <text.p size={-1} className="max-w-lg mx-auto opacity-40 mb-2 md:mb-4 text-center">
          <FormattedMessage
            id="builder_homepage_hero_disclaimer_v2"
            values={{
              terms: (
                <Button
                  design="inline"
                  size="sm"
                  external
                  href="https://www.godaddy.com/legal/agreements/ai-terms-of-use"
                  className="!text-intents-ux-boxHighContrast-foregroundColor"
                  text={t('builder_homepage_hero_disclaimer_terms')}
                />
              ),
            }}
          />
        </text.p>
      </div>
    </div>
  );
}
