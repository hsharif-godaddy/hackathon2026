'use client';

import { useId, useRef, useState } from 'react';
import InfoIcon from '@ux/icon/information';
import Tooltip from '@ux/tooltip';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';

interface InfoTooltipProps {
  content: string;
  iconClassName?: string;
  contentClassName?: string;
  /** Compact trigger for overlays (e.g. aligned over a parent control); stops click bubbling */
  embedded?: boolean;
}

export function InfoTooltip({
  content,
  iconClassName,
  contentClassName,
  embedded = false,
}: InfoTooltipProps) {
  const t = useTranslations();
  const [show, setShow] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
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
        onClick={embedded ? (event) => event.stopPropagation() : undefined}
        onPointerDown={embedded ? (event) => event.stopPropagation() : undefined}
        aria-expanded={show}
        aria-describedby={show ? tooltipId : undefined}
        className={
          embedded
            ? 'pointer-events-auto inline-flex shrink-0 items-center border-0 bg-transparent p-0'
            : 'inline-flex items-center'
        }
      >
        <InfoIcon className={cn('size-2 text-intents-ux-feedbackHighContrastPassive-feedbackColor', iconClassName)} />
      </button>
      {show && (
        <Tooltip id={tooltipId} anchorRef={anchorRef} portalElem={document.body}>
          <div className={cn(embedded && 'max-w-xs', 'p-1 text-start max-w-[25ch] break-words', contentClassName)}>
            {content}
          </div>
        </Tooltip>
      )}
    </>
  );
}
