import { useEffect } from 'react'

/**
 * Detects Safari browser and adds 'is-safari' class to the document element
 * to enable browser-specific styling.
 */
export function useSafariClass() {
  useEffect(() => {
    const isSafari =
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent) &&
      navigator.vendor?.includes("Apple");
    if (isSafari) {
      document.documentElement.classList.add("is-safari");
      return () => document.documentElement.classList.remove("is-safari");
    }
  }, []);
}
