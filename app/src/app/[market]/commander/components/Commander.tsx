'use client'

import { animate, AnimatePresence, motion, type Transition, useMotionValue, useTransform } from 'framer-motion'
import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GrabVertIcon from '@ux/icon/grab-vert'

import { CommanderPosition, FloatingAnchor, SnapTarget } from '@/app/[market]/commander/types'
import {
  clampFloatingWidth,
  DEFAULT_FLOATING_WIDTH_BY_ANCHOR,
  PILL_MAX_HEIGHT,
  useCommanderStore,
  useEffectiveCommanderPosition,
} from '@/stores/useCommanderStore'
import { CommanderLayoutContext, type CommanderLayoutContextValue } from './CommanderLayoutContext'
import { CommanderLogo } from './CommanderLogo'
import { CommanderSnapOverlay } from './CommanderSnapOverlay'

const POSITION_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 280,
  damping: 32,
  mass: 0.9,
}

const INSTANT_TRANSITION: Transition = { duration: 0 }

export const COMMANDER_LAYOUT_METRICS = {
  LEFT_DOCK_WIDTH: 406,
  FLOATING_INSET: 8,
}

const VERTICAL_INSET = 8
const PILL_TOP_PADDING = 24
const PILL_BORDER_HEIGHT = 2
const PILL_HALO_INSET = 16
const PILL_INNER_BORDER_RADIUS = 16
const PILL_OUTER_BORDER_RADIUS = PILL_INNER_BORDER_RADIUS + PILL_HALO_INSET
const DRAG_HANDLE_HIT_AREA = 32
const HORIZONTAL_RESIZE_HANDLE_WIDTH = 8
const DOCK_ZONE_WIDTH = 80

interface CommanderProps {
  appId: string | null
  chatPane: ReactNode
}

interface DragStart {
  rect: DOMRect
  clientX: number
  clientY: number
}

interface HorizontalResizeStart {
  edge: 'left' | 'right'
  clientX: number
  startWidth: number
}

function floatingAnchorToSnapTarget(anchor: FloatingAnchor): SnapTarget {
  switch (anchor) {
    case FloatingAnchor.BottomLeft: return SnapTarget.BottomLeft
    case FloatingAnchor.BottomCenter: return SnapTarget.BottomCenter
    case FloatingAnchor.BottomRight: return SnapTarget.BottomRight
  }
}

function snapTargetToFloatingAnchor(target: SnapTarget): FloatingAnchor | null {
  switch (target) {
    case SnapTarget.LeftDock: return null
    case SnapTarget.BottomLeft: return FloatingAnchor.BottomLeft
    case SnapTarget.BottomCenter: return FloatingAnchor.BottomCenter
    case SnapTarget.BottomRight: return FloatingAnchor.BottomRight
  }
}

function nearestSnapTarget(
  clientX: number,
  viewportWidth: number,
  sideZoneOuterWidth: number,
  dockZoneWidth: number,
): SnapTarget {
  if (clientX <= dockZoneWidth) return SnapTarget.LeftDock
  const inset = COMMANDER_LAYOUT_METRICS.FLOATING_INSET
  const leftCenter = inset + sideZoneOuterWidth / 2
  const centerCenter = viewportWidth / 2
  const rightCenter = viewportWidth - inset - sideZoneOuterWidth / 2
  const distances: ReadonlyArray<{ target: SnapTarget; d: number }> = [
    { target: SnapTarget.BottomLeft, d: Math.abs(clientX - leftCenter) },
    { target: SnapTarget.BottomCenter, d: Math.abs(clientX - centerCenter) },
    { target: SnapTarget.BottomRight, d: Math.abs(clientX - rightCenter) },
  ]
  return distances.reduce((best, cur) => (cur.d < best.d ? cur : best)).target
}

export function Commander({ appId, chatPane }: CommanderProps) {
  const position = useEffectiveCommanderPosition()
  const pillHeight = useCommanderStore((state) => state.pillHeight)
  const setPillHeight = useCommanderStore((state) => state.setPillHeight)
  const isCollapsed = useCommanderStore((state) => state.isCollapsed)
  const setIsCollapsed = useCommanderStore((state) => state.setIsCollapsed)
  const floatingAnchor = useCommanderStore((state) => state.floatingAnchor)
  const setFloatingAnchor = useCommanderStore((state) => state.setFloatingAnchor)
  const floatingWidthByAnchor = useCommanderStore((state) => state.floatingWidthByAnchor)
  const setFloatingWidth = useCommanderStore((state) => state.setFloatingWidth)
  const resetFloatingWidth = useCommanderStore((state) => state.resetFloatingWidth)
  const setPosition = useCommanderStore((state) => state.setPosition)

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
    nonMessagesHeight + PILL_TOP_PADDING + PILL_BORDER_HEIGHT - 1,
    dockHeight,
  )
  const expandedTarget = Math.min(Math.max(pillHeight, collapsedTarget), dockHeight)
  const layoutContext = useMemo<CommanderLayoutContextValue>(
    () => ({ reportNonMessagesHeight: setNonMessagesHeight }),
    [],
  )

  const targetHeight = isLeftDock
    ? dockHeight
    : isCollapsed && nonMessagesHeight > 0
      ? collapsedTarget
      : expandedTarget

  const minFloatingWidth = DEFAULT_FLOATING_WIDTH_BY_ANCHOR[floatingAnchor]
  const maxFloatingWidth = Math.max(
    minFloatingWidth,
    viewport.width - 2 * COMMANDER_LAYOUT_METRICS.FLOATING_INSET - 2 * PILL_HALO_INSET,
  )
  const persistedFloatingWidth = floatingWidthByAnchor[floatingAnchor]
  const floatingWidth = clampFloatingWidth(persistedFloatingWidth, minFloatingWidth, maxFloatingWidth)

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
      // Pointer may already be released; commit the snap anyway.
    }
    const currentHeight = heightMv.get()
    const startedCollapsed = dragStartedCollapsedRef.current
    if (startedCollapsed) {
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

  const pillRef = useRef<HTMLElement | null>(null)
  const dragStartRef = useRef<DragStart | null>(null)
  const [isDraggingPill, setIsDraggingPill] = useState(false)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [pendingTarget, setPendingTarget] = useState<SnapTarget>(
    floatingAnchorToSnapTarget(floatingAnchor),
  )

  const handleDragPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const pill = pillRef.current
    if (!pill) return
    const realRect = pill.getBoundingClientRect()
    const startedInDock = isLeftDock
    const floatingOuterWidth = floatingWidth + PILL_HALO_INSET * 2
    const floatingOuterHeight = expandedTarget + PILL_HALO_INSET * 2
    const rect = startedInDock
      ? new DOMRect(realRect.left, realRect.top, floatingOuterWidth, floatingOuterHeight)
      : realRect
    dragStartRef.current = {
      rect,
      clientX: e.clientX,
      clientY: e.clientY,
    }
    setIsDraggingPill(true)
    setDragOffset({ x: 0, y: 0 })
    setPendingTarget(startedInDock ? SnapTarget.LeftDock : floatingAnchorToSnapTarget(floatingAnchor))
    if (startedInDock) setPosition(CommanderPosition.Floating)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [isLeftDock, floatingAnchor, floatingWidth, expandedTarget, setPosition])

  const sideZoneOuterWidth =
    DEFAULT_FLOATING_WIDTH_BY_ANCHOR[FloatingAnchor.BottomLeft] + PILL_HALO_INSET * 2
  const centerZoneOuterWidth =
    DEFAULT_FLOATING_WIDTH_BY_ANCHOR[FloatingAnchor.BottomCenter] + PILL_HALO_INSET * 2

  const handleDragPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start) return
    setDragOffset({ x: e.clientX - start.clientX, y: e.clientY - start.clientY })
    setPendingTarget(nearestSnapTarget(e.clientX, viewport.width, sideZoneOuterWidth, DOCK_ZONE_WIDTH))
  }, [viewport.width, sideZoneOuterWidth])

  const handleDragPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // pointer may already be released
    }
    const previousAnchor = floatingAnchor
    dragStartRef.current = null
    setIsDraggingPill(false)
    setDragOffset({ x: 0, y: 0 })
    if (pendingTarget === SnapTarget.LeftDock) {
      if (!isLeftDock) setPosition(CommanderPosition.LeftDock)
    } else {
      const newAnchor = snapTargetToFloatingAnchor(pendingTarget)
      if (newAnchor) {
        if (isLeftDock) setPosition(CommanderPosition.Floating)
        if (newAnchor !== previousAnchor) {
          setFloatingAnchor(newAnchor)
          resetFloatingWidth(newAnchor)
        }
      }
    }
  }, [isLeftDock, floatingAnchor, pendingTarget, setFloatingAnchor, resetFloatingWidth, setPosition])

  const horizontalResizeRef = useRef<HorizontalResizeStart | null>(null)
  const [isHResizing, setIsHResizing] = useState(false)

  const handleHResizePointerDown = useCallback(
    (edge: 'left' | 'right') => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      horizontalResizeRef.current = {
        edge,
        clientX: e.clientX,
        startWidth: floatingWidth,
      }
      setIsHResizing(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [floatingWidth],
  )

  const handleHResizePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const r = horizontalResizeRef.current
    if (!r) return
    const delta = e.clientX - r.clientX
    let widthDelta: number
    if (floatingAnchor === FloatingAnchor.BottomCenter) {
      widthDelta = r.edge === 'right' ? delta * 2 : -delta * 2
    } else if (floatingAnchor === FloatingAnchor.BottomLeft) {
      widthDelta = delta
    } else {
      widthDelta = -delta
    }
    const next = clampFloatingWidth(r.startWidth + widthDelta, minFloatingWidth, maxFloatingWidth)
    setFloatingWidth(floatingAnchor, next)
  }, [floatingAnchor, minFloatingWidth, maxFloatingWidth, setFloatingWidth])

  const handleHResizePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!horizontalResizeRef.current) return
    horizontalResizeRef.current = null
    setIsHResizing(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // pointer may already be released
    }
  }, [])

  const animateProps = (() => {
    if (isDraggingPill && dragStartRef.current) {
      const { rect } = dragStartRef.current
      return {
        bottom: 'auto' as const,
        right: 'auto' as const,
        top: rect.top + dragOffset.y,
        left: rect.left + dragOffset.x,
        x: 0,
        width: rect.width,
        borderRadius: PILL_OUTER_BORDER_RADIUS,
        boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
      }
    }
    if (isLeftDock) {
      return {
        top: 'auto' as const,
        bottom: VERTICAL_INSET,
        left: VERTICAL_INSET,
        right: 'auto' as const,
        x: 0,
        width: COMMANDER_LAYOUT_METRICS.LEFT_DOCK_WIDTH,
        borderRadius: 16,
        boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
      }
    }
    const outerWidth = floatingWidth + PILL_HALO_INSET * 2
    if (floatingAnchor === FloatingAnchor.BottomCenter) {
      return {
        top: 'auto' as const,
        bottom: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
        left: '50%',
        right: 'auto' as const,
        x: '-50%',
        width: outerWidth,
        borderRadius: PILL_OUTER_BORDER_RADIUS,
        boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
      }
    }
    if (floatingAnchor === FloatingAnchor.BottomLeft) {
      return {
        top: 'auto' as const,
        bottom: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
        left: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
        right: 'auto' as const,
        x: 0,
        width: outerWidth,
        borderRadius: PILL_OUTER_BORDER_RADIUS,
        boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
      }
    }
    return {
      top: 'auto' as const,
      bottom: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
      left: 'auto' as const,
      right: COMMANDER_LAYOUT_METRICS.FLOATING_INSET,
      x: 0,
      width: outerWidth,
      borderRadius: PILL_OUTER_BORDER_RADIUS,
      boxShadow: '0 12px 40px -8px rgba(15, 23, 42, 0.35)',
    }
  })()

  const transitionProp = isDraggingPill || isHResizing ? INSTANT_TRANSITION : POSITION_TRANSITION

  const asideSurfaceClass = isPill
    ? 'pointer-events-none overflow-hidden bg-intents-ux-boxLowContrastOverlay-backgroundColor/60 backdrop-blur-[12px] p-2'
    : 'bg-intents-ux-boxLowContrast-backgroundColor border border-intents-ux-boxLowContrast-borderColor'

  const innerSurfaceClass = isPill
    ? 'pointer-events-auto bg-intents-ux-boxLowContrast-backgroundColor border border-intents-ux-boxLowContrast-borderColor'
    : ''

  const showLeftHResizeHandle =
    isFloating &&
    (floatingAnchor === FloatingAnchor.BottomCenter || floatingAnchor === FloatingAnchor.BottomRight)
  const showRightHResizeHandle =
    isFloating &&
    (floatingAnchor === FloatingAnchor.BottomCenter || floatingAnchor === FloatingAnchor.BottomLeft)

  return (
    <CommanderLayoutContext.Provider value={layoutContext}>
      <CommanderSnapOverlay
        active={isDraggingPill}
        target={pendingTarget}
        pillHeight={dragStartRef.current?.rect.height ?? targetHeight + PILL_HALO_INSET * 2}
        inset={COMMANDER_LAYOUT_METRICS.FLOATING_INSET}
        sideWidth={sideZoneOuterWidth}
        centerWidth={centerZoneOuterWidth}
        dockZoneWidth={DOCK_ZONE_WIDTH}
      />
      <motion.aside
        ref={pillRef}
        data-testid="commander-panel"
        data-position={position}
        data-floating-anchor={isFloating ? floatingAnchor : undefined}
        aria-label="Commander"
        className={`absolute flex flex-col ${asideSurfaceClass}`}
        initial={false}
        animate={animateProps}
        transition={transitionProp}
        style={{ height: isPill ? outerHeightMv : heightMv }}
      >
        <div
          className={`relative flex flex-col min-h-0 overflow-hidden h-full w-full ${innerSurfaceClass}`}
          style={isPill ? { borderRadius: PILL_INNER_BORDER_RADIUS } : undefined}
        >
          {isPill && (
            <div
              data-testid="commander-resize-handle"
              aria-label="Resize Commander"
              className="absolute top-0 left-0 z-10 cursor-ns-resize touch-none select-none flex items-start justify-center"
              style={{ right: DRAG_HANDLE_HIT_AREA, height: 10 }}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={handleResizePointerUp}
              onPointerCancel={handleResizePointerUp}
            >
              <div className="mt-1.5 w-4 h-1 rounded-full bg-intents-ux-boxLowContrast-borderColor" />
            </div>
          )}
          <div
            data-testid="commander-drag-handle"
            aria-label="Drag Commander to reposition"
            role="button"
            className="absolute top-0 right-0 z-20 cursor-grab active:cursor-grabbing touch-none select-none flex items-center justify-center text-intents-ux-textSubtle-textColor hover:text-intents-ux-text-textColor"
            style={{ width: DRAG_HANDLE_HIT_AREA, height: DRAG_HANDLE_HIT_AREA }}
            onPointerDown={handleDragPointerDown}
            onPointerMove={handleDragPointerMove}
            onPointerUp={handleDragPointerUp}
            onPointerCancel={handleDragPointerUp}
          >
            <GrabVertIcon className="size-2!" />
          </div>
          {showLeftHResizeHandle && (
            <div
              data-testid="commander-h-resize-handle-left"
              aria-label="Resize Commander width"
              className="absolute top-0 bottom-0 z-10 cursor-ew-resize touch-none select-none"
              style={{ left: 0, width: HORIZONTAL_RESIZE_HANDLE_WIDTH }}
              onPointerDown={handleHResizePointerDown('left')}
              onPointerMove={handleHResizePointerMove}
              onPointerUp={handleHResizePointerUp}
              onPointerCancel={handleHResizePointerUp}
            />
          )}
          {showRightHResizeHandle && (
            <div
              data-testid="commander-h-resize-handle-right"
              aria-label="Resize Commander width"
              className="absolute top-0 bottom-0 z-10 cursor-ew-resize touch-none select-none"
              style={{ right: 0, width: HORIZONTAL_RESIZE_HANDLE_WIDTH }}
              onPointerDown={handleHResizePointerDown('right')}
              onPointerMove={handleHResizePointerMove}
              onPointerUp={handleHResizePointerUp}
              onPointerCancel={handleHResizePointerUp}
            />
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
