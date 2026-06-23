'use client'

import clsx from 'clsx'
import { type ReactNode, useState } from 'react'
import XIcon from '@ux/icon/x'

import type { CanvasId } from './registry'

interface CanvasTabProps {
  canvasId: CanvasId
  icon: ReactNode
  label: string
  active: boolean
  /** When false, the close affordance never renders (e.g. pinned Preview tab). */
  dismissible: boolean
  /** When true, the label collapses to icon-only at rest and reveals on hover. */
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
  const [isHovered, setIsHovered] = useState(false)

  const showLabel = active || !collapseLabel || isHovered
  const showCloseOnIcon = !collapseLabel && dismissible && isHovered
  const showCloseAtEnd = collapseLabel && dismissible && isHovered

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose?.()
  }

  return (
    <div
      role="tab"
      aria-selected={active}
      aria-label={label}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid={testId}
      data-canvas-id={canvasId}
      className={clsx(
        'relative flex items-center p-1 leading-none rounded-lg',
        'transition-[background-color,color] duration-200',
        'hover:cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-intents-ux-action-borderColor',
        {
          'bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor':
            active,
          'bg-transparent hover:bg-intents-ux-actionHovered-backgroundColor': !active,
        },
      )}
    >
      <span className="relative inline-flex shrink-0 items-center justify-center size-2.5">
        <span
          aria-hidden={showCloseOnIcon}
          className={clsx(
            'absolute inset-0 flex items-center justify-center transition-opacity duration-150',
            showCloseOnIcon ? 'opacity-0' : 'opacity-100',
          )}
        >
          {icon}
        </span>
        {dismissible && !collapseLabel && (
          <button
            type="button"
            aria-label={closeLabel}
            onClick={handleClose}
            data-testid={testId ? `${testId}-close` : undefined}
            tabIndex={showCloseOnIcon ? 0 : -1}
            className={clsx(
              'absolute inset-0 flex items-center justify-center transition-opacity duration-150',
              'cursor-pointer bg-transparent border-0 p-0',
              showCloseOnIcon ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
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

      {dismissible && collapseLabel && (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={handleClose}
          data-testid={testId ? `${testId}-close` : undefined}
          tabIndex={showCloseAtEnd ? 0 : -1}
          className={clsx(
            'inline-flex shrink-0 items-center justify-center overflow-hidden size-2.5',
            'cursor-pointer bg-transparent border-0 p-0 ml-0.5',
            'transition-[max-width,opacity,margin] duration-150 ease-out',
            showCloseAtEnd
              ? 'max-w-[0.625rem] opacity-100 mr-0.5 pointer-events-auto'
              : 'max-w-0 opacity-0 mr-0 pointer-events-none',
          )}
        >
          <XIcon className="size-2.5" />
        </button>
      )}
    </div>
  )
}
