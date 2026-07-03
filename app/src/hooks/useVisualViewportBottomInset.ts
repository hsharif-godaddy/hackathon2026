'use client'

import { useEffect, useState } from 'react'

export interface VisualViewportInsets {
  /** Pixels to lift a bottom-anchored surface above the on-screen keyboard. */
  bottomInset: number
  /** Current visual viewport height in pixels. */
  viewportHeight: number
}

/** Compute how far the on-screen keyboard overlaps the layout viewport bottom. */
export function getVisualViewportBottomInset(): number {
  if (typeof window === 'undefined') return 0

  const viewport = window.visualViewport
  if (!viewport) return 0

  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
}

function readVisualViewportInsets(): VisualViewportInsets {
  const viewport = typeof window !== 'undefined' ? window.visualViewport : null

  return {
    bottomInset: getVisualViewportBottomInset(),
    viewportHeight: viewport?.height ?? 0,
  }
}

/**
 * Tracks the on-screen keyboard via `visualViewport` so bottom sheets can sit
 * just above it on mobile browsers (notably iOS Safari).
 */
export function useVisualViewportBottomInset(): VisualViewportInsets {
  const [insets, setInsets] = useState<VisualViewportInsets>(() =>
    readVisualViewportInsets()
  )

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const update = () => {
      setInsets(readVisualViewportInsets())
    }

    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    update()

    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return insets
}
