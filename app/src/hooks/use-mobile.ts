import { useBreakpoints } from './useBreakpoints'

/**
 * Hook to detect mobile screen size
 *
 * Wrapper around useBreakpoints for simple mobile-only checks.
 *
 * @returns boolean indicating if screen is mobile (< 640px)
 */
export function useIsMobile(): boolean {
  const { isBelowSmBreakpoint } = useBreakpoints()
  return isBelowSmBreakpoint
}
