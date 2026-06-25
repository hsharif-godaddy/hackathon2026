'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@ux/button';
import text from '@ux/text';
import Tooltip from '@ux/tooltip';

export const TOOLTIP_SHOW_DELAY_MS = 400;

interface ResponseMetadataActionButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  'data-eid'?: string;
}

export default function ResponseMetadataActionButton({
  label,
  icon,
  onClick,
  'data-eid': dataEid,
}: ResponseMetadataActionButtonProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  const clearShowTimeout = () => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
  };

  const scheduleShowTooltip = () => {
    clearShowTimeout();
    showTimeoutRef.current = setTimeout(() => {
      showTimeoutRef.current = null;
      setShowTooltip(true);
    }, TOOLTIP_SHOW_DELAY_MS);
  };

  const hideTooltip = () => {
    clearShowTimeout();
    setShowTooltip(false);
  };

  useEffect(function cleanupTooltipTimeout() {
    return clearShowTimeout;
  }, []);

  const handleClick = () => {
    hideTooltip();
    onClick?.();
  };

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={scheduleShowTooltip}
      onMouseLeave={hideTooltip}
    >
      <Button
        type="button"
        design="stateless"
        size="small"
        className="!size-4"
        aria-label={label}
        data-eid={dataEid}
        onClick={handleClick}
        onFocus={scheduleShowTooltip}
        onBlur={hideTooltip}
        icon={icon}
      />
      {showTooltip && (
        <Tooltip
          anchorRef={anchorRef}
          portalElem={typeof document !== 'undefined' ? document.body : undefined}
          placement="bottom"
        >
          <text.span size={-2} text={label} />
        </Tooltip>
      )}
    </span>
  );
}
