'use client'

import { AnimatePresence, motion } from 'framer-motion'

import { SnapTarget } from '@/app/[market]/commander/types'

interface CommanderSnapOverlayProps {
  active: boolean
  target: SnapTarget
  pillHeight: number
  inset: number
  sideWidth: number
  centerWidth: number
  dockZoneWidth: number
}

const ZONE_TRANSITION = { duration: 0.12, ease: 'easeOut' as const }

export function CommanderSnapOverlay({
  active,
  target,
  pillHeight,
  inset,
  sideWidth,
  centerWidth,
  dockZoneWidth,
}: CommanderSnapOverlayProps) {
  const zoneStyle: React.CSSProperties = (() => {
    if (target === SnapTarget.LeftDock) {
      return { top: inset, bottom: inset, left: 0, width: dockZoneWidth }
    }
    if (target === SnapTarget.BottomLeft) {
      return { left: inset, bottom: inset, width: sideWidth, height: pillHeight }
    }
    if (target === SnapTarget.BottomRight) {
      return { right: inset, bottom: inset, width: sideWidth, height: pillHeight }
    }
    return { left: '50%', bottom: inset, width: centerWidth, height: pillHeight }
  })()
  const motionX = target === SnapTarget.BottomCenter ? '-50%' : 0

  return (
    <div className="pointer-events-none absolute inset-0 z-[60]" data-testid="commander-snap-overlay">
      <AnimatePresence>
        {active && (
          <motion.div
            key={target}
            data-testid={`commander-snap-zone-${target}`}
            data-active="true"
            className="pointer-events-none absolute border-2 border-dashed rounded-2xl border-ai"
            style={zoneStyle}
            initial={{ opacity: 0, scale: 0.96, x: motionX }}
            animate={{ opacity: 1, scale: 1, x: motionX }}
            exit={{ opacity: 0, scale: 0.96, x: motionX }}
            transition={ZONE_TRANSITION}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
