'use client'

import clsx from 'clsx'
import { type ReactNode, useRef, useState } from 'react'
import XIcon from '@ux/icon/x'

import { HeaderTooltip } from '@/components/ui/HeaderTooltip'
import type { CanvasId } from './registry'

interface CanvasTabProps {
  canvasId: CanvasId
  icon: ReactNode
  label: string
  active: boolean
  /** When false, the close affordance never renders (e.g. pinned Preview tab). */
  dismissible: boolean
  /** When true, the label stays icon-only regardless of active state. */
  collapseLabel: boolean
  closeLabel: string
  onActivate: () => void
  onClose?: () => void
  testId?: string
}

export function CanvasTab({
  canvasId,
  icon,
  label,
  active,
  dismissible,
  collapseLabel,
  closeLabel,
  onActivate,
  onClose,
  testId,
}: CanvasTabProps) {
  const showLabel = !collapseLabel
  const showCloseOnIcon = dismissible && active
  const tabRef = useRef<HTMLDivElement | null>(null)
  const [showTooltip, setShowTooltip] = useState<boolean>(false)

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose?.()
  }

  return (
    <>
      <div
        ref={tabRef}
        role="tab"
        aria-selected={active}
        aria-label={label}
        tabIndex={0}
        onClick={onActivate}
        onMouseEnter={() => { if (collapseLabel) setShowTooltip(true) }}
        onMouseLeave={() => setShowTooltip(false)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onActivate()
          }
        }}
        data-testid={testId}
        data-canvas-id={canvasId}
        className={clsx(
          'group relative flex shrink-0 items-center p-1 leading-none rounded-lg',
          'transition-[background-color,color] duration-200',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-intents-ux-action-borderColor',
          {
            'bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor':
              active,
            'bg-transparent hover:cursor-pointer hover:bg-intents-ux-actionHovered-backgroundColor':
              !active,
          },
        )}
      >
        <span className="relative inline-flex shrink-0 items-center justify-center size-2.5">
          <span
            aria-hidden="true"
            className={clsx(
              'absolute inset-0 flex items-center justify-center transition-opacity duration-150',
              showCloseOnIcon &&
                (active
                  ? 'opacity-100 group-hover:opacity-0 group-has-[button:focus-visible]:opacity-0'
                  : 'opacity-100 group-hover:opacity-0 group-focus-within:opacity-0'),
            )}
          >
            {icon}
          </span>
          {showCloseOnIcon && (
            <button
              type="button"
              aria-label={closeLabel}
              onClick={handleClose}
              data-testid={testId ? `${testId}-close` : undefined}
              className={clsx(
                'absolute inset-0 flex items-center justify-center transition-opacity duration-150',
                'cursor-pointer bg-transparent border-0 p-0',
                'opacity-0 pointer-events-none',
                'group-hover:opacity-100 group-hover:pointer-events-auto',
                'focus-visible:opacity-100 focus-visible:pointer-events-auto',
                !active &&
                  'group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
              )}
            >
              <XIcon className="size-2.5" />
            </button>
          )}
        </span>

        <span
          aria-hidden={!showLabel}
          className={clsx(
            'inline-block text-sm whitespace-nowrap overflow-hidden',
            'transition-[max-width,opacity,margin] duration-150 ease-out',
            showLabel ? 'max-w-[240px] opacity-100 mx-0.5' : 'max-w-0 opacity-0 mx-0',
          )}
        >
          {label}
        </span>
      </div>
      {collapseLabel && showTooltip && (
        <HeaderTooltip anchorRef={tabRef} label={label} />
      )}
    </>
  )
}
