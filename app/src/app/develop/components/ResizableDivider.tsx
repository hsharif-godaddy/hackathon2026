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
    setIsDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.style.pointerEvents = 'none'

    // Enable pointer events only on the body for dragging
    if (dividerRef.current) {
      dividerRef.current.style.pointerEvents = 'auto'
    }
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
    if (!isDragging) return

    // Throttle updates using requestAnimationFrame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      updateWidth(e.clientX)
    })
  }, [isDragging, updateWidth])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.body.style.pointerEvents = ''

    if (dividerRef.current) {
      dividerRef.current.style.pointerEvents = ''
    }

    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  // Global mouse events for smooth dragging
  useEffect(() => {
    if (isDragging) {
      // Use passive: false to allow preventDefault if needed
      document.addEventListener('mousemove', handleMouseMove, { passive: true })
      document.addEventListener('mouseup', handleMouseUp, { passive: true })

      // Prevent context menu during drag
      const preventContextMenu = (e: Event) => e.preventDefault()
      document.addEventListener('contextmenu', preventContextMenu)

      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.removeEventListener('contextmenu', preventContextMenu)
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
    <div
      ref={dividerRef}
      className="absolute top-2 bottom-2 w-0.5 bg-transparent cursor-col-resize flex-shrink-0 z-10 rounded-lg transition-colors duration-400 hover:bg-border"
      onMouseDown={handleMouseDown}
      style={style}
    />
  )
}
