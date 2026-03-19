export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false

  return !!(
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).mozFullScreenElement ||
    (document as any).msFullscreenElement
  )
}

export function useIsFullscreen(): boolean {
  return isFullscreen()
}
