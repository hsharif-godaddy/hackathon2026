'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/request-context';

/**
 * Client-side iframe detection and redirect component
 * 
 * Detects if the application is loaded in an iframe and redirects
 * to the top-level domain to prevent clickjacking attacks.
 */
export default function FrameBuster() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      if (window.self !== window.top) {
        if (window.top && window.top.location) {
          window.top.location.replace(window.location.href);
        }
      }
    } catch (e) {
      logger.debug('frame_buster.same_origin.blocked', {
        message: 'Frame detection blocked by same-origin policy - this is expected',
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }, []);

  return null;
}
