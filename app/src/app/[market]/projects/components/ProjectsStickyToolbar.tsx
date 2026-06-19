'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface ProjectsStickyToolbarProps {
  children: React.ReactNode
}

function getScrollTargets(node: HTMLElement): EventTarget[] {
  const targets: EventTarget[] = [window, document]
  let parent = node.parentElement

  while (parent) {
    const { overflowY } = getComputedStyle(parent)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      targets.push(parent)
    }
    parent = parent.parentElement
  }

  return targets
}

const STUCK_BAR_CLASS =
  'fixed inset-x-0 top-0 border-b border-intents-ux-borderColor bg-intents-ux-box-backgroundColor shadow-sm supports-[padding:max(0px)]:pt-[max(8px,env(safe-area-inset-top))]'

const STUCK_INNER_CLASS =
  'mx-auto w-full max-w-[1440px] px-[16px] pb-[12px] sm:px-6 lg:px-10'

/**
 * Pins toolbar content to the viewport top after scroll. The stuck bar is portaled
 * to document.body so gasket layout transforms cannot clip it.
 */
export default function ProjectsStickyToolbar({ children }: ProjectsStickyToolbarProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<HTMLDivElement>(null)
  const heightRef = useRef(0)
  const [isStuck, setIsStuck] = useState(false)
  const [spacerHeight, setSpacerHeight] = useState(0)
  const [mounted, setMounted] = useState(false)

  const measureHeight = useCallback(() => {
    const node = flowRef.current
    if (!node) return

    const next = node.offsetHeight
    if (next > 0) {
      heightRef.current = next
      setSpacerHeight(next)
    }
  }, [])

  const updateStuck = useCallback(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const flowNode = flowRef.current
    if (flowNode) {
      const next = flowNode.offsetHeight
      if (next > 0) {
        heightRef.current = next
        setSpacerHeight(next)
      }
    }

    const { bottom } = sentinel.getBoundingClientRect()
    setIsStuck(bottom <= 0)
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  useLayoutEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    measureHeight()
    updateStuck()

    const scrollTargets = getScrollTargets(sentinel)
    const passive = { passive: true } as const

    for (const target of scrollTargets) {
      target.addEventListener('scroll', updateStuck, passive)
    }

    window.addEventListener('resize', updateStuck)

    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { root: null, threshold: 0 }
    )
    observer.observe(sentinel)

    const visualViewport = window.visualViewport
    visualViewport?.addEventListener('scroll', updateStuck, passive)
    visualViewport?.addEventListener('resize', updateStuck)

    const resizeObserver =
      flowRef.current &&
      new ResizeObserver(() => {
        measureHeight()
        updateStuck()
      })

    if (flowRef.current && resizeObserver) {
      resizeObserver.observe(flowRef.current)
    }

    return () => {
      for (const target of scrollTargets) {
        target.removeEventListener('scroll', updateStuck)
      }
      window.removeEventListener('resize', updateStuck)
      observer.disconnect()
      visualViewport?.removeEventListener('scroll', updateStuck)
      visualViewport?.removeEventListener('resize', updateStuck)
      resizeObserver?.disconnect()
    }
  }, [measureHeight, updateStuck])

  const showStuckBar = mounted && isStuck

  const stuckBar = (
    <div className={STUCK_BAR_CLASS} data-testid="projects-toolbar-sticky-bar">
      <div className={STUCK_INNER_CLASS}>{children}</div>
    </div>
  )

  return (
    <>
      <div ref={sentinelRef} className="pointer-events-none h-px w-full shrink-0" aria-hidden />
      {!showStuckBar ? (
        <div ref={flowRef} data-testid="projects-toolbar-sticky" className="w-full">
          {children}
        </div>
      ) : (
        <div
          aria-hidden
          data-testid="projects-toolbar-sticky-spacer"
          style={{ height: spacerHeight || heightRef.current || 40 }}
        />
      )}
      {showStuckBar && createPortal(stuckBar, document.body)}
    </>
  )
}
