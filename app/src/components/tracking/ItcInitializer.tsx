'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { ITC_QUERY_PARAM, setItcOverride } from '@/lib/itc';

/**
 * Client component that captures ITC (Internal Tracking Code) from URL
 *
 * Detects `?itc=xxx` in the URL and stores it in localStorage for use
 * by paywall components. The stored ITC overrides default PAYWALL_ITC
 * values for purchase attribution.
 *
 * Features:
 * - Captures ITC on first visit with the parameter
 * - Overwrites existing stored ITC if a new one is provided in URL
 * - Stored ITC expires after 24 hours
 * - Works across page refreshes and new tabs
 *
 * Renders nothing - exists only to run initialization logic.
 */
export default function ItcInitializer() {
  const searchParams = useSearchParams();
  const lastItcRef = useRef<string | null>(null);

  useEffect(() => {
    const itc = searchParams.get(ITC_QUERY_PARAM);

    if (!itc) {
      return;
    }

    // Skip if same ITC (prevents double-writes in same render cycle)
    if (lastItcRef.current === itc) {
      return;
    }

    lastItcRef.current = itc;
    setItcOverride(itc);
  }, [searchParams]);

  return null;
}
