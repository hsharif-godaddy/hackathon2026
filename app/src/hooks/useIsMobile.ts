import { useBreakpoints } from './useBreakpoints'

/**
 * Whether the viewport is in **mobile layout** (< 768px, Tailwind `md`).
 *
 * Use for layout forks: develop/commander shells (sidebar vs stack), canvas
 * overlays, prompt-area spacing (`HeroSection`, `PromptInput`), and any UI
 * gated on `useDevelopPageStore.isMobile`.
 *
 * Do **not** use when the component is desktop-only (e.g., header chrome that
 * never mounts on mobile). For typography/density below sm (< 640px), use
 * {@link useBreakpoints} → `isBelowSmBreakpoint`. For static spacing with no JS
 * branch, prefer Tailwind `sm:` / `md:` classes.
 */
export function useIsMobile(): boolean {
  const { isBelowMdBreakpoint } = useBreakpoints()
  return isBelowMdBreakpoint
}
