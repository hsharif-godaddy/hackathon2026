'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface ResizableDividerProps {
  onResize: (leftWidth: number) => void
  initialLeftWidth?: number
  minLeftWidth?: number
  minRightWidth?: number
  className?: string
}

export default function ResizableDivider({
  onResize,
  initialLeftWidth = 400,
  minLeftWidth = 300,
  minRightWidth = 400,
  className = ''
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

  // Handle window resize to adjust constraints
  useEffect(() => {
    const handleWindowResize = () => {
      if (containerRef.current) {
        // Force recalculation of constraints on window resize
        const containerRect = containerRef.current.getBoundingClientRect()
        const containerWidth = containerRect.width
        const maxLeftWidth = containerWidth - minRightWidth
        
        // Get current left panel width
        const leftPanel = containerRef.current.firstElementChild as HTMLElement
        if (leftPanel) {
          const currentWidth = parseInt(leftPanel.style.width || '0', 10)
          if (currentWidth > maxLeftWidth) {
            onResize(maxLeftWidth)
          }
        }
      }
    }

    window.addEventListener('resize', handleWindowResize, { passive: true })
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [minRightWidth, onResize])

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
      className={`
        relative w-2 bg-transparent cursor-col-resize group flex-shrink-0 z-10
        ${className}
      `}
      onMouseDown={handleMouseDown}
    >
      {/* Visual divider line */}
      <div 
        className={`
          absolute inset-y-0 left-1/2 w-px transform -translate-x-1/2
          transition-colors duration-200
          ${isDragging ? 'bg-blue-500' : 'bg-gray-300 group-hover:bg-gray-400'}
        `} 
      />
      
      {/* Extended hover area */}
      <div className="absolute inset-0 -mx-1" />
      
      {/* Drag indicator */}
      <div 
        className={`
          absolute top-1/2 left-1/2 w-6 h-6 -translate-x-1/2 -translate-y-1/2
          bg-white border rounded shadow-sm
          flex items-center justify-center transition-all duration-200
          ${isDragging 
            ? 'opacity-100 border-blue-400 shadow-md scale-110' 
            : 'opacity-0 group-hover:opacity-100 border-gray-300 scale-100'
          }
          pointer-events-none
        `}
      >
        <div className="flex space-x-0.5">
          <div className={`w-0.5 h-2 rounded-full transition-colors ${isDragging ? 'bg-blue-500' : 'bg-gray-400'}`} />
          <div className={`w-0.5 h-2 rounded-full transition-colors ${isDragging ? 'bg-blue-500' : 'bg-gray-400'}`} />
        </div>
      </div>
    </div>
  )
}
