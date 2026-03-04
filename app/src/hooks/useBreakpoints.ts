import { useMediaQuery } from 'react-responsive'

/** Tailwind sm breakpoint */
export const SM_BREAKPOINT = 640
/** Tailwind md breakpoint */
export const MD_BREAKPOINT = 768
/** Tailwind lg breakpoint */
export const LG_BREAKPOINT = 1024
/** Tailwind xl breakpoint */
export const XL_BREAKPOINT = 1280

/**
 * Hook to detect different screen sizes based on Tailwind breakpoints
 *
 * Uses react-responsive's useMediaQuery for optimized media query handling.
 *
 * @returns Object with isBelowSmBreakpoint (< 640px), isSmBreakpoint (640px+), isMdBreakpoint (768px+), isLgBreakpoint (1024px+), and isXlBreakpoint (1280px+)
 */
export function useBreakpoints() {
  const isBelowSmBreakpoint = useMediaQuery({ maxWidth: SM_BREAKPOINT - 1 })
  const isSmBreakpoint = useMediaQuery({ minWidth: SM_BREAKPOINT })
  const isMdBreakpoint = useMediaQuery({ minWidth: MD_BREAKPOINT })
  const isLgBreakpoint = useMediaQuery({ minWidth: LG_BREAKPOINT })
  const isXlBreakpoint = useMediaQuery({ minWidth: XL_BREAKPOINT })

  return { isBelowSmBreakpoint, isSmBreakpoint, isMdBreakpoint, isLgBreakpoint, isXlBreakpoint }
}
