'use client';

import { useEffect, useState } from 'react';

/**
 * Detects whether the app is running inside an iframe.
 * Returns false during SSR and on the initial client render to avoid hydration mismatches.
 */
export function useIsEmbedded(): boolean {
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    try {
      setIsEmbedded(window.self !== window.top);
    } catch {
      // Cross-origin access blocked — we are definitely in an iframe
      setIsEmbedded(true);
    }
  }, []);

  return isEmbedded;
}
