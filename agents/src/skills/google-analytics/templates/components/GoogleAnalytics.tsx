import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { getAnalyticsConsent, onConsentChange } from '@/lib/analytics-consent';

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
    [key: `ga-disable-${string}`]: boolean;
  }
}

function loadGtag(measurementId: string): void {
  // Clear any previously-set opt-out flag so re-accepting after revocation works
  delete window[`ga-disable-${measurementId}`];
  if (document.getElementById('gtag-script')) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]): void => {
    window.dataLayer.push(args);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId);
  const script = document.createElement('script');
  script.id = 'gtag-script';
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  script.async = true;
  document.head.appendChild(script);
}

function disableGtag(measurementId: string): void {
  // Official GA4 opt-out flag — stops gtag.js from sending hits mid-session
  window[`ga-disable-${measurementId}`] = true;
}

/**
 * GoogleAnalytics — loads GA4 and tracks page views.
 * Only activates after the visitor accepts the cookie consent banner.
 * Stops immediately if consent is revoked mid-session (GDPR compliant).
 * Place in RootLayout to cover all pages.
 */
export default function GoogleAnalytics() {
  const location = useLocation();
  const measurementIdRef = useRef<string | null>(null);
  const consentedRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function init(): Promise<void> {
      try {
        const res = await fetch('/api/analytics/config');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { measurementId?: string };
        if (!data.measurementId || cancelled) return;
        measurementIdRef.current = data.measurementId;
        if (getAnalyticsConsent()) {
          consentedRef.current = true;
          loadGtag(data.measurementId);
        }
      } catch {
        // Analytics must never break the app
      }
    }

    void init();

    const cleanup = onConsentChange((consented) => {
      const id = measurementIdRef.current;
      if (!id) return;
      if (consented) {
        consentedRef.current = true;
        loadGtag(id);
      } else {
        consentedRef.current = false;
        disableGtag(id);
      }
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  // Track SPA page changes — only fires when GA is active and consented
  useEffect(() => {
    if (!consentedRef.current || typeof window.gtag !== 'function') return;
    window.gtag('event', 'page_view', { page_path: location.pathname });
  }, [location.pathname]);

  return null;
}
