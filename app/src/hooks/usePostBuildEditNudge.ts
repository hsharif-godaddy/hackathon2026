import { useCallback, useEffect, useState } from 'react'

interface UsePostBuildEditNudgeProps {
  viewMode: string
  showBuildingOverlay: boolean
  isStreaming: boolean
  isLoading: boolean
  isMobile: boolean
  featureFlagEnabled: boolean
}

const STORAGE_KEY = 'airo-edit-nudge-shown'

function hasShown(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch (e) {
    console.warn('[edit-nudge] localStorage operation failed', e)
    return false
  }
}

export function usePostBuildEditNudge({
  viewMode,
  showBuildingOverlay,
  isStreaming,
  isLoading,
  isMobile,
  featureFlagEnabled,
}: UsePostBuildEditNudgeProps) {
  const [showNudge, setShowNudge] = useState(false)

  const shouldEnable = featureFlagEnabled && !isMobile && !hasShown()

  useEffect(() => {
    if (!shouldEnable) return
    if (showBuildingOverlay || isStreaming || isLoading) return

    // Note: No explicit intro tour guard needed — when the tour is active,
    // it blocks iframe interaction so IFRAME_FIRST_INTERACTION cannot fire.
    const handleMessage = (event: MessageEvent) => {
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
      if (event.source !== iframe?.contentWindow) return
      if (event.data?.type === 'IFRAME_FIRST_INTERACTION') {
        setShowNudge(true)
        window.removeEventListener('message', handleMessage)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [shouldEnable, showBuildingOverlay, isStreaming, isLoading])

  const dismiss = useCallback(() => {
    setShowNudge(false)
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch (e) {
      console.warn('[edit-nudge] localStorage operation failed', e)
      // Ignore storage write failures; nudge can reappear in private contexts.
    }
  }, [])

  useEffect(() => {
    if (showNudge && viewMode !== 'edit') {
      dismiss()
    }
  }, [showNudge, viewMode, dismiss])

  return { showNudge, dismiss }
}
