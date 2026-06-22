import { mintCrmSsoJwt } from './crm-token.mjs';

const TIMEOUT_MS = 30_000;
const CASE_PATH = '/api/case-management/v1/case';
const NOTE_PATH = '/api/case-management/v1/case/note';

async function authedFetch({ crmBaseUrl, path, init }) {
  const token = await mintCrmSsoJwt();
  const url = `${crmBaseUrl}${path}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `sso-jwt ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/**
 * POST /v1/case — open new CRM case (or upsert via externalSystemId).
 *
 * Returns: { caseId, caseNumber, referenceId, created }
 *   caseId        — SF Record ID (18-char, e.g. 500U900000TP4kYIAT). null if response shape differs.
 *   caseNumber    — human-readable case number (e.g. 00012345). null if missing.
 *   referenceId   — async-mode CMAPI reference ID. Only present when CMAPI returns 202.
 *   created       — true on insert, false on upsert (existing externalSystemId match).
 *
 * Throws on 4xx/5xx.
 */
export async function postCase({ crmBaseUrl, body }) {
  const res = await authedFetch({
    crmBaseUrl,
    path: CASE_PATH,
    init: { method: 'POST', body: JSON.stringify(body) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`CMAPI POST ${res.status}: ${text.slice(0, 300)}`);
  }
  let parsed = {};
  try { parsed = JSON.parse(text); } catch {}
  return {
    caseId: parsed.id ?? parsed.caseId ?? null,
    caseNumber: parsed.caseNumber ?? null,
    referenceId: parsed.referenceId ?? null,
    created: parsed.created ?? null,
  };
}

/**
 * GET /v1/case?caseId=... — fetch case state.
 *
 * Returns the first case object from `data.cases[]` or null when not found.
 * Throws on non-2xx (404 surfaces as null).
 */
export async function getCase({ crmBaseUrl, caseId }) {
  const path = `${CASE_PATH}?caseId=${encodeURIComponent(caseId)}&includeNotes=internal`;
  const res = await authedFetch({ crmBaseUrl, path, init: { method: 'GET' } });
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`CMAPI GET ${res.status}: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text);
  const cases = parsed?.data?.cases ?? [];
  return cases.length > 0 ? cases[0] : null;
}

/**
 * GET /v1/case?recordTypes=escalated&onlyOpen=true — list a customer's open
 * escalated cases.
 *
 * Used to capture the escalated child case SF auto-creates from our standard
 * case (no API field links the two, so we correlate by caseNumber adjacency +
 * Airo-Builder scope at the call site). `onlyOpen=true` filters server-side to
 * unresolved cases; `secondaryCategory` is NOT a CMAPI query param, so the
 * caller filters returned cases down to "Airo AI Builder" client-side.
 *
 * Prefers `shopperId` (CMAPI returns all cases on that shopper's account);
 * falls back to `customerId`. Returns the raw `data.cases[]` array (possibly
 * empty); throws on non-2xx other than 404 (→ []).
 */
export async function findEscalatedCases({ crmBaseUrl, shopperId, customerId }) {
  const params = new URLSearchParams({ recordTypes: 'escalated', onlyOpen: 'true' });
  if (shopperId) params.set('shopperId', shopperId);
  else if (customerId) params.set('customerId', customerId);
  const path = `${CASE_PATH}?${params.toString()}`;
  const res = await authedFetch({ crmBaseUrl, path, init: { method: 'GET' } });
  const text = await res.text();
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`CMAPI GET escalated ${res.status}: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text);
  return parsed?.data?.cases ?? [];
}

/**
 * GET /v1/case?externalId=... — async-mode case lookup.
 *
 * CMAPI async POST returns only `referenceId` (= the externalSystemId we
 * sent) — no SF Record ID, no caseNumber. Both materialize once SF
 * Adapter → SF Connect → Salesforce finishes (~4–5s P99 per CMAPI
 * Monitoring). Use this GET to poll for the SF Record ID + caseNumber.
 *
 * Returns the first matching case object from `data.cases[]`, or null
 * when the case hasn't been created yet (or 404). Throws on other
 * non-2xx responses.
 */
export async function getCaseByExternalId({ crmBaseUrl, externalId }) {
  const path = `${CASE_PATH}?externalId=${encodeURIComponent(externalId)}`;
  const res = await authedFetch({ crmBaseUrl, path, init: { method: 'GET' } });
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`CMAPI GET ${res.status}: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text);
  const cases = parsed?.data?.cases ?? [];
  return cases.length > 0 ? cases[0] : null;
}

/**
 * Poll `getCaseByExternalId` with exponential backoff to resolve the
 * Salesforce Record ID + caseNumber after an async POST.
 *
 * Delays in ms: [0, 500, 1000, 2000] (+ ≤100ms jitter) — first attempt
 * fires immediately, total worst-case ~3.5s. CMAPI Create Case P99 is
 * ~4–5s, so by design we time out on the slow tail rather than block
 * the customer-facing fanout for >5s. Trade-off: ~P50 submissions get
 * the Slack link inline; the slow tail falls back to a Slack post
 * without the link (the case is still created, just not linked).
 * Jitter prevents a thundering herd when multiple submissions for the
 * same customer/app land on identical schedules.
 *
 * We require BOTH `caseRecordId` AND `caseNumber` before returning
 * because Salesforce creates Case records atomically — a Case row
 * always has both fields populated by the moment SF returns it through
 * SF Adapter. If the GET sees `caseRecordId` but no `caseNumber`,
 * SF Adapter's projection hasn't fully assembled the record yet
 * (mid-write), so it's safer to keep polling than to render a partial
 * Slack link without a customer-facing case number. In practice both
 * fields land together on the first hit.
 *
 * Returns `{ caseRecordId, caseNumber }` on first success, or null when
 * all attempts return empty / fail. Per-attempt errors are split:
 * non-retryable failures (auth 401/403, missing cert/key secret —
 * reflecting misconfig rather than transient CMAPI lag) abort the
 * loop and log under `fanout.crm.resolve.unauthorized`; everything
 * else logs `fanout.crm.resolve.attempt_failed` and keeps polling.
 */
// Non-retryable = auth/identity misconfig that won't fix itself by polling.
// We anchor on:
//   - HTTP status patterns "401" / "403" embedded in our `CMAPI GET <code>` errors
//     (see `getCaseByExternalId` throw path)
//   - explicit auth keywords from CMAPI/SSO bodies ("Unauthorized" / "Forbidden")
//   - cert / SSO mint failures from `mintCrmSsoJwt` ("certificate", "private key",
//     "api key" — broader than `cert`/`key` to avoid false positives like
//     "missing required key 'foo'" from CMAPI 4xx validation messages and to
//     correctly catch "certificate expired").
// Anything else (5xx, 404, network blips) is treated as retryable.
function isUnretryable(err) {
  const msg = err?.message ?? '';
  return /\b(?:401|403)\b|\b(?:Unauthorized|Forbidden|certificate|private key|api key)\b/i.test(msg);
}

export async function resolveCaseAsync({ crmBaseUrl, externalId, log, context = {} }) {
  const delays = [0, 500, 1000, 2000];
  for (const delay of delays) {
    if (delay > 0) {
      const jitter = Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay + jitter));
    }
    try {
      const c = await getCaseByExternalId({ crmBaseUrl, externalId });
      if (c?.caseRecordId && c?.caseNumber) {
        return { caseRecordId: c.caseRecordId, caseNumber: c.caseNumber };
      }
    } catch (err) {
      if (isUnretryable(err)) {
        log?.('warn', 'fanout.crm.resolve.unauthorized', {
          ...context, externalId, delay, error: err.message,
        });
        return null;
      }
      log?.('warn', 'fanout.crm.resolve.attempt_failed', {
        ...context, externalId, delay, error: err.message,
      });
    }
  }
  log?.('warn', 'fanout.crm.resolve.timeout', {
    ...context, externalId, attempts: delays.length,
  });
  return null;
}

/**
 * POST /v1/case/note — append a note.
 *
 * `noteTypeDetails: 'Escalation'` matches the legacy BFF's case-creation
 * shape so dedup notes / investigator-kickoff notes carry the same routing
 * prefix support tooling triages on.
 */
export async function postNote({ crmBaseUrl, caseRecordId, note }) {
  const body = {
    caseRecordId,
    note,
    noteType: 'Status Change',
    noteTypeDetails: 'Escalation',
  };
  const res = await authedFetch({
    crmBaseUrl,
    path: NOTE_PATH,
    init: { method: 'POST', body: JSON.stringify(body) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CMAPI note ${res.status}: ${text.slice(0, 300)}`);
  }
}
