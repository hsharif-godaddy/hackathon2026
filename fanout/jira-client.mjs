import { getSecretString } from './secret-cache.mjs';

// Bound every Jira call to 15s — matches the CRM client pattern. Atlassian
// Cloud has had multi-minute partial outages historically; without a
// timeout a hung call would consume the full 60s Lambda timeout and
// land in DLQ. With it we fail fast inside the bulkhead try/catch so
// other downstreams complete normally.
const TIMEOUT_MS = 15_000;

/**
 * Atlassian Cloud REST client. Uses Basic auth with a service-account
 * email + API token (Atlassian OAuth 3LO does not support a clean
 * client_credentials grant; a long-lived API token is the supported
 * non-interactive path).
 *
 * URL pattern is the tenant site URL directly (NOT the
 * api.atlassian.com gateway, which expects OAuth bearers):
 *   https://<site>.atlassian.net/rest/api/3/...
 *
 * Secret JSON shape: {"email": "<sa-email>", "apiToken": "<token>"}.
 * Cached in-process to avoid hitting Secrets Manager every invocation.
 */

const PLACEHOLDER_VALUE = 'REPLACE_ME';

// 5-minute TTL on the in-process Basic auth string. Without this, a warm
// Lambda container holds the FIRST cachedAuth value for the lifetime of
// the container (hours/days). When ops rotates the Jira API token in
// Secrets Manager, the cold-start case picks up the new token but every
// warm container keeps sending the old Basic header to Atlassian → 401
// for the rest of that container's life. With a 5-min TTL, warm
// containers re-fetch from `getSecretString` (itself 5-min cached) so a
// rotated secret propagates within ~5-10 min instead of never. Matches
// the secret-cache.mjs TTL so we don't double-cache stale.
const AUTH_TTL_MS = 5 * 60 * 1000;

let cachedAuth = null;
let cachedAt = 0;

async function getBasicAuth() {
  if (cachedAuth && Date.now() - cachedAt < AUTH_TTL_MS) return cachedAuth;
  const raw = await getSecretString(process.env.JIRA_API_TOKEN_SECRET_ARN);
  const { email, apiToken } = JSON.parse(raw);
  if (!email || !apiToken) {
    throw new Error('jira secret missing email or apiToken');
  }
  // Throwing a sentinel error instead of attempting Basic auth lets the
  // bulkhead in `handler.mjs` log a clear `fanout.jira.failed` with a
  // distinct message — a real 401 from Atlassian would be far more
  // confusing to triage than "Jira secret not yet populated by ops".
  if (email === PLACEHOLDER_VALUE || apiToken === PLACEHOLDER_VALUE) {
    throw new Error('jira secret still has REPLACE_ME placeholder — ops needs to fill secret value');
  }
  cachedAuth = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
  cachedAt = Date.now();
  return cachedAuth;
}

/** Test hook — clears the in-process Basic auth cache (TTL + value). */
export function _resetAuthCache() {
  cachedAuth = null;
  cachedAt = 0;
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
  const auth = await getBasicAuth();
  const jql = encodeURIComponent(`project = "${projectKey}" AND cf[${FEEDBACK_ID_CUSTOM_FIELD_ID}] = "${feedbackId}"`);
  // Atlassian REST v3 endpoint is `/rest/api/3/search/jql` — the older
  // `/rest/api/3/search` was REMOVED (returns 410 with "The requested API
  // has been removed. Please migrate to the /rest/api/3/search/jql API"
  // per Atlassian changelog CHANGE-2046).
  const url = `${baseUrl}/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=1`;

  const res = await fetch(url, {
    headers: {
      Authorization: auth,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

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
  const auth = await getBasicAuth();
  const url = `${baseUrl}/rest/api/3/issue`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`jira create ${res.status}: ${await res.text()}`);
  }

  return await res.json();
}
