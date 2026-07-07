import { pauseEditModeTimers, resumeEditModeTimers } from './edit-mode-timer-pause'

declare global {
  interface Window {
    __airoCarouselSlotEditActive?: boolean
    __airoCarouselSlotEditRoot?: HTMLElement | null
    __airoCarouselToolbarPauseRoot?: HTMLElement | null
  }
}

let detachmentObserver: MutationObserver | null = null

function disconnectDetachmentObserver(): void {
  if (detachmentObserver) {
    detachmentObserver.disconnect()
    detachmentObserver = null
  }
}

// Watch for the target carousel detaching from the DOM (iframe SPA nav, unmount) — auto-clear so timers don't stay paused forever.
function watchForRootDetachment(root: HTMLElement): void {
  disconnectDetachmentObserver()
  if (typeof MutationObserver === 'undefined') return
  detachmentObserver = new MutationObserver(() => {
    if (!document.contains(root)) setCarouselSlotEdit(false)
  })
  detachmentObserver.observe(document.body, { childList: true, subtree: true })
}

export function setCarouselToolbarPause(active: boolean, carouselRoot?: HTMLElement | null): void {
  window.__airoCarouselToolbarPauseRoot = active && carouselRoot ? carouselRoot : null
  window.dispatchEvent(
    new CustomEvent('airo:carousel-toolbar-pause', { detail: { active } }),
  )
}

export function setCarouselSlotEdit(active: boolean, carouselRoot?: HTMLElement | null): void {
  window.__airoCarouselSlotEditActive = active
  window.__airoCarouselSlotEditRoot = active && carouselRoot ? carouselRoot : null
  if (active) {
    pauseEditModeTimers()
    if (carouselRoot) watchForRootDetachment(carouselRoot)
  } else {
    disconnectDetachmentObserver()
    resumeEditModeTimers()
  }
  window.dispatchEvent(
    new CustomEvent('airo:carousel-slot-edit', { detail: { active } }),
  )
}

export function isCarouselSlotEditActive(): boolean {
  return Boolean(window.__airoCarouselSlotEditActive)
}

export function getCarouselSlotEditRoot(): HTMLElement | null {
  return window.__airoCarouselSlotEditRoot ?? null
}

export function dispatchCarouselSlotNav(direction: 'prev' | 'next'): void {
  window.dispatchEvent(
    new CustomEvent('airo:carousel-slot-nav', { detail: { direction } }),
  )
}
