import { getSecretString } from './secret-cache.mjs';

// Bound every Jira call to 15s — matches the CRM client pattern. Atlassian
// Cloud has had multi-minute partial outages historically; without a
// timeout a hung call would consume the full 60s Lambda timeout and
// land in DLQ. With it we fail fast inside the bulkhead try/catch so
// other downstreams complete normally.
const TIMEOUT_MS = 15_000;

/**
 * Atlassian Cloud REST client. Authenticates as an Atlassian Native Service
 * Account (NSA) using the OAuth 2.0 client_credentials grant (2LO) — GoDaddy's
 * standard for programmatic Jira access. See:
 *   https://godaddy-corp.atlassian.net/wiki/spaces/ATLSNADMIN/pages/4294607021
 *   https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/
 *
 * Flow:
 *   1. POST clientId+clientSecret to https://auth.atlassian.com/oauth/token
 *      (grant_type=client_credentials, form-encoded) → 60-min Bearer token.
 *   2. Call the gateway URL with the cloudId in the path (NOT the tenant site
 *      URL — NSA bearers are rejected by <site>.atlassian.net):
 *        https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/...
 *      The caller passes that gateway base as `baseUrl`.
 *
 * Secret JSON shape: {"clientId": "<id>", "clientSecret": "<secret>"}.
 * Sourced from CyberArk, stored in AWS Secrets Manager. Cached in-process.
 *
 * Scopes required (GoDaddy "Profile B"): read:jira-work (search/read),
 * write:jira-work (create). No user fields are set on issues, so
 * read:jira-user is not required.
 */

const PLACEHOLDER_VALUE = 'REPLACE_ME';
const TOKEN_URL = process.env.JIRA_OAUTH_TOKEN_URL ?? 'https://auth.atlassian.com/oauth/token';

// Refresh the access token this far before its advertised expiry so an
// in-flight request never races the 60-min boundary mid-RTT. 1 min is ample
// headroom for a 60-min token (the CRM cert-token service uses a larger 5-min
// margin for its ~1h tokens; this client adds a 401 re-mint retry below as a
// second line of defense, so it doesn't need as wide a pre-expiry margin).
const EXPIRY_MARGIN_MS = 60 * 1000;

let cachedToken = null;
let cachedExpiresAt = 0;
// In-flight mint shared across concurrent callers so a burst of submissions
// in one warm container doesn't stampede auth.atlassian.com. Mirrors the
// inflight-dedup pattern in app/src/lib/crm/airo-cert-token.ts.
let inflightMint = null;

async function mintAccessToken() {
  const raw = await getSecretString(process.env.JIRA_OAUTH_SECRET_ARN);
  // Guard the parse so a non-JSON secret value (ops pasting a raw token, a
  // trailing comma) throws a purpose-built message instead of a bare
  // SyntaxError that gives no hint it was the Jira OAuth secret.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('jira secret is not valid JSON — expected {clientId, clientSecret}');
  }
  const { clientId, clientSecret } = parsed;
  if (!clientId || !clientSecret) {
    throw new Error('jira secret missing clientId or clientSecret');
  }
  // Throwing a sentinel error instead of attempting the mint lets the
  // bulkhead in `handler.mjs` log a clear `fanout.jira.find_failed` (find runs
  // before create in resolveJiraKey) with a distinct message — a real 401 from
  // auth.atlassian.com would be far more confusing to triage than "Jira secret
  // not yet populated by ops".
  if (clientId === PLACEHOLDER_VALUE || clientSecret === PLACEHOLDER_VALUE) {
    throw new Error('jira secret still has REPLACE_ME placeholder — ops needs to fill secret value');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    // Scopes are bound to the credential at creation time, so the token
    // request carries no `scope` param (per Atlassian's NSA docs).
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    // Body may echo the client_id but never the secret; safe to surface for
    // triage and it never reaches Atlassian-bound logs (handler logs err.message
    // under create_failed/find_failed only).
    throw new Error(`jira oauth ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('jira oauth response missing access_token');
  }
  // Trust the server-provided lifetime (typically 3600s); default to 60 min
  // if absent so a malformed response still yields a usable short TTL rather
  // than caching forever.
  const expiresInMs = (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000;
  cachedToken = data.access_token;
  cachedExpiresAt = Date.now() + expiresInMs;
  return cachedToken;
}

async function getAccessToken() {
  if (cachedToken && cachedExpiresAt - Date.now() > EXPIRY_MARGIN_MS) {
    return cachedToken;
  }
  if (inflightMint) return inflightMint;
  inflightMint = mintAccessToken().finally(() => {
    inflightMint = null;
  });
  return inflightMint;
}

/**
 * Clears the in-process access-token cache (value + expiry + in-flight mint).
 * Used both as a test hook AND in production by `jiraFetch` on a 401, to force
 * a fresh mint when the cached bearer has been revoked mid-lifetime — not
 * test-only, do not remove.
 */
export function _resetAuthCache() {
  cachedToken = null;
  cachedExpiresAt = 0;
  inflightMint = null;
}

/**
 * Authenticated fetch against the Jira gateway with a single 401 re-mint
 * retry. Injects a fresh Bearer + per-attempt timeout signal.
 *
 * A 401 on a warm container most likely means the cached bearer was
 * force-revoked mid-lifetime (an admin revoking the NSA credential for-cause;
 * note that rotating the CyberArk clientSecret does NOT invalidate
 * already-issued bearers). Without this retry, every warm-container invocation
 * would keep sending the dead token and 401 until `cachedExpiresAt` lapses
 * (up to ~59 min). Clearing the cache and re-minting once lets the container
 * self-heal immediately.
 *
 * 403 is deliberately NOT retried: it signals insufficient scope/permissions,
 * which a re-mint with the same credential cannot fix — retrying would just
 * double the latency before the caller's bulkhead logs the failure.
 */
async function jiraFetch(url, { method = 'GET', headers = {}, body } = {}) {
  const attempt = async () => {
    const token = await getAccessToken();
    return fetch(url, {
      method,
      headers: { ...headers, Authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };
  const res = await attempt();
  if (res.status !== 401) return res;
  _resetAuthCache();
  return attempt();
}

/**
 * Look up an existing AABSP issue by Feedback ID custom field. Used as
 * the idempotency check before `createIssue` so duplicate parquet replays
 * (DLQ replay, Lambda retry, S3 double-fire) do not double-create tickets.
 *
 * Searches `cf[36238]` (the typed Feedback ID textfield) rather than a
 * `feedback-id-<id>` label so the labels column stays clean (`AAB-App`
 * only). Field ID is locked in the AABSP project metadata; if Jira admin
 * ever recreates the field with a new ID, update CUSTOM_FIELD_IDS in
 * jira-mapping.mjs and FEEDBACK_ID_CUSTOM_FIELD_ID below in lockstep.
 *
 * @returns {Promise<string|null>} Issue key (e.g. "AABSP-42") or null.
 */
// Strict whitelists for JQL string interpolation. Both inputs are server-
// controlled today (projectKey from CDK config, feedbackId from randomUUID),
// but a defensive boundary check makes injection physically impossible
// regardless of upstream contract changes — and produces a much clearer
// error than a 400 from Atlassian if either ever takes an unexpected shape.
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}$/;
const FEEDBACK_ID_PATTERN = /^[a-zA-Z0-9-]+$/; // UUIDv4 + safety margin
const FEEDBACK_ID_CUSTOM_FIELD_ID = 36238;

export async function findIssueByFeedbackId({ baseUrl, projectKey, feedbackId }) {
  if (!PROJECT_KEY_PATTERN.test(projectKey)) {
    throw new Error(`jira projectKey rejected: "${projectKey}" must match ${PROJECT_KEY_PATTERN}`);
  }
  if (!FEEDBACK_ID_PATTERN.test(feedbackId)) {
    throw new Error(`jira feedbackId rejected: "${feedbackId}" must match ${FEEDBACK_ID_PATTERN}`);
  }
  const jql = encodeURIComponent(`project = "${projectKey}" AND cf[${FEEDBACK_ID_CUSTOM_FIELD_ID}] = "${feedbackId}"`);
  // Atlassian REST v3 endpoint is `/rest/api/3/search/jql` — the older
  // `/rest/api/3/search` was REMOVED (returns 410 with "The requested API
  // has been removed. Please migrate to the /rest/api/3/search/jql API"
  // per Atlassian changelog CHANGE-2046).
  const url = `${baseUrl}/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=1`;

  const res = await jiraFetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`jira search ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const issue = data.issues?.[0];
  return issue?.key ?? null;
}

/**
 * Create a new Jira issue. Body must conform to Atlassian REST v3
 * create-issue shape (`fields.summary`, `fields.description` (ADF),
 * `fields.issuetype.name`, `fields.project.key`, etc).
 *
 * @returns {Promise<{id: string, key: string, self: string}>}
 */
export async function createIssue({ baseUrl, body }) {
  const url = `${baseUrl}/rest/api/3/issue`;

  const res = await jiraFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`jira create ${res.status}: ${await res.text()}`);
  }

  return await res.json();
}
