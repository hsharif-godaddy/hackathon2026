'use client'

import clsx from 'clsx'
import type { MouseEventHandler, ReactNode } from 'react'

interface MutedIconButtonProps {
  onClick: () => void
  onMouseDown?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  'aria-label': string
  'data-eid'?: string
  'data-partial'?: string
  children: ReactNode
  className?: string
}

export function MutedIconButton({
  onClick,
  onMouseDown,
  disabled,
  'aria-label': ariaLabel,
  'data-eid': dataEid,
  'data-partial': dataPartial,
  children,
  className,
}: MutedIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
      aria-label={ariaLabel}
      data-eid={dataEid}
      data-partial={dataPartial}
      className={clsx(
        'flex cursor-pointer items-center justify-center p-[10px] rounded-lg transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}
