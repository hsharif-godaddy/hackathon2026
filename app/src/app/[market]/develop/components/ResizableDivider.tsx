'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

function isRtl(el: HTMLElement | null): boolean {
  return el ? getComputedStyle(el).direction === 'rtl' : false
}

function buildPlaceholderStyle(style?: React.CSSProperties): React.CSSProperties {
  const sizing: React.CSSProperties = {
    width: '16px',
    marginInlineStart: '-8px',
  }
  if (!style) {
    return sizing
  }
  const { left, insetInlineStart, ...rest } = style
  if (insetInlineStart !== undefined) {
    return { ...rest, insetInlineStart, ...sizing }
  }
  if (left !== undefined) {
    return { ...rest, insetInlineStart: left, ...sizing }
  }
  return { ...rest, ...sizing }
}

interface ResizableDividerProps {
  onResize: (leftWidth: number) => void
  minLeftWidth?: number
  minRightWidth?: number
  style?: React.CSSProperties
}

export default function ResizableDivider({
  onResize,
  minLeftWidth = 300,
  minRightWidth = 400,
  style,
}: ResizableDividerProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [dividerPosition, setDividerPosition] = useState({ left: 0, top: 0, height: 0 })
  const isDraggingRef = useRef(false)
  const placeholderRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Mark as mounted for portal
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Track placeholder position and update portal position
  useEffect(() => {
    if (placeholderRef.current) {
      containerRef.current = placeholderRef.current.parentElement as HTMLDivElement
    }

    const updatePosition = () => {
      if (!placeholderRef.current) return

      const rect = placeholderRef.current.getBoundingClientRect()
      setDividerPosition({
        left: rect.left + rect.width / 2, // Center of the placeholder
        top: rect.top,
        height: rect.height,
      })
    }

    updatePosition()

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, { passive: true })
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition)
    }
  }, [style?.left, style?.insetInlineStart])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingRef.current = true
    setIsDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const updateWidth = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const containerWidth = containerRect.width
      const rtl = isRtl(containerRef.current)
      const rawWidth = rtl
        ? containerRect.right - clientX
        : clientX - containerRect.left

      const maxLeftWidth = containerWidth - minRightWidth
      const constrainedWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, rawWidth))

      onResize(constrainedWidth)
    },
    [minLeftWidth, minRightWidth, onResize]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingRef.current) return

      // Throttle updates using requestAnimationFrame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        updateWidth(e.clientX)
      })
    },
    [updateWidth]
  )

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return

    isDraggingRef.current = false
    setIsDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  // Global mouse events for smooth dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true })
      document.addEventListener('mouseup', handleMouseUp, { passive: true, capture: true })

      const handleBlur = () => handleMouseUp()
      const handleVisibilityChange = () => {
        if (document.hidden) handleMouseUp()
      }

      window.addEventListener('blur', handleBlur)
      document.addEventListener('visibilitychange', handleVisibilityChange)

      const preventContextMenu = (e: Event) => e.preventDefault()
      document.addEventListener('contextmenu', preventContextMenu, { capture: true })

      return () => {
        document.removeEventListener('mousemove', handleMouseMove, { capture: true })
        document.removeEventListener('mouseup', handleMouseUp, { capture: true })
        window.removeEventListener('blur', handleBlur)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        document.removeEventListener('contextmenu', preventContextMenu, { capture: true })
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Prevent text selection during drag
  useEffect(() => {
    if (isDragging) {
      const preventSelection = (e: Event) => e.preventDefault()
      document.addEventListener('selectstart', preventSelection, { passive: false })
      return () => document.removeEventListener('selectstart', preventSelection)
    }
  }, [isDragging])

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  return (
    <>
      {/* Invisible placeholder in layout - this reserves space and tracks position */}
      <div
        ref={placeholderRef}
        className="absolute top-2 bottom-2 pointer-events-none"
        style={buildPlaceholderStyle(style)}
      />

      {/* Portal: Renders divider at end of document body (naturally on top, no z-index, modals attach later in document so no stacking issue) */}
      {isMounted &&
        createPortal(
          <>
            {/* Transparent overlay during drag - prevents iframe/input interference */}
            {isDragging && (
              <div
                className="fixed inset-0"
                style={{
                  cursor: 'col-resize',
                  background: 'transparent',
                }}
              />
            )}

            {/* Draggable divider - positioned at center of placeholder */}
            <div
              className="fixed flex items-center justify-center cursor-col-resize group"
              onMouseDown={handleMouseDown}
              style={{
                left: dividerPosition.left,
                top: dividerPosition.top,
                width: '16px',
                height: dividerPosition.height,
                transform: 'translateX(-50%)', // Center on the position
              }}
            >
              {/* Visual line - flexbox centers this within the 16px hit area */}
              <div className="w-0.5 h-full bg-transparent rounded-lg transition-colors duration-200 group-hover:bg-border group-active:bg-border" />
            </div>
          </>,
          document.body
        )}
    </>
  )
}
