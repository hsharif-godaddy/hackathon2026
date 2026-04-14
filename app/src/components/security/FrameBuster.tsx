'use client';

import { useEffect } from 'react';

import { getParentOrigin } from './allowed-frame-ancestors';

/**
 * Client-side iframe detection and redirect component (defense-in-depth).
 *
 * The primary protection is the CSP frame-ancestors header set by Helmet in
 * gasket.ts. This component provides a fallback for older browsers that do
 * not support frame-ancestors.
 *
 * When the page is loaded inside an iframe it checks the parent origin against
 * ALLOWED_FRAME_ANCESTORS. If the parent is not on the allowlist the top-level
 * window is redirected to break out of the frame (clickjacking prevention).
 */
export default function FrameBuster() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      if (window.self !== window.top) {
        // If the parent is on the allowlist, let the embedding proceed.
        if (getParentOrigin()) return;

        // Same-origin unauthorized frame — bust out.
        // For cross-origin frames the property access below throws, which is
        // caught and handled by the CSP frame-ancestors header instead.
        if (window.top?.location) {
          window.top.location.replace(window.location.href);
        }
      }
    } catch {
      // SecurityError expected when an unallowed cross-origin parent blocks the
      // redirect. CSP frame-ancestors is the primary safeguard for these cases.
    }
  }, []);

  return null;
}
