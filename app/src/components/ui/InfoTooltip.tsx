'use client';

import { useId, useRef, useState } from 'react';
import InfoIcon from '@ux/icon/information';
import Tooltip from '@ux/tooltip';

import { useTranslations } from '@/hooks/useTranslations';

interface InfoTooltipProps {
  content: string;
  iconClassName?: string;
  contentClassName?: string;
}

export function InfoTooltip({
  content,
  iconClassName = 'size-2 text-intents-ux-passive-foregroundColor',
  contentClassName = 'p-1 max-w-[25ch] break-words',
}: InfoTooltipProps) {
  const t = useTranslations();
  const [show, setShow] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const tooltipId = useId();

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={t('builder_common_more_info')}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setShow(false);
          }
        }}
        aria-expanded={show}
        aria-describedby={show ? tooltipId : undefined}
        className="inline-flex items-center"
      >
        <InfoIcon className={iconClassName} />
      </button>
      {show && (
        <Tooltip anchorRef={anchorRef}>
          <div id={tooltipId} role="tooltip" className={contentClassName}>{content}</div>
        </Tooltip>
      )}
    </>
  );
}
