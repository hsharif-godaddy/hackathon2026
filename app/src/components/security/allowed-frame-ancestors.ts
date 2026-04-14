/**
 * Allowed parent hostnames that may embed this app in an iframe.
 * Must stay in sync with the CSP frame-ancestors directive in gasket.ts.
 *
 * Shared between FrameBuster (clickjacking protection) and IframeCloseButton
 * (postMessage target origin resolution).
 */
const ALLOWED_FRAME_HOSTNAMES = [
  'dashboard.godaddy.com',
  'dashboard.dev-godaddy.com',
  'dashboard.test-godaddy.com',
];

/**
 * Check whether an origin is from an allowed frame ancestor.
 * Matches by hostname (ignoring port) and requires HTTPS.
 */
function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && ALLOWED_FRAME_HOSTNAMES.includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Resolve the parent frame's origin using `location.ancestorOrigins` (Chrome/Safari)
 * with a `document.referrer` fallback (Firefox). Returns the origin only if it is
 * from an allowed hostname over HTTPS, otherwise returns `null`.
 */
export function getParentOrigin(): string | null {
  const ancestorOrigins = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestorOrigins?.length) {
    const origin = ancestorOrigins[0];
    return isAllowedOrigin(origin) ? origin : null;
  }

  if (document.referrer) {
    try {
      const origin = new URL(document.referrer).origin;
      return isAllowedOrigin(origin) ? origin : null;
    } catch {
      return null;
    }
  }

  return null;
}
