'use client'

import { animate, AnimatePresence, motion, type Transition, useMotionValue, useTransform } from 'framer-motion'
import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CommanderPosition } from '@/app/[market]/commander/types'
import { PILL_MAX_HEIGHT, useCommanderStore, useEffectiveCommanderPosition } from '@/stores/useCommanderStore'
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
  FLOATING_WIDTH_LARGE: 680,
}

const VERTICAL_INSET = 8
const PILL_TOP_PADDING = 24
const PILL_BORDER_HEIGHT = 2
const PILL_HALO_INSET = 8
const PILL_INNER_BORDER_RADIUS = 16
const PILL_OUTER_BORDER_RADIUS = PILL_INNER_BORDER_RADIUS + PILL_HALO_INSET

interface CommanderProps {
  appId: string | null
  chatPane: ReactNode
}

export function Commander({ appId, chatPane }: CommanderProps) {
  const position = useEffectiveCommanderPosition()
  const pillHeight = useCommanderStore((state) => state.pillHeight)
  const setPillHeight = useCommanderStore((state) => state.setPillHeight)
  const isCollapsed = useCommanderStore((state) => state.isCollapsed)
  const setIsCollapsed = useCommanderStore((state) => state.setIsCollapsed)

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
  const [isResizing, setIsResizing] = useState(false)
  const collapsedTarget = Math.min(
    nonMessagesHeight + PILL_TOP_PADDING + PILL_BORDER_HEIGHT - 1, // otherwise we see a tiny bit of content overlap
    dockHeight,
  )
  const expandedTarget = Math.min(Math.max(pillHeight, collapsedTarget), dockHeight)
  // setNonMessagesHeight is stable (useState setter), so the context value's identity
  // never changes — ChatPane's ResizeObserver effect won't re-attach on every render.
  const layoutContext = useMemo<CommanderLayoutContextValue>(
    () => ({ reportNonMessagesHeight: setNonMessagesHeight }),
    [],
  )

  const targetHeight = isLeftDock
    ? dockHeight
    : isCollapsed && nonMessagesHeight > 0
      ? collapsedTarget
      : expandedTarget

  const floatingWidth = Math.min(
    COMMANDER_LAYOUT_METRICS.FLOATING_WIDTH_LARGE,
    viewport.width - 2 * COMMANDER_LAYOUT_METRICS.FLOATING_INSET - 2 * PILL_HALO_INSET,
  )

  const heightMv = useMotionValue(targetHeight)
  const outerHeightMv = useTransform(heightMv, (height) =>
    isPill ? height + PILL_HALO_INSET * 2 : height,
  )
  const animationRef = useRef<ReturnType<typeof animate> | null>(null)

  useEffect(() => {
    if (isResizing) return
    animationRef.current = animate(heightMv, targetHeight, POSITION_TRANSITION)
    return () => animationRef.current?.stop()
  }, [targetHeight, heightMv, isResizing])

  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)
  const dragStartedCollapsedRef = useRef(false)
  const isDraggingRef = useRef(false)

  const handleResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    animationRef.current?.stop()
    isDraggingRef.current = true
    dragStartYRef.current = e.clientY
    dragStartHeightRef.current = heightMv.get()
    dragStartedCollapsedRef.current = isCollapsed
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [heightMv, isCollapsed])

  const handleResizePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    const deltaY = dragStartYRef.current - e.clientY
    if (deltaY !== 0) setIsResizing(true)
    const next = dragStartHeightRef.current + deltaY
    const minHeight = collapsedTarget
    const maxHeight = Math.min(PILL_MAX_HEIGHT, dockHeight)
    heightMv.set(Math.max(minHeight, Math.min(maxHeight, next)))
  }, [heightMv, collapsedTarget, dockHeight])

  const handleResizePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Pointer may already be released (NotFoundError); commit the snap anyway.
    }
    const currentHeight = heightMv.get()
    const startedCollapsed = dragStartedCollapsedRef.current
    if (startedCollapsed) {
      // From collapsed: any upward movement = intent to expand. Tap with no movement = stay collapsed.
      // Don't overwrite pillHeight — animate back to the user's saved expanded preference.
      if (currentHeight > collapsedTarget) {
        setIsCollapsed(false)
      } else {
        setIsCollapsed(true)
      }
    } else {
      const expandedAnchor = Math.max(expandedTarget, collapsedTarget)
      const midpoint = (collapsedTarget + expandedAnchor) / 2
      if (currentHeight < midpoint) {
        setIsCollapsed(true)
      } else {
        setIsCollapsed(false)
        setPillHeight(currentHeight)
      }
    }
    setIsResizing(false)
  }, [heightMv, collapsedTarget, expandedTarget, setIsCollapsed, setPillHeight])

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
          width: floatingWidth + PILL_HALO_INSET * 2,
          borderRadius: PILL_OUTER_BORDER_RADIUS,
          boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
        }
      : {
          bottom: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
          left: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
          right: 'auto',
          x: 0,
          width: COMMANDER_LAYOUT_METRICS.FLOATING_WIDTH + PILL_HALO_INSET * 2,
          borderRadius: PILL_OUTER_BORDER_RADIUS,
          boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
        }

  const asideSurfaceClass = isPill
    ? 'pointer-events-none overflow-hidden bg-intents-ux-boxLowContrastOverlay-backgroundColor/60 backdrop-blur-[12px] p-2'
    : 'bg-intents-ux-boxLowContrast-backgroundColor border border-intents-ux-boxLowContrast-borderColor'

  const innerSurfaceClass = isPill
    ? 'pointer-events-auto bg-intents-ux-boxLowContrast-backgroundColor border border-intents-ux-boxLowContrast-borderColor'
    : ''

  return (
    <CommanderLayoutContext.Provider value={layoutContext}>
      <motion.aside
        data-testid="commander-panel"
        data-position={position}
        aria-label="Commander"
        className={`absolute z-1 flex flex-col ${asideSurfaceClass}`}
        initial={false}
        animate={animateProps}
        transition={POSITION_TRANSITION}
        style={{ top: 'auto', height: isPill ? outerHeightMv : heightMv }}
      >
        <div
          className={`relative flex flex-col min-h-0 overflow-hidden h-full w-full ${innerSurfaceClass}`}
          style={isPill ? { borderRadius: PILL_INNER_BORDER_RADIUS } : undefined}
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
          <div
            className="flex-1 min-h-0 flex flex-col pe-2"
            style={isPill ? { paddingTop: PILL_TOP_PADDING } : undefined}
          >
            {chatPane}
          </div>
        </div>
      </motion.aside>
    </CommanderLayoutContext.Provider>
  )
}
