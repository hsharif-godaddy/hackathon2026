'use client'

import { useCallback, useEffect, useRef } from 'react'

interface UseLongPressOptions {
  delay?: number
  enabled?: boolean
}

export function useLongPress(onLongPress: () => void, { delay = 500, enabled = true }: UseLongPressOptions = {}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggeredRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clear, [clear])

  const start = useCallback(() => {
    if (!enabled) return
    clear()
    triggeredRef.current = false
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true
      onLongPress()
    }, delay)
  }, [clear, delay, enabled, onLongPress])

  const end = useCallback(() => {
    clear()
  }, [clear])

  const cancel = useCallback(() => {
    if (!triggeredRef.current) clear()
  }, [clear])

  const consumeTriggered = useCallback(() => {
    if (!triggeredRef.current) return false
    triggeredRef.current = false
    return true
  }, [])

  const handlers = enabled
    ? {
        onTouchStart: start,
        onTouchEnd: end,
        onTouchMove: cancel,
        onTouchCancel: clear,
        onContextMenu: (event: React.SyntheticEvent) => event.preventDefault(),
      }
    : {}

  return { handlers, consumeTriggered }
}
