import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

const COOKIE_CONSENT_KEY = 'c2_analytics_consent';
const COOKIE_CONSENT_EXPIRES_DAYS = 365;

interface CookieConsent {
  analytics: boolean;
  timestamp: number;
}

/**
 * Cookie banner component for C2 analytics consent

 * Displays a consent banner for C2 analytics tracking. Manages user consent
 * preferences in localStorage and controls whether analytics scripts are loaded.
 */
export default function CookieBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const scriptLoadedRef = useRef(false);

  useEffect(function checkConsent() {
    if (typeof window === 'undefined') return;

    const consentData = localStorage.getItem(COOKIE_CONSENT_KEY);

    if (!consentData) {
      setShowBanner(true);
      setIsLoaded(true);
      return;
    }

    try {
      const consent: CookieConsent = JSON.parse(consentData);
      const daysSinceConsent = (Date.now() - consent.timestamp) / (1000 * 60 * 60 * 24);

      if (daysSinceConsent > COOKIE_CONSENT_EXPIRES_DAYS) {
        localStorage.removeItem(COOKIE_CONSENT_KEY);
        setShowBanner(true);
      } else if (consent.analytics) {
        loadAnalytics();
      }
    } catch {
      localStorage.removeItem(COOKIE_CONSENT_KEY);
      setShowBanner(true);
    }

    setIsLoaded(true);
  }, []);

  function loadAnalytics() {
    if (typeof window === 'undefined' || scriptLoadedRef.current) return;

    window._signalsDataLayer = window._signalsDataLayer || [];

    const existingScript = document.querySelector('script[src*="scc-c2"]');
    if (existingScript) {
      scriptLoadedRef.current = true;
      return;
    }

    const script = document.createElement('script');
    const isTestEnv = window.location.hostname.startsWith('test-') ||
                      window.location.hostname.startsWith('dev-');
    const scriptUrl = isTestEnv
      ? 'https://img1.test-wsimg.com/signals/js/clients/scc-c2/scc-c2.min.js'
      : 'https://img1.wsimg.com/signals/js/clients/scc-c2/scc-c2.min.js';

    script.src = scriptUrl;
    script.async = true;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
    scriptLoadedRef.current = true;
  }

  function saveConsent(analytics: boolean) {
    const consent: CookieConsent = {
      analytics,
      timestamp: Date.now(),
    };
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(consent));

    if (analytics) {
      loadAnalytics();
    }

    setShowBanner(false);
  }

  function handleAccept() {
    saveConsent(true);
  }

  function handleDecline() {
    saveConsent(false);
  }

  function revokeConsent() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(COOKIE_CONSENT_KEY);
    setShowBanner(true);
  }

  useEffect(function exposeRevokeFunction() {
    if (typeof window === 'undefined') return;
    window.revokeAnalyticsConsent = revokeConsent;

    return function cleanup() {
      delete window.revokeAnalyticsConsent;
    };
  }, [revokeConsent]);

  if (!isLoaded || !showBanner) {
    return null;
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg"
      role="alertdialog"
      aria-live="polite"
      aria-label="Cookie consent banner"
      aria-describedby="cookie-banner-description"
    >
      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">
              Cookie Consent
            </h3>
            <p id="cookie-banner-description" className="text-sm text-gray-600">
              We serve cookies. We use tools, such as cookies, to enable essential services and functionality on our site and to collect data on how visitors interact with our site, products and services. By clicking Accept, you agree to our use of these tools for advertising, analytics and support.{' '}
              <a
                href="https://www.godaddy.com/en-in/legal/agreements/privacy-policy"
                className="text-blue-600 hover:text-blue-800 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn more
              </a>
            </p>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDecline}
              className="whitespace-nowrap"
            >
              Decline
            </Button>
            <Button
              size="sm"
              onClick={handleAccept}
              className="whitespace-nowrap"
              autoFocus
            >
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    _signalsDataLayer?: unknown[];
    revokeAnalyticsConsent?: () => void;
  }
}

