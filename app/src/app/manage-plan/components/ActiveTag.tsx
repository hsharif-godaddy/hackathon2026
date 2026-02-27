'use client';

import { useRef, useState } from 'react';
import Tag from '@ux/tag';
import text from '@ux/text';
import Tooltip from '@ux/tooltip';

import { useTranslations } from '@/hooks/useTranslations';

interface ActiveTagProps {
  tooltipText?: string;
}

export default function ActiveTag({ tooltipText }: ActiveTagProps) {
  const t = useTranslations();
  const [showTooltip, setShowTooltip] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <>
      <span
        className={tooltipText ? 'cursor-pointer' : undefined}
        ref={anchorRef}
        onMouseEnter={() => tooltipText && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <Tag
          className="!border-intents-ux-passive-borderColor !text-ai-light [&_use]:!fill-ai-light"
          emphasis="premium"
          indicator
        >
          {t('builder_manageplan_active')}
        </Tag>
      </span>

      {showTooltip && tooltipText && (
        <Tooltip className="z-50" anchorRef={anchorRef}>
          <div className="p-1 max-w-32">
            <text.p as="paragraph" size={-1} text={tooltipText} />
          </div>
        </Tooltip>
      )}
    </>
  );
}
