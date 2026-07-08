'use client'

import clsx from 'clsx'
import type { ReactNode } from 'react'

export function canvasTabSurfaceClassName(active: boolean, className?: string): string {
  return clsx(
    'group relative flex shrink-0 items-center p-1 leading-none rounded-lg',
    'transition-[background-color,color] duration-200',
    'focus:outline-none focus-visible:ring-1 focus-visible:ring-intents-ux-action-borderColor',
    active
      ? 'bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor'
      : 'bg-transparent hover:cursor-pointer hover:bg-intents-ux-actionHovered-backgroundColor',
    className,
  )
}

interface CanvasTabSurfaceContentProps {
  icon: ReactNode
  label: ReactNode
  /** When false, the label is collapsed to icon-only (overflow tab strip). */
  showLabel?: boolean
  cornerBadge?: ReactNode
  labelAriaHidden?: boolean
}

export function CanvasTabSurfaceContent({
  icon,
  label,
  showLabel = true,
  cornerBadge,
  labelAriaHidden,
}: CanvasTabSurfaceContentProps) {
  return (
    <>
      <span className="relative inline-flex shrink-0 items-center justify-center size-2.5">
        {icon}
      </span>
      <span
        aria-hidden={labelAriaHidden ?? !showLabel}
        className={clsx(
          'inline-block text-sm whitespace-nowrap overflow-hidden',
          'transition-[max-width,opacity,margin] duration-150 ease-out',
          showLabel ? 'max-w-[240px] opacity-100 mx-0.5' : 'max-w-0 opacity-0 mx-0',
        )}
      >
        {label}
      </span>
      {cornerBadge && (
        <span className="pointer-events-none absolute -right-0.5 top-0 flex items-center">
          {cornerBadge}
        </span>
      )}
    </>
  )
}
