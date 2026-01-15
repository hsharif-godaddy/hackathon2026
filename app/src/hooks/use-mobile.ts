import { useResponsive } from './useResponsive'

/**
 * Hook to detect mobile screen size
 *
 * Wrapper around useResponsive for simple mobile-only checks.
 *
 * @returns boolean indicating if screen is mobile (< 640px)
 */
export function useIsMobile(): boolean {
  const { isMobile } = useResponsive()
  return isMobile
}
