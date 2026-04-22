'use client';

import { cloneElement, useId, useRef, useState } from 'react';
import Tooltip from '@ux/tooltip';

interface ContentTooltipProps {
  children: React.ReactElement;
  content: React.ReactNode;
  contentClassName?: string;
}

export function ContentTooltip({
  children,
  content,
  contentClassName = 'p-1',
}: ContentTooltipProps) {
  const [show, setShow] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tooltipId = useId();

   
  const child = cloneElement(children as React.ReactElement<any>, {
    ref: anchorRef,
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true),
    onBlur: () => setShow(false),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShow(false);
      }
    },
    'aria-describedby': show ? tooltipId : undefined,
  });

  return (
    <>
      {child}
      {show && (
        <Tooltip id={tooltipId} anchorRef={anchorRef} portalElem={document.body}>
          <div className={contentClassName}>{content}</div>
        </Tooltip>
      )}
    </>
  );
}
