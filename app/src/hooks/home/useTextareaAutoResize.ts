'use client'

import type { RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import { useBreakpoints } from '@/hooks/useBreakpoints'

interface UseTextareaAutoResizeParams {
  displayText: string
}

export function useTextareaAutoResize({
  displayText,
}: UseTextareaAutoResizeParams): RefObject<HTMLTextAreaElement> {
  const { isBelowSmBreakpoint, isMdBreakpoint } = useBreakpoints()
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const promptTextareaResizeRafRef = useRef<number | null>(null)

  const fitPromptTextarea = useCallback(function fitPromptTextarea(): void {
    const el = promptTextareaRef.current
    if (!el) return
    const maxHeightPx = parseFloat(getComputedStyle(el).maxHeight)
    el.style.height = '0px'
    const scrollHeight = el.scrollHeight
    const capped =
      Number.isFinite(maxHeightPx) && maxHeightPx > 0
        ? Math.min(scrollHeight, maxHeightPx)
        : scrollHeight
    el.style.height = `${capped}px`
  }, [])

  useLayoutEffect(function syncPromptTextareaHeight(): void {
    fitPromptTextarea()
  }, [displayText, fitPromptTextarea, isBelowSmBreakpoint, isMdBreakpoint])

  useEffect(function syncPromptTextareaHeightOnResize() {
    function onResize(): void {
      if (promptTextareaResizeRafRef.current !== null) {
        cancelAnimationFrame(promptTextareaResizeRafRef.current)
      }
      promptTextareaResizeRafRef.current = requestAnimationFrame(function runFitPromptTextarea(): void {
        promptTextareaResizeRafRef.current = null
        fitPromptTextarea()
      })
    }
    window.addEventListener('resize', onResize, { passive: true })
    return function cleanupPromptTextareaResize(): void {
      window.removeEventListener('resize', onResize)
      if (promptTextareaResizeRafRef.current !== null) {
        cancelAnimationFrame(promptTextareaResizeRafRef.current)
        promptTextareaResizeRafRef.current = null
      }
    }
  }, [fitPromptTextarea])

  return promptTextareaRef
}
