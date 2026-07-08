'use client'

import clsx from 'clsx'
import { type ReactNode, useRef, useState } from 'react'
import XIcon from '@ux/icon/x'

import { HeaderTooltip } from '@/components/ui/HeaderTooltip'
import { canvasTabSurfaceClassName, CanvasTabSurfaceContent } from './CanvasTabSurface'
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
  /** Optional badge (e.g. inbox unresolved count) overhanging the icon's top-right corner. */
  cornerBadge?: ReactNode
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
  cornerBadge,
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
        className={canvasTabSurfaceClassName(active)}
      >
        <CanvasTabSurfaceContent
          showLabel={showLabel}
          labelAriaHidden={!showLabel}
          label={label}
          cornerBadge={cornerBadge}
          icon={
            <>
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
            </>
          }
        />
      </div>
      {collapseLabel && showTooltip && (
        <HeaderTooltip anchorRef={tabRef} label={label} />
      )}
    </>
  )
}
