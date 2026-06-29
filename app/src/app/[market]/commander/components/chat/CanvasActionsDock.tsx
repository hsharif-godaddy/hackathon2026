'use client'

import { motion } from 'framer-motion'
import { type ReactElement, useEffect, useRef, useState } from 'react'

import { CanvasActionsVariant } from '@/app/[market]/commander/canvas/actions'
import { COMMANDER_LAYOUT_METRICS, PILL_HALO_INSET } from '@/app/[market]/commander/components/Commander'
import { CommanderPosition, FloatingAnchor } from '@/app/[market]/commander/types'
import { useCommanderStore, useEffectiveCommanderPosition } from '@/stores/useCommanderStore'
import CanvasActionsHost from './CanvasActionsHost'

interface CanvasActionsDockProps {
  canvasWidth: number
  isReady: boolean
  isLoading: boolean
}

const REMAINING_GUTTER = 20
const DOCK_TRANSITION = { duration: 0.18, ease: [0.4, 0, 0.2, 1] as const }

/**
 * The floating actions bar over the canvas. When docked it sits centered in the
 * full canvas. When the pill floats in a side slot (BottomLeft/BottomRight) the
 * bar floats centered in the canvas space *beside* the pill — but only if that
 * space (minus a 20px gutter each side) fits the bar; otherwise it collapses and
 * the composer's inline bar takes over. A centered floating pill always collapses
 * to the composer. Reports the beside-pill outcome to the store so the inline bar
 * can hide/show accordingly.
 */
export default function CanvasActionsDock({
  canvasWidth,
  isReady,
  isLoading,
}: CanvasActionsDockProps): ReactElement | null {
  const position = useEffectiveCommanderPosition()
  const floatingAnchor = useCommanderStore((state) => state.floatingAnchor)
  const floatingWidth = useCommanderStore((state) => state.floatingWidthByAnchor[floatingAnchor])
  const setActionsBarShownBeside = useCommanderStore((state) => state.setActionsBarShownBeside)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const [barWidth, setBarWidth] = useState(0)

  const isLeftDock = position === CommanderPosition.LeftDock
  const isSideAnchor =
    floatingAnchor === FloatingAnchor.BottomLeft || floatingAnchor === FloatingAnchor.BottomRight
  const active = isReady && !isLoading
  const renderDock = active && (isLeftDock || isSideAnchor)

  const pillOuterWidth = floatingWidth + PILL_HALO_INSET * 2
  const inset = COMMANDER_LAYOUT_METRICS.FLOATING_INSET
  // Always centered in the canvas (aligned with the centered preview content),
  // not in the leftover space beside the pill.
  const centerX = canvasWidth / 2

  // For a side-anchored pill the bar shows only when the canvas-centered bar
  // clears the pill by at least the gutter on the pill's side; otherwise it
  // collapses into the composer.
  let fits = false
  if (isSideAnchor && canvasWidth > 0 && barWidth > 0) {
    const halfBar = barWidth / 2
    if (floatingAnchor === FloatingAnchor.BottomLeft) {
      fits = centerX - halfBar >= inset + pillOuterWidth + REMAINING_GUTTER
    } else {
      const pillLeft = canvasWidth - inset - pillOuterWidth
      fits = centerX + halfBar <= pillLeft - REMAINING_GUTTER
    }
  }

  const visible = renderDock && (isLeftDock || fits)
  const shownBeside = active && !isLeftDock && isSideAnchor && fits

  useEffect(() => {
    setActionsBarShownBeside(shownBeside)
  }, [shownBeside, setActionsBarShownBeside])

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const measure = (): void => setBarWidth(el.offsetWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [renderDock])

  if (!renderDock) return null

  return (
    <motion.div
      ref={wrapperRef}
      className="absolute bottom-3 z-30"
      style={{ left: centerX, x: '-50%', pointerEvents: visible ? 'auto' : 'none' }}
      aria-hidden={visible ? undefined : true}
      initial={false}
      animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.96, y: visible ? 0 : 8 }}
      transition={DOCK_TRANSITION}
    >
      <CanvasActionsHost variant={CanvasActionsVariant.Dock} />
    </motion.div>
  )
}
