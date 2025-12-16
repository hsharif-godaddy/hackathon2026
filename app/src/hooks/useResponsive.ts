import { useMediaQuery } from 'react-responsive'

/** Tailwind sm breakpoint */
export const SM_BREAKPOINT = 640
/** Tailwind md breakpoint */
export const MD_BREAKPOINT = 768
/** Tailwind lg breakpoint */
export const LG_BREAKPOINT = 1024

/**
 * Hook to detect mobile and tablet screen sizes based on Tailwind breakpoints
 *
 * Uses react-responsive's useMediaQuery for optimized media query handling.
 *
 * @returns Object with isMobile (< 640px) and isTablet (640px - 1023px)
 */
export function useResponsive() {
  const isMobile = useMediaQuery({ maxWidth: SM_BREAKPOINT - 1 })
  const isTablet = useMediaQuery({ minWidth: SM_BREAKPOINT, maxWidth: LG_BREAKPOINT - 1 })

  return { isMobile, isTablet }
}
