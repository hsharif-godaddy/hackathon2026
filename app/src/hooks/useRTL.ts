import { useEffect, useState } from 'react';

/**
 * Hook to detect if current document is in RTL mode
 *
 * Reads the `dir` attribute from the HTML element, which is automatically
 * set by Gasket's PresentationLayout based on the locale.
 *
 * @returns true if document direction is RTL, false if LTR
 *
 * @example
 * ```tsx
 * const isRTL = useRTL();
 * const direction = isRTL ? 'rtl' : 'ltr';
 * ```
 */
export function useRTL(): boolean {
  const [isRTL, setIsRTL] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.dir === 'rtl' || document.documentElement.dir === 'rtl';
  });

  useEffect(() => {
    // Update if dir attribute changes dynamically
    const dir = document.dir || document.documentElement.dir;
    setIsRTL(dir === 'rtl');
  }, []);

  return isRTL;
}
