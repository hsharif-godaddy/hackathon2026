'use client'

import type { ComponentPropsWithoutRef } from 'react'

import SpinnerIcon from '@/app/[market]/develop/components/tool-renderers/SpinnerIcon'
import { cn } from '@/lib/utils'

interface StatusPillProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  label: string
}

export default function StatusPill({ label, className, style: callerStyle, ...rest }: StatusPillProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 whitespace-nowrap rounded-full border border-intents-ux-boxLowContrast-borderColor bg-intents-ux-box-backgroundColor px-3 py-1.5 shadow-lg',
        className,
      )}
      role="status"
      aria-live="polite"
      // Inline style is needed to override opacity compositing in portal contexts.
      style={{
        ...callerStyle,
        backgroundColor: '#ffffff',
        opacity: 1,
      }}
      {...rest}
    >
      <SpinnerIcon className="size-3 text-[var(--color-ai)]" />
      <span className="text-sm font-medium text-intents-ux-textLowContrast-color">{label}</span>
    </div>
  )
}
