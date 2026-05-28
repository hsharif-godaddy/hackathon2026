'use client';

import clsx from 'clsx';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { text } from '@ux/text';

import { useBreakpoints } from '@/hooks/useBreakpoints';
import { MAX_PROMPT_BYTES } from '@/lib/waf-validation';

export interface PromptCharCountProps {
  bytesRemaining: number;
  isOverLimit: boolean;
}

export function PromptCharCount({ bytesRemaining, isOverLimit }: PromptCharCountProps) {
  const intl = useIntl();
  const { isBelowSmBreakpoint } = useBreakpoints();
  const numberFormat = useMemo(() => new Intl.NumberFormat(intl.locale), [intl.locale]);
  const formattedCount = numberFormat.format(bytesRemaining);
  const formattedMax = numberFormat.format(MAX_PROMPT_BYTES);

  return (
    <div id="prompt-char-count" role="status" aria-live="polite">
      {bytesRemaining <= 20 && (
        <text.p
          size={isBelowSmBreakpoint ? -1 : 0}
          className={clsx('font-medium', { 'opacity-50': !isOverLimit })}
          emphasis={isOverLimit ? 'critical' : undefined}
        >
          <span aria-hidden="true">
            {formattedCount} / {formattedMax}
          </span>
          <span className="sr-only">
            {isOverLimit
              ? intl.formatMessage(
                  {
                    id: 'builder_homepage_hero_chars_over_limit',
                    defaultMessage: '{count, number} over the {max, number} character limit',
                  },
                  { count: Math.abs(bytesRemaining), max: MAX_PROMPT_BYTES }
                )
              : intl.formatMessage(
                  {
                    id: 'builder_homepage_hero_chars_remaining',
                    defaultMessage: '{count, number} of {max, number} characters remaining',
                  },
                  { count: bytesRemaining, max: MAX_PROMPT_BYTES }
                )}
          </span>
        </text.p>
      )}
    </div>
  );
}
