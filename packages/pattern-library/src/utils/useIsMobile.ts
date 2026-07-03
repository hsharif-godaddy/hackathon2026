import { useEffect, useState } from 'react';

/**
 * Internal media-query breakpoint for the package's desktop↔mobile surface
 * swaps (e.g. `ResponsiveMenu`, `ResponsivePopover`). Matches the consuming
 * app's `md` breakpoint (< 768px ⇒ mobile).
 */
const MOBILE_QUERY = '(max-width: 767px)';

/**
 * SSR-safe `matchMedia` hook. Returns `false` during server render and the
 * first client paint (so SSR/hydration agree on the desktop branch), then
 * subscribes to viewport changes after mount.
 *
 * Kept self-contained inside the package — pattern-library components must not
 * import from the consuming app. Consumers with their own breakpoint source
 * can bypass this entirely via the `isMobile` prop on the components that use
 * it (`ResponsiveMenu`, `ResponsivePopover`).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = (): void => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isMobile;
}
