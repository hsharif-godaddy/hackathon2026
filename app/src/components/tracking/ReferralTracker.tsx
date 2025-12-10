'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Client component that tracks referral link clicks
 *
 * Detects `?referralId=xxx` in the URL and sends tracking to server.
 * Renders nothing - exists only to run tracking logic.
 */
export default function ReferralTracker() {
  const searchParams = useSearchParams();
  const hasTracked = useRef(false);

  useEffect(() => {
    const referralId = searchParams.get('referralId');

    if (referralId && !hasTracked.current) {
      hasTracked.current = true;

      // Fire and forget - don't block on tracking
      fetch('/api/referral/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referralId,
          path: window.location.pathname,
        }),
      }).catch(() => {
        // Silently ignore tracking failures
      });
    }
  }, [searchParams]);

  return null;
}
