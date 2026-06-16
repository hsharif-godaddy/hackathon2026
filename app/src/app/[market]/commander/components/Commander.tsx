'use client'

import { animate, AnimatePresence, motion, type Transition, useMotionValue } from 'framer-motion'
import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CommanderPosition } from '@/app/[market]/commander/types'
import { clampPillHeight, useCommanderStore, useEffectiveCommanderPosition } from '@/stores/useCommanderStore'
import { CommanderLayoutContext, type CommanderLayoutContextValue } from './CommanderLayoutContext'
import { CommanderLogo } from './CommanderLogo'

const POSITION_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 280,
  damping: 32,
  mass: 0.9,
}

export const COMMANDER_LAYOUT_METRICS = {
  LEFT_DOCK_WIDTH: 406,
  FLOATING_INSET: 8,
  FLOATING_WIDTH: 380,
  FLOATING_WIDTH_LARGE: 600,
}

const VERTICAL_INSET = 8
const PILL_TOP_PADDING = 10
const MIN_MESSAGES_AREA = 80

interface CommanderProps {
  appId: string | null
  chatPane: ReactNode
}

export function Commander({ appId, chatPane }: CommanderProps) {
  const position = useEffectiveCommanderPosition()
  const pillHeight = useCommanderStore((state) => state.pillHeight)
  const setPillHeight = useCommanderStore((state) => state.setPillHeight)

  const isLeftDock = position === CommanderPosition.LeftDock
  const isFloating = position === CommanderPosition.Floating
  const isPill = !isLeftDock

  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }))
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const dockHeight = viewport.height - VERTICAL_INSET * 2

  const [nonMessagesHeight, setNonMessagesHeight] = useState(0)
  const layoutContext = useMemo<CommanderLayoutContextValue>(
    () => ({ reportNonMessagesHeight: setNonMessagesHeight }),
    [],
  )

  const effectiveMinPillHeight = Math.min(
    nonMessagesHeight + MIN_MESSAGES_AREA + PILL_TOP_PADDING,
    dockHeight,
  )
  const targetHeight = isLeftDock
    ? dockHeight
    : Math.max(pillHeight, effectiveMinPillHeight)

  const floatingWidth = Math.min(
    COMMANDER_LAYOUT_METRICS.FLOATING_WIDTH_LARGE,
    viewport.width - 2 * COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
  )

  const heightMv = useMotionValue(targetHeight)

  useEffect(() => {
    const controls = animate(heightMv, targetHeight, POSITION_TRANSITION)
    return () => controls.stop()
  }, [targetHeight, heightMv])

  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)
  const isDraggingRef = useRef(false)

  const handleResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragStartYRef.current = e.clientY
    dragStartHeightRef.current = heightMv.get()
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [heightMv])

  const handleResizePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    const deltaY = dragStartYRef.current - e.clientY
    heightMv.set(clampPillHeight(dragStartHeightRef.current + deltaY))
  }, [heightMv])

  const handleResizePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Pointer may already be released (NotFoundError); commit the height anyway.
    }
    setPillHeight(heightMv.get())
  }, [heightMv, setPillHeight])

  const animateProps = isLeftDock
    ? {
        bottom: VERTICAL_INSET,
        left: VERTICAL_INSET,
        right: 'auto',
        x: 0,
        width: COMMANDER_LAYOUT_METRICS.LEFT_DOCK_WIDTH,
        borderRadius: 16,
        boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
      }
    : isFloating
      ? {
          bottom: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
          left: '50%',
          right: 'auto',
          x: '-50%',
          width: floatingWidth,
          borderRadius: 16,
          boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
        }
      : {
          bottom: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
          left: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
          right: 'auto',
          x: 0,
          width: COMMANDER_LAYOUT_METRICS.FLOATING_WIDTH,
          borderRadius: 16,
          boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
        }

  return (
    <CommanderLayoutContext.Provider value={layoutContext}>
      <motion.aside
        data-testid="commander-panel"
        data-position={position}
        aria-label="Commander"
        className="absolute z-1 bg-intents-ux-boxLowContrast-backgroundColor overflow-hidden flex flex-col border border-intents-ux-boxLowContrast-borderColor"
        initial={false}
        animate={animateProps}
        transition={POSITION_TRANSITION}
        style={{ top: 'auto', height: heightMv }}
      >
        {isPill && (
          <div
            data-testid="commander-resize-handle"
            aria-label="Resize Commander"
            className="absolute top-0 left-0 right-0 h-2.5 z-10 cursor-ns-resize touch-none select-none flex items-start justify-center"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
          >
            <div className="mt-1.5 w-4 h-1 rounded-full bg-intents-ux-boxLowContrast-borderColor" />
          </div>
        )}
        <AnimatePresence initial={false}>
          {isLeftDock && (
            <motion.div
              key="commander-internal-logo"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="p-2 shrink-0 flex items-center gap-1.5"
            >
              <CommanderLogo appId={appId} source="commander-panel" />
            </motion.div>
          )}
        </AnimatePresence>
        <div className={`flex-1 min-h-0 flex flex-col pe-2 ${isPill ? 'pt-2.5' : ''}`}>{chatPane}</div>
      </motion.aside>
    </CommanderLayoutContext.Provider>
  )
}
