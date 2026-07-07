'use client'

import { type RefObject, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useTranslations } from '@/hooks/useTranslations'

interface Position {
  left: number
  top: number
  arrowLeft: number
}

interface PreviewNudgeTooltipProps {
  anchorRef: RefObject<HTMLElement | null>
  visible: boolean
}

export function PreviewNudgeTooltip({ anchorRef, visible }: PreviewNudgeTooltipProps) {
  const t = useTranslations()
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<Position>({ left: 0, top: 0, arrowLeft: 0 })

  useEffect(() => {
    if (!visible) return

    let frameId: number | null = null
    const anchorGap: number = 8
    const viewportPadding: number = 8

    const update = function update() {
      const anchor = anchorRef.current
      const tooltip = tooltipRef.current

      if (!anchor || !tooltip) {
        frameId = requestAnimationFrame(update)
        return
      }

      const rect: DOMRect = anchor.getBoundingClientRect()
      const tooltipWidth: number = tooltip.offsetWidth
      const tooltipHeight: number = tooltip.offsetHeight
      const anchorCenterLeft: number = rect.left + (rect.width / 2)
      const centeredLeft: number = anchorCenterLeft - (tooltipWidth / 2)
      const clampedLeft: number = Math.min(
        Math.max(centeredLeft, viewportPadding),
        window.innerWidth - tooltipWidth - viewportPadding,
      )
      const preferredTop: number = rect.bottom + anchorGap
      const clampedTop: number = Math.min(
        Math.max(preferredTop, viewportPadding),
        window.innerHeight - tooltipHeight - viewportPadding,
      )
      const nextLeft: number = Math.round(clampedLeft)
      const nextTop: number = Math.round(clampedTop)
      const unclampedArrowLeft: number = Math.round(anchorCenterLeft - clampedLeft)
      const nextArrowLeft: number = Math.min(
        Math.max(unclampedArrowLeft, 10),
        Math.max(tooltipWidth - 10, 10),
      )

      setPosition((previous) => {
        if (previous.left === nextLeft && previous.top === nextTop && previous.arrowLeft === nextArrowLeft) {
          return previous
        }
        return { left: nextLeft, top: nextTop, arrowLeft: nextArrowLeft }
      })

      frameId = requestAnimationFrame(update)
    }

    frameId = requestAnimationFrame(update)

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [anchorRef, visible])

  if (!visible) return null

  return createPortal(
    <div ref={tooltipRef} className="fixed z-[9999]" style={{ left: position.left, top: position.top }}>
      <div className="relative">
        <div
          className="absolute top-0 h-0 w-0 border-s-[6px] border-s-transparent border-e-[6px] border-e-transparent border-b-[6px]"
          style={{ left: position.arrowLeft, transform: 'translateX(-50%)', borderBottomColor: '#000000' }}
        />
      </div>
      <div
        className="mt-[6px] whitespace-nowrap rounded-md px-2 py-1 text-sm shadow-lg"
        style={{ backgroundColor: '#000000', color: '#ffffff', opacity: 1 }}
      >
        {t('builder_mobile_preview_nudge_tooltip', undefined, 'Watch your project build')}
      </div>
    </div>,
    document.body,
  )
}
