/**
 * Edge-runtime-safe variant of decodeSharePayload from @airo/shared.
 *
 * The shared codec uses Node's `Buffer.from(_, 'base64url')`, which is not
 * available in Next.js Edge middleware. This module mirrors the same
 * contract (same regexes, same field separator, same length cap) using
 * `atob` + `TextDecoder` so it can run inside `middleware.ts`.
 *
 * IMPORTANT: keep the regex patterns and length cap below in lock-step with
 * `packages/shared/src/share-url/codec.ts`. The codec tests in that package
 * are the source of truth for the contract; this file is the Edge mirror.
 */

const FIELD_SEPARATOR = ':';
const MAX_ENCODED_LENGTH = 128;

const SITE_ID_REGEX = /^[A-Za-z0-9_-]{6,32}$/;
const CELL_PREFIX_REGEX = /^c\d{1,6}$/;
const TOKEN_REGEX = /^[A-Za-z0-9_-]{8,16}$/;

export interface SharePayload {
  siteId: string;
  cellPrefix: string;
  token: string;
}

function base64UrlToUtf8(input: string): string | null {
  // Convert base64url -> base64 with padding, then atob.
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = b64.length % 4;
  const padded = padding ? b64 + '='.repeat(4 - padding) : b64;

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }

  // atob produces a Latin-1 binary string; decode as UTF-8.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function decodeSharePayloadEdge(encoded: string): SharePayload | null {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > MAX_ENCODED_LENGTH) {
    return null;
  }

  const plaintext = base64UrlToUtf8(encoded);
  if (plaintext === null) return null;

  const parts = plaintext.split(FIELD_SEPARATOR);
  if (parts.length !== 3) return null;

  const [siteId, cellPrefix, token] = parts;
  if (!siteId || !cellPrefix || !token) return null;

  if (!SITE_ID_REGEX.test(siteId)) return null;
  if (!CELL_PREFIX_REGEX.test(cellPrefix)) return null;
  if (!TOKEN_REGEX.test(token)) return null;

  return { siteId, cellPrefix, token };
}

// Hosts that map to test-airoapp.ai. Enumerated explicitly so a new BFF host
// (new env, regional rollout, etc.) misses the mapping and surfaces in the
// console.warn below rather than silently routing share links to the test
// domain. Update this list when a new BFF host is provisioned.
const KNOWN_TEST_HOSTS = new Set([
  // Canonical test BFF host
  'test-airoapp.ai',
  // Dev + local
  'airo-builder.dev-godaddy.com',
  'local.gasket.dev-godaddy.com',
  'localhost',
  // Legacy hosts kept during the migration to airo.ai / test-airoapp.ai;
  // safe to remove once those new hosts are live and traffic has cut over.
  'airo-builder.test-godaddy.com',
]);

// Canonical prod BFF host. The legacy `airo-builder.godaddy.com` host stays
// recognized via PROD_LEGACY_HOSTS below until the migration is complete.
const PROD_HOST = 'airo.ai';
const PROD_LEGACY_HOSTS = new Set(['airo-builder.godaddy.com']);

/**
 * Map the BFF host the request came in on to the airo-app preview base
 * domain. Hardcoded mirror of `gasket.config.airoAppDomain` per env (the
 * gasket config is not available in Edge runtime).
 *
 * For unrecognized hosts we still fall back to the test domain (safer than
 * prod — broken in test is harmless, broken in prod 404s against a real
 * BFF), but emit a console.warn so the missing mapping is observable. Edge
 * middleware can't use the structured logger, but console.warn surfaces in
 * Loki via stderr on the Node-based Edge runtime.
 */
export function airoAppDomainForHost(bffHost: string): string {
  // Strip any port. Naive split(':')[0] would mangle IPv6 forms like
  // [::1]:3000 (which would yield "[" — matches no known host). Detect
  // the bracketed form and unwrap it; otherwise split off the trailing port.
  let host: string;
  if (bffHost.startsWith('[')) {
    const closeIdx = bffHost.indexOf(']');
    host = closeIdx > 0 ? bffHost.slice(1, closeIdx) : bffHost;
  } else {
    host = bffHost.split(':')[0] ?? bffHost;
  }

  if (host === PROD_HOST || PROD_LEGACY_HOSTS.has(host)) return 'airoapp.ai';
  if (KNOWN_TEST_HOSTS.has(host)) return 'test-airoapp.ai';

  // Unknown host — every share redirect from this host will silently route
  // to the test domain unless this is updated. Log so the gap is visible.
  console.warn(
    `[share/edge-decode] unrecognized BFF host "${host}"; falling back to test-airoapp.ai. ` +
      `If this is a new environment, add it to KNOWN_TEST_HOSTS.`,
  );
  return 'test-airoapp.ai';
}
