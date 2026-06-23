declare global {
  interface Window {
    _signalsDataLayer?: unknown[];
  }
}

const COOKIE_CONSENT_KEY = 'c2_analytics_consent';
const COOKIE_CONSENT_EXPIRES_DAYS = 365;

interface CookieConsent {
  analytics: boolean;
  timestamp: number;
}

function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!raw) return false;
    const consent = JSON.parse(raw) as CookieConsent;
    if (consent.analytics !== true) return false;
    if (typeof consent.timestamp !== 'number' || Number.isNaN(consent.timestamp)) {
      localStorage.removeItem(COOKIE_CONSENT_KEY);
      return false;
    }
    const daysSinceConsent = (Date.now() - consent.timestamp) / (1000 * 60 * 60 * 24);
    if (daysSinceConsent > COOKIE_CONSENT_EXPIRES_DAYS) {
      localStorage.removeItem(COOKIE_CONSENT_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pushes a Stripe commerce event to the GoDaddy Signals data layer.
 * No-ops when analytics consent is missing/expired or on the server.
 */
export function track(
  eid: string,
  type: string,
  label: string,
  properties?: Record<string, unknown>,
): void {
  if (!hasAnalyticsConsent()) return;
  window._signalsDataLayer = window._signalsDataLayer || [];
  window._signalsDataLayer.push({
    schema: 'add_event',
    version: 'v1',
    data: {
      eid,
      type,
      event_label: label,
      custom_properties: {
        ...properties,
        timestamp: new Date().toISOString(),
        source: 'airo-app-builder',
      },
    },
  });
}
