import { useEffect } from 'react'

import { useResponsive } from '@/hooks/useResponsive'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

/**
 * Hook to sync responsive state (isMobile/isTablet) with useDevelopPageStore.
 *
 * Uses react-responsive's useMediaQuery internally which is more reliable than
 * manual window resize event listeners. It handles:
 * - SSR compatibility
 * - CSS media query matching
 * - Proper cleanup
 *
 * Call this hook once at the top level of a page that needs responsive state.
 */
export function useSyncResponsiveState() {
  const { isMobile, isTablet } = useResponsive()
  const setIsMobile = useDevelopPageStore((state) => state.setIsMobile)

  useEffect(() => {
    // isMobile in the store represents "should show mobile UI layout"
    // which happens when the viewport is mobile-sized (< 640px)
    setIsMobile(isMobile)
  }, [isMobile, setIsMobile])

  return { isMobile, isTablet }
}
