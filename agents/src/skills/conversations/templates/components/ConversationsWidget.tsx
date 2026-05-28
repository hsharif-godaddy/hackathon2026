/** Mounts the Conversations chat widget. Gated behind cookie consent (c2_analytics_consent). */

import { useEffect, useRef } from 'react';

import { getAnalyticsConsent, onConsentChange } from '@/lib/analytics-consent';

const SCRIPT_ID = 'conversations-js';
const BRAND_ID = ''; // Set by conversations__setup_widget

function getReamazeCdnUrl(): string {
  const hostname = window.location.hostname;
  if (hostname.endsWith('.dev-godaddy.com') || hostname.endsWith('.dev-airoapp.ai')) {
    return 'https://www.dev-reamaze.com/assets/reamaze.js';
  }
  if (hostname.endsWith('.test-godaddy.com') || hostname.endsWith('.test-airoapp.ai')) {
    return 'https://www.test-reamaze.com/assets/reamaze.js';
  }
  return 'https://cdn.reamaze.com/assets/reamaze.js';
}

declare global {
  interface Window {
    _support?: {
      account?: string;
      [key: string]: unknown;
    };
  }
}

export default function ConversationsWidget() {
  const scriptInjected = useRef(false);

  useEffect(() => {
    function loadWidget(): void {
      if (!BRAND_ID || scriptInjected.current || document.getElementById(SCRIPT_ID)) return;
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
      script.src = getReamazeCdnUrl();
      document.head.appendChild(script);
    }

    if (getAnalyticsConsent()) {
      loadWidget();
    }

    const cleanup = onConsentChange((consented) => {
      if (consented) loadWidget();
    });

    return cleanup;
  }, []);

  return null;
}
