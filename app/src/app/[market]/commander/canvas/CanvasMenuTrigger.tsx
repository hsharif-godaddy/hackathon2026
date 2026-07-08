'use client'

import clsx from 'clsx'
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'
import PlusIcon from '@ux/icon/plus'

import { canvasTabSurfaceClassName, CanvasTabSurfaceContent } from './CanvasTabSurface'

interface CanvasMenuTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  open: boolean
  label: ReactNode
  onOpenClick?: () => void
}

export const CanvasMenuTrigger = forwardRef<HTMLButtonElement, CanvasMenuTriggerProps>(
  function CanvasMenuTrigger({ open, label, onOpenClick, className, onClick, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={canvasTabSurfaceClassName(open, clsx('cursor-pointer border-0', className))}
        onClick={(event) => {
          onOpenClick?.()
          onClick?.(event)
        }}
        {...props}
      >
        <CanvasTabSurfaceContent
          icon={<PlusIcon className="size-2.5" />}
          label={label}
        />
      </button>
    )
  },
)
