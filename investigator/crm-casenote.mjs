/**
 * Adds a CRM case note via CMAPI's dedicated note-creation endpoint.
 *
 * CMAPI exposes only POST routes for case mutation (Confluence
 * "Case Management API (CMAPI)", page 3609988873):
 *   - POST /v1/case        — create a new case
 *   - POST /v1/case/note   — add a note to an existing case
 * There is no documented PATCH /v1/case/{id}; an earlier revision of this
 * file used one and likely 404'd on every call.
 *
 * The note endpoint takes either `caseRecordId` (Salesforce ID) or
 * `caseExternalId` ("Assigned External ID"). The BFF opens cases via async
 * CMAPI (Confluence "CMAPI Async Case Creation", page 4248897195), so the
 * `caseId` we receive is the externalSystemId / referenceId we sent at
 * create time — never a Salesforce record ID. Pass it as `caseExternalId`
 * and CMAPI resolves it to the real case server-side.
 *
 * If a future caller hands us a real Salesforce record ID (15/18-char
 * "500..." prefix) we still use `caseRecordId` so the same helper works
 * for both sync and async creation paths.
 *
 * Throws on non-2xx; callers wrap in try/catch for best-effort delivery so
 * a CRM failure doesn't block investigation result delivery to the user.
 */

import { mintCrmSsoJwt } from './crm-token.mjs';

const CASE_NOTE_PATH = '/api/case-management/v1/case/note';

// Salesforce Case record IDs: 15-char base62 starting with the "500" object
// prefix (or 18-char with checksum). Anything else (e.g. our "airo-..."
// externalSystemId) goes through the caseExternalId path.
const SF_CASE_ID_PATTERN = /^500[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/;

/**
 * Adds a note to an existing CRM case via CMAPI POST /v1/case/note.
 *
 * The legacy export name `patchCrmCaseNote` is preserved as an alias below
 * for backward compatibility with any external callers that still import it
 * — internal code should use `addCrmCaseNote`. The "patch" name was a
 * leftover from an early revision that incorrectly tried PATCH /case/{id}
 * (an endpoint CMAPI never exposed); the operation has always been a POST
 * /v1/case/note that adds a new note to the case, not an in-place update.
 *
 * @param {{ caseId: string; summary: string; reportUrl: string }} opts
 * @returns {Promise<void>}
 */
export async function addCrmCaseNote({ caseId, summary, reportUrl }) {
  const base = process.env.CRM_API_BASE;
  if (!base) throw new Error('CRM_API_BASE env var not set');

  const token = await mintCrmSsoJwt();
  const note = `AI Investigation: ${summary}. Full report: ${reportUrl}`;
  const url = `${base}${CASE_NOTE_PATH}`;

  // CMAPI accepts caseRecordId (SF ID) OR caseExternalId — pick the right
  // field based on the shape of the value we have. Defaults to externalId
  // because that's what the async create flow gives us.
  const body = SF_CASE_ID_PATTERN.test(caseId)
    ? { caseRecordId: caseId, note, noteType: 'Status Change', noteTypeDetails: 'Escalation' }
    : { caseExternalId: caseId, note, noteType: 'Status Change', noteTypeDetails: 'Escalation' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `sso-jwt ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`CRM caseNote POST failed (${res.status}): ${snippet}`);
  }
}

// Legacy alias — keep until all in-tree callers move off `patchCrmCaseNote`.
// Removing this without coordinating with anything that still imports the
// old name would surface as a runtime "is not a function" only inside the
// Lambda, where we have no graceful fallback.
export const patchCrmCaseNote = addCrmCaseNote;
