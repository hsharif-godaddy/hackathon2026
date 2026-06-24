import { useEffect, useState } from 'react';

/**
 * Internal media-query breakpoint for `ResponsiveMenu`'s desktop↔mobile swap.
 * Matches the consuming app's `sm` breakpoint (< 640px ⇒ mobile).
 */
const MOBILE_QUERY = '(max-width: 639px)';

/**
 * SSR-safe `matchMedia` hook. Returns `false` during server render and the
 * first client paint (so SSR/hydration agree on the desktop branch), then
 * subscribes to viewport changes after mount.
 *
 * Kept self-contained inside the package — pattern-library components must not
 * import from the consuming app. Consumers with their own breakpoint source
 * can bypass this entirely via `ResponsiveMenu`'s `isMobile` prop.
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
