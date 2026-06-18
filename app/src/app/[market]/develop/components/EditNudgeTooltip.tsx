'use client'

import { type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { useTranslations } from '@/hooks/useTranslations'

interface EditNudgeTooltipProps {
  anchorRef: RefObject<HTMLElement | null>
  placement: 'bottom' | 'top'
}

export function EditNudgeTooltip({ anchorRef, placement }: EditNudgeTooltipProps) {
  const t = useTranslations()
  const anchor = anchorRef.current
  if (!anchor) return null

  const rect = anchor.getBoundingClientRect()
  const style =
    placement === 'bottom'
      ? { top: rect.bottom, left: rect.left + rect.width / 2, transform: 'translateX(-50%)' }
      : { bottom: window.innerHeight - rect.top, left: rect.left + rect.width / 2, transform: 'translateX(-50%)' }

  const arrow = (
    <div
      className="mx-auto w-0 h-0"
      style={
        placement === 'bottom'
          ? { borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '6px solid var(--color-ai)' }
          : { borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '6px solid var(--color-ai)' }
      }
    />
  )

  return createPortal(
    <div className="fixed z-[9999]" style={style}>
      {placement === 'bottom' && arrow}
      <div className="px-3 py-1.5 text-base font-medium whitespace-nowrap rounded-md shadow-lg" style={{ backgroundColor: 'var(--color-ai)', color: '#fff' }}>
        {t('builder_edit_nudge_tooltip', undefined, 'Switch to Edit to make changes')}
      </div>
      {placement === 'top' && arrow}
    </div>,
    document.body,
  )
}
