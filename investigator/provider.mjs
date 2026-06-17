import { createAnthropic } from '@ai-sdk/anthropic';

// GoCode Claude model factory for the in-process investigator loop.
// Mirrors the PROVEN agents SDK->GoCode path (packages/ai-lib unified-provider.ts):
//   - S2S mode: Authorization: sso-jwt <token> via a custom fetch
//   - direct mode: native x-api-key (ANTHROPIC_API_KEY)
//   - both modes strip blocked anthropic-beta headers the proxy rejects
// Pure module: createAnthropic + fetch are injectable so unit tests run offline.

// Mirror packages/ai-lib unified-provider.ts DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS.
export const DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS = ['structured-outputs-2025-11-13'];

// Verified entries in CLAUDE_PROXY_MODELS (unified-provider.ts).
export const MODELS = {
  lead: 'claude-sonnet-4-6',
  mechanical: 'claude-haiku-4-5',
  strong: 'claude-opus-4-8',
};

/**
 * GoCode/Anthropic proxy base URLs are normalized to end with `/v1`
 * (agents does `baseURL.endsWith('/v1') ? baseURL : baseURL + '/v1'`).
 * @param {string} baseURL
 * @returns {string}
 */
export function normalizeBaseUrl(baseURL) {
  if (!baseURL) return baseURL;
  return baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`;
}

/**
 * Strip blocked anthropic-beta values from a Headers object in place.
 * Exact-match filtering on the comma-separated list; deletes the header if nothing remains.
 * Mirrors agents filterAnthropicBetaHeaders.
 * @param {Headers} headers
 * @param {string[]} blocked
 */
export function filterBlockedBetas(headers, blocked) {
  if (!blocked?.length || !headers.has('anthropic-beta')) return;
  const value = headers.get('anthropic-beta');
  if (!value) return;
  const kept = value.split(',').map((v) => v.trim()).filter((v) => !blocked.includes(v));
  if (kept.length === 0) headers.delete('anthropic-beta');
  else headers.set('anthropic-beta', kept.join(','));
}

/**
 * Build a custom fetch for the GoCode proxy.
 * S2S mode: sets `Authorization: sso-jwt <token>` (mirrors agents createS2SFetchWrapper).
 * Direct mode: leaves native x-api-key in place.
 * Both modes strip blocked betas.
 * @param {{ useS2S: boolean, authToken?: string, blockedBetas?: string[], baseFetch?: typeof fetch }} opts
 * @returns {typeof fetch}
 */
export function makeGoCodeFetch({ useS2S, authToken, blockedBetas = DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS, baseFetch = fetch }) {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    if (useS2S && authToken) {
      headers.set('Authorization', `sso-jwt ${authToken}`);
    }
    filterBlockedBetas(headers, blockedBetas);
    return baseFetch(url, { ...init, headers });
  };
}

/**
 * Create a GoCode-wired Anthropic provider. Mirrors agents createAnthropicProvider.
 * @param {{
 *   useS2S?: boolean,
 *   authToken?: string,
 *   apiKey?: string,
 *   baseURL?: string,
 *   blockedBetas?: string[],
 *   createImpl?: typeof createAnthropic,
 * }} [opts]
 * @returns {ReturnType<typeof createAnthropic>}
 */
export function createInvestigatorProvider(opts = {}) {
  const {
    useS2S = process.env.GOCODE_USE_S2S_AUTH === 'true',
    authToken = process.env.ANTHROPIC_AUTH_TOKEN,
    apiKey = process.env.ANTHROPIC_API_KEY,
    baseURL = process.env.ANTHROPIC_BASE_URL,
    blockedBetas = DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS,
    createImpl = createAnthropic,
  } = opts;

  if (!baseURL) throw new Error('provider: baseURL (ANTHROPIC_BASE_URL) is required');
  if (useS2S && !authToken) throw new Error('provider: S2S mode requires authToken');
  if (!useS2S && !apiKey) throw new Error('provider: direct mode requires apiKey (ANTHROPIC_API_KEY)');

  return createImpl({
    // I2: in S2S mode the JWT in the Authorization header is the only credential.
    // Force a placeholder so a real ANTHROPIC_API_KEY present in the env (common
    // as a direct-mode fallback) never also rides along as x-api-key — that would
    // send two credentials and leak the direct key onto S2S requests.
    apiKey: useS2S ? 's2s-placeholder' : apiKey,
    baseURL: normalizeBaseUrl(baseURL),
    fetch: makeGoCodeFetch({ useS2S, authToken, blockedBetas }),
  });
}

/**
 * Build the per-tier model instances the investigator loop uses.
 * @param {Parameters<typeof createInvestigatorProvider>[0]} [opts]
 * @returns {{ lead: any, mechanical: any, strong: any, provider: any }}
 */
export function createInvestigatorModels(opts = {}) {
  const provider = createInvestigatorProvider(opts);
  return {
    lead: provider(MODELS.lead),
    mechanical: provider(MODELS.mechanical),
    strong: provider(MODELS.strong),
    provider,
  };
}
