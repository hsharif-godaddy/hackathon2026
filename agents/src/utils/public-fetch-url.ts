import { isIP } from 'node:net';

/**
 * SSRF protection for server-side fetches of user-influenced URLs.
 * Rejects hostnames that resolve to internal/private addresses.
 *
 * Known limitation: decimal/octal/hex IPv4 representations bypass isIP()
 * detection. Callers should treat this as one layer of defense.
 */
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /\.(local|internal|corp|lan)$/i,
  /\.svc\.cluster\.local$/i,
];

export function isBlockedFetchHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return true;
  return BLOCKED_HOSTNAME_PATTERNS.some(pattern => pattern.test(host));
}

export type PublicFetchUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export function validatePublicHttpsFetchUrl(raw: string): PublicFetchUrlValidation {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty URL' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'https required' };
  }

  if (isBlockedFetchHostname(parsed.hostname)) {
    return { ok: false, reason: 'hostname not allowed' };
  }

  return { ok: true, url: parsed };
}

/** First valid HTTPS public URL from candidates, or null if none pass validation. */
export function resolvePublicHttpsFetchUrl(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    const validated = validatePublicHttpsFetchUrl(candidate);
    if (validated.ok) {
      return validated.url.href.replace(/\/$/, '') || validated.url.origin;
    }
  }
  return null;
}
