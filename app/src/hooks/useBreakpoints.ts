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
 * Multi-tier viewport flags aligned with Tailwind breakpoints.
 *
 * **Mobile layout** (< 768px): use {@link useIsMobile}, not flags from this hook.
 * `useIsMobile` is the canonical layout boundary and matches
 * `useDevelopPageStore.isMobile` (via {@link useSyncResponsiveState}).
 *
 * **Pure spacing** (gaps, padding with no JS branching): prefer Tailwind
 * responsive classes (`gap-1 sm:gap-2`, `md:gap-3`) over this hook.
 *
 * **`isBelowSmBreakpoint`** (< 640px, below Tailwind `sm`): mobile-first default
 * range — tighter density and the smallest typography step in multi-tier ladders.
 * Not for mobile layout or prompt-card spacing — those use {@link useIsMobile}.
 *
 * **`isMdBreakpoint` / `isLgBreakpoint`**: min-width tiers for typography or
 * layout that needs more than two steps (e.g., sm → md → lg heading sizes).
 *
 * **`isBelowMdBreakpoint`**: internal composition only (`useIsMobile`,
 * `useSyncResponsiveState`). Call sites should use `useIsMobile()` instead.
 */
export function useBreakpoints() {
  const isBelowSmBreakpoint = useMediaQuery({ maxWidth: SM_BREAKPOINT - 1 })
  const isBelowMdBreakpoint = useMediaQuery({ maxWidth: MD_BREAKPOINT - 1 })
  const isSmBreakpoint = useMediaQuery({ minWidth: SM_BREAKPOINT })
  const isMdBreakpoint = useMediaQuery({ minWidth: MD_BREAKPOINT })
  const isLgBreakpoint = useMediaQuery({ minWidth: LG_BREAKPOINT })
  const isXlBreakpoint = useMediaQuery({ minWidth: XL_BREAKPOINT })

  return {
    /** Below sm (< 640px). Not mobile layout — use {@link useIsMobile}. */
    isBelowSmBreakpoint,
    isBelowMdBreakpoint,
    isSmBreakpoint,
    isMdBreakpoint,
    isLgBreakpoint,
    isXlBreakpoint,
  }
}
