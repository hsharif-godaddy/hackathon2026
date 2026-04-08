'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
  const isDraggingRef = useRef(false)
  const dividerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Find the container element on mount
  useEffect(() => {
    if (dividerRef.current) {
      containerRef.current = dividerRef.current.parentElement as HTMLDivElement
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingRef.current = true
    setIsDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const updateWidth = useCallback((clientX: number) => {
    if (!containerRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const containerWidth = containerRect.width
    const newLeftWidth = clientX - containerRect.left

    // Calculate dynamic max width based on container size
    const maxLeftWidth = containerWidth - minRightWidth

    // Apply constraints
    const constrainedWidth = Math.max(
      minLeftWidth,
      Math.min(maxLeftWidth, newLeftWidth)
    )

    onResize(constrainedWidth)
  }, [minLeftWidth, minRightWidth, onResize])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return

    // Throttle updates using requestAnimationFrame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      updateWidth(e.clientX)
    })
  }, [updateWidth])

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
      // Use capture phase to catch events even over iframes and other elements
      document.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true })
      document.addEventListener('mouseup', handleMouseUp, { passive: true, capture: true })

      // Stop dragging if window loses focus or visibility
      const handleBlur = () => handleMouseUp()
      const handleVisibilityChange = () => {
        if (document.hidden) handleMouseUp()
      }

      window.addEventListener('blur', handleBlur)
      document.addEventListener('visibilitychange', handleVisibilityChange)

      // Prevent context menu during drag
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
      {/* Transparent overlay during dragging to prevent iframe interaction */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50"
          style={{
            cursor: 'col-resize',
            // Transparent but blocks pointer events to iframes
            background: 'transparent',
          }}
        />
      )}

      <div
        ref={dividerRef}
        className="absolute top-2 bottom-2 z-10 cursor-col-resize flex-shrink-0 group"
        onMouseDown={handleMouseDown}
        style={{
          ...style,
          // Wider hit area for easier grabbing (centered on position)
          width: '16px',
          transform: 'translateX(-8px)',
          // Increase z-index during dragging
          zIndex: isDragging ? 51 : 10,
        }}
      >
        {/* Visual divider line - centered within hit area */}
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-transparent rounded-lg transition-colors duration-200 group-hover:bg-border group-active:bg-border" />
      </div>
    </>
  )
}
