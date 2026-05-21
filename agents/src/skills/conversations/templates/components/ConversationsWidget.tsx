/** Mounts the Conversations chat widget. Gated behind cookie consent (c2_analytics_consent). */

import { useEffect, useRef, useState } from 'react';

const SCRIPT_ID = 'conversations-js';
const BRAND_ID = ''; // Set by conversations__setup_widget
const CDN_URL = ''; // Set by conversations__setup_widget
const COOKIE_CONSENT_KEY = 'c2_analytics_consent';
const COOKIE_CONSENT_EXPIRES_DAYS = 365;
const CONSENT_POLL_INTERVAL_MS = 1000;

declare global {
  interface Window {
    _support?: {
      account?: string;
      [key: string]: unknown;
    };
  }
}

function hasValidConsent(): boolean {
  try {
    const raw = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!raw) return false;
    const consent = JSON.parse(raw) as { analytics?: boolean; timestamp?: number };
    if (!consent.analytics) return false;
    if (consent.timestamp) {
      const daysSince = (Date.now() - consent.timestamp) / (1000 * 60 * 60 * 24);
      if (daysSince > COOKIE_CONSENT_EXPIRES_DAYS) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export default function ConversationsWidget() {
  const [consented, setConsented] = useState(hasValidConsent);
  const scriptInjected = useRef(false);

  // Listen for consent changes (custom event from CookieBanner + polling fallback)
  useEffect(() => {
    if (consented) return;

    const onConsentEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ consented?: boolean }>).detail;
      if (detail?.consented) setConsented(true);
    };
    window.addEventListener('cookie-consent-changed', onConsentEvent);

    // Polling fallback for CookieBanners that don't dispatch the custom event
    const interval = setInterval(() => {
      if (hasValidConsent()) setConsented(true);
    }, CONSENT_POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('cookie-consent-changed', onConsentEvent);
      clearInterval(interval);
    };
  }, [consented]);

  // Load Conversations widget once consent is granted
  useEffect(() => {
    if (!consented) return;

    if (!BRAND_ID) return;

    // One-time: inject the script + set up _support config
    if (!scriptInjected.current && !document.getElementById(SCRIPT_ID)) {
      scriptInjected.current = true;

      window._support = window._support || {};
      window._support.account = BRAND_ID;
      window._support.ui = {
        widget: {
          icon: 'webChat',
        },
      };

      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = CDN_URL || 'https://cdn.reamaze.com/assets/reamaze.js';
      document.head.appendChild(script);
    }

  }, [consented]);

  return null;
}
