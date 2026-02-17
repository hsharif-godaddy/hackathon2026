import { useMediaQuery } from 'react-responsive'

/** Tailwind sm breakpoint */
export const SM_BREAKPOINT = 640
/** Tailwind md breakpoint */
export const MD_BREAKPOINT = 768
/** Tailwind lg breakpoint */
export const LG_BREAKPOINT = 1024

/**
 * Hook to detect different screen sizes based on Tailwind breakpoints
 *
 * Uses react-responsive's useMediaQuery for optimized media query handling.
 *
 * @returns Object with isBelowSmBreakpoint (< 640px), isSmBreakpoint (640px+), isMdBreakpoint (768px+), and isLgBreakpoint (1024px+)
 */
export function useBreakpoints() {
  const isBelowSmBreakpoint = useMediaQuery({ maxWidth: SM_BREAKPOINT - 1 })
  const isSmBreakpoint = useMediaQuery({ minWidth: SM_BREAKPOINT })
  const isMdBreakpoint = useMediaQuery({ minWidth: MD_BREAKPOINT })
  const isLgBreakpoint = useMediaQuery({ minWidth: LG_BREAKPOINT })

  return { isBelowSmBreakpoint, isSmBreakpoint, isMdBreakpoint, isLgBreakpoint }
}
