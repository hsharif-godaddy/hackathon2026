/**
 * Adds a note to an existing CRM case via CMAPI POST /v1/case/note.
 *
 * Mirrors the Lambda's `investigator/crm-casenote.mjs` so the BFF can append
 * notes without round-tripping through the investigator. Used on the
 * fan-out reuse path: when a fresh feedback submission is deduplicated
 * against an in-flight investigation, we still create a fresh CRM case
 * (per product contract: "always file a case") but the new case has zero
 * AI context. Posting a note here at submit time with the investigate-URL
 * link gives support agents an immediate path back to the in-flight run
 * without waiting for that run's terminal write to land.
 *
 * Design notes:
 *   - Reuses `airoCertTokenService` for SSO JWT minting (cached + inflight
 *     coalesced, same as openCrmCase).
 *   - Branches on Salesforce 15-char object-prefix format ("500…") to
 *     decide between `caseRecordId` (real SF ID) and `caseExternalId`
 *     (CMAPI async referenceId / our externalSystemId). The async create
 *     path returns referenceId, so most calls go through caseExternalId.
 *   - 30s timeout matches openCrmCase's tail tolerance for CMAPI's mixed
 *     sync/async pipeline (~9% of calls >10s, some >15s per CMAPI
 *     Monitoring 4246505268). Notes share the same backend envelope as
 *     case creation; using the same upper bound keeps both sides of the
 *     lifecycle in lockstep.
 */

import { logger } from '@/lib/request-context';
import { airoCertTokenService } from './airo-cert-token';

const DEFAULT_CRM_API_BASE = 'https://crm.int.test-godaddy.com';
const CASE_NOTE_PATH = '/api/case-management/v1/case/note';
const LOG_DOMAIN = 'feedback.crm.case-note-client';

// Mirrors `SF_CASE_ID_PATTERN` in investigator/crm-casenote.mjs. 15-char
// base62 starting with "500" (Salesforce Case object prefix); 18-char with
// checksum is also accepted.
const SF_CASE_ID_PATTERN = /^500[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/;

function getCrmApiBase(): string {
  return process.env.CRM_API_BASE || DEFAULT_CRM_API_BASE;
}

export interface AddCaseNoteInput {
  caseId: string;
  note: string;
}

/**
 * XOR union: the body always carries exactly one of `caseRecordId` (real
 * Salesforce ID) or `caseExternalId` (our externalSystemId / CMAPI async
 * referenceId), never both, never neither. Using `?: never` on the
 * opposite arm catches a regression at compile time instead of letting
 * CMAPI 400 us back at runtime — flagged by review F-7.
 */
type CaseNoteBody =
  | {
      caseRecordId: string;
      caseExternalId?: never;
      note: string;
      noteType: 'Status Change';
      noteTypeDetails: 'Escalation';
    }
  | {
      caseRecordId?: never;
      caseExternalId: string;
      note: string;
      noteType: 'Status Change';
      noteTypeDetails: 'Escalation';
    };

export async function addCrmCaseNote(input: AddCaseNoteInput): Promise<void> {
  const token = await airoCertTokenService.getToken();
  const url = `${getCrmApiBase()}${CASE_NOTE_PATH}`;
  const isSalesforceId = SF_CASE_ID_PATTERN.test(input.caseId);
  const body: CaseNoteBody = isSalesforceId
    ? { caseRecordId: input.caseId, note: input.note, noteType: 'Status Change', noteTypeDetails: 'Escalation' }
    : { caseExternalId: input.caseId, note: input.note, noteType: 'Status Change', noteTypeDetails: 'Escalation' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `sso-jwt ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    // Note POSTs are always best-effort by design (dedup cross-link + Lambda
    // terminal summary). The caller decides severity by what it does with
    // the throw; this client must NOT log at `error` because that triggers
    // pager alarms via the airo-builder-ui error-rate dashboard. A failed
    // cross-link is annoying, not actionable. The caller logs at warn after
    // catching, so this client stays at warn to avoid double-paging on the
    // same event with mismatched severity.
    logger.warn(`${LOG_DOMAIN}.post.failed`, {
      status: res.status,
      caseId: input.caseId,
      idShape: isSalesforceId ? 'salesforce' : 'external',
      responseSnippet: snippet,
    });
    throw new Error(`CRM caseNote POST failed (${res.status}): ${snippet}`);
  }
  logger.info(`${LOG_DOMAIN}.post.success`, {
    caseId: input.caseId,
    idShape: isSalesforceId ? 'salesforce' : 'external',
  });
}
