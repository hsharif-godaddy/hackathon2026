'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { ViewMode } from '@/app/[market]/develop/components/types'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

const STORAGE_KEY = 'airo-edit-nudge-dismissed'
const TOOLTIP_DISPLAY_MS = 5000

function isDismissedPermanently(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function markDismissedPermanently(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch { /* storage full or blocked */ }
}

export function useEditNudgeTooltip() {
  const [visible, setVisible] = useState(false)
  const shownThisSession = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    setVisible(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const dismissForever = useCallback(() => {
    dismiss()
    markDismissedPermanently()
  }, [dismiss])

  useEffect(() => {
    let showTimestamp = 0

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'EDITABLE_ELEMENT_CLICKED_IN_PREVIEW') return
      const { viewMode } = useDevelopPageStore.getState()
      if (viewMode !== ViewMode.PREVIEW) return
      if (shownThisSession.current) return
      if (isDismissedPermanently()) return
      shownThisSession.current = true
      showTimestamp = Date.now()
      setVisible(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setVisible(false), TOOLTIP_DISPLAY_MS)
    }

    const dismissOnClick = () => {
      if (Date.now() - showTimestamp < 500) return
      setVisible(false)
    }
    window.addEventListener('message', handleMessage)
    window.addEventListener('click', dismissOnClick)

    return () => {
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('click', dismissOnClick)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { visible, dismiss, dismissForever }
}
