import { useEffect } from 'react'

type ImportFn = () => Promise<unknown>

const FALLBACK_DELAY_MS = 200

/**
 * Preloads dynamic imports once the browser is idle after mount.
 * Falls back to setTimeout when requestIdleCallback is unavailable (Safari < 16.4).
 */
export function useAotPreload(imports: ImportFn[]) {
  useEffect(() => {
    const fire = () => { imports.forEach(fn => void fn()) }
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(fire)
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(fire, FALLBACK_DELAY_MS)
    return () => clearTimeout(id)
  }, []) // imports must be a stable module-level reference
}
