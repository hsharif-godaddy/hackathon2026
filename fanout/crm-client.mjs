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
