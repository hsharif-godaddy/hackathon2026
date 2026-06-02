/** Mounts the Inbox chat widget. Gated behind cookie consent (c2_analytics_consent). */

import { useEffect, useRef } from 'react';

import { getAnalyticsConsent, onConsentChange } from '@/lib/analytics-consent';
import config from '../lib/inboxChat.config.json';

const SCRIPT_ID = 'conversations-js';

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
    _support?: Record<string, unknown>;
  }
}

export default function InboxChatWidget() {
  const scriptInjected = useRef(false);

  useEffect(() => {
    function loadWidget(): void {
      if (!config._support.account || scriptInjected.current || document.getElementById(SCRIPT_ID)) return;
      scriptInjected.current = true;

      window._support = { ...window._support, ...config._support };

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
