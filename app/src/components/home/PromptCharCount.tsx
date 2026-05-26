'use client';

import clsx from 'clsx';
import { text } from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

export interface PromptCharCountProps {
  bytesRemaining: number;
  isOverLimit: boolean;
}

export function PromptCharCount({ bytesRemaining, isOverLimit }: PromptCharCountProps) {
  const t = useTranslations();

  return (
    <div id="prompt-char-count" role="status" aria-live="polite">
      {bytesRemaining <= 20 && (
        <text.p
          size={0}
          className={clsx('font-medium', { 'opacity-50': !isOverLimit })}
          emphasis={isOverLimit ? 'critical' : undefined}
        >
          <span aria-hidden="true">
            {isOverLimit ? `-${Math.abs(bytesRemaining)}` : bytesRemaining}
          </span>
          <span className="sr-only">
            {isOverLimit
              ? t(
                  'builder_homepage_hero_chars_over_limit',
                  { count: Math.abs(bytesRemaining) },
                  `${Math.abs(bytesRemaining)} characters over limit`
                )
              : t(
                  'builder_homepage_hero_chars_remaining',
                  { count: bytesRemaining },
                  `${bytesRemaining} characters remaining`
                )}
          </span>
        </text.p>
      )}
    </div>
  );
}
