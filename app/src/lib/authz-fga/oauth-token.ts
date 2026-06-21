import { type AuthzFgaConfig, isAuthzFgaLocalMock } from '@/lib/authz-fga/config';

type CachedToken = { accessToken: string; expiresAtMs: number };

let cached: CachedToken | null = null;
// Dedup concurrent fetches. While one request is fetching a fresh token, any
// other request that finds the cache expired awaits this same in-flight promise
// instead of firing its own OAuth call. Without this, N concurrent requests
// hitting an expired cache each start their own fetch (a TOCTOU double-fetch
// that multiplies outbound auth calls under load).
let inFlight: Promise<string> | null = null;

const skewMs = 60_000;

export async function getAuthzFgaAccessToken(config: AuthzFgaConfig): Promise<string> {
  if (isAuthzFgaLocalMock()) {
    return 'mock-signature';
  }

  const now = Date.now();
  if (cached && cached.expiresAtMs > now + skewMs) {
    return cached.accessToken;
  }

  // A fetch is already running — await its result rather than starting another.
  if (inFlight) {
    return inFlight;
  }

  // Clear the slot on settle (success or failure) so a failed fetch doesn't
  // wedge the cache: the next caller starts a fresh attempt.
  inFlight = fetchToken(config).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchToken(config: AuthzFgaConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const res = await fetch(config.oauthTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });

  const text = await res.text();
  if (!res.ok) {
    // Do NOT include the response body — an OAuth error response can echo back
    // request parameters (including client_secret). Log the status code only.
    throw new Error(`authz-fga.oauth-token failed: ${res.status}`);
  }

  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error('authz-fga.oauth-token missing access_token');
  }

  const ttlSec = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600;
  cached = {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + ttlSec * 1000,
  };
  return cached.accessToken;
}

export function clearAuthzFgaTokenCacheForTests(): void {
  cached = null;
  inFlight = null;
}
