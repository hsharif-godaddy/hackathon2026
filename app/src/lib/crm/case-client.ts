/**
 * CRM case-creation client.
 *
 * Opens a standard support case in GoDaddy CRM on the customer's behalf.
 * Runs entirely server-side: mints a cert-based SSO JWT, pulls contact info
 * from the Profile API, then POSTs the case body to the CRM
 * case-management endpoint. Severity pinned to S2 for all categories;
 * Salesforce routing distinguishes issue / support / feedback via the
 * literal `[ISSUE]` / `[SUPPORT]` / `[FEEDBACK NPS X]` marker prefix in
 * `additionalData.escalationDetails` (CRM strips unsupported keys, so we
 * encode the category in text rather than a separate field).
 */

import { randomUUID } from 'node:crypto';

import { type FeedbackCategory } from '@/lib/feedback/category';
import { logger } from '@/lib/request-context';
import { airoCertTokenService } from './airo-cert-token';
import { MAX_DESCRIPTION_CHARS } from './constants';
import { type CustomerProfile, fetchCustomerProfile } from './profile-client';

export type { FeedbackCategory };
export { MAX_DESCRIPTION_CHARS } from './constants';

const DEFAULT_CRM_API_BASE = 'https://crm.int.test-godaddy.com';
const CASE_PATH = '/api/case-management/v1/case';
const LOG_DOMAIN = 'feedback.crm.case-client';

/**
 * Discriminated union: `rating` is required when category === 'feedback'
 * and forbidden otherwise. `customerConsent` is captured for feedback so
 * the CRM caseNote audit trail shows whether the customer agreed to be
 * contacted (compliance — distinguishes "declined" from "missing").
 *
 * `topics` is `readonly` to match the immutable-data-flow guideline:
 * once a request crosses the BFF boundary into this client, the array
 * shouldn't be mutated.
 */
interface OpenCaseInputBase {
  customerId: string;
  shopperId: string;
  description: string;
  appId: string | null;
  topics?: readonly string[];
}

export interface OpenCaseIssueInput extends OpenCaseInputBase {
  category: 'issue';
}
export interface OpenCaseSupportInput extends OpenCaseInputBase {
  category: 'support';
}
export interface OpenCaseFeedbackInput extends OpenCaseInputBase {
  category: 'feedback';
  /** Required for feedback. Validated 1 ≤ rating < 5 by the caller. */
  rating: number;
  /**
   * Strict boolean — `validateFanoutPayload` rejects `undefined`. We
   * stamp this on the escalationDetails / caseNote so support agents
   * (and audit) can tell consenting feedback from declined feedback.
   */
  customerConsent: boolean;
}

export type OpenCaseInput =
  | OpenCaseIssueInput
  | OpenCaseSupportInput
  | OpenCaseFeedbackInput;

export interface OpenCaseResult {
  caseId?: string;
  caseNumber?: string;
  /**
   * True when CRM returned 2xx but the body could not be parsed (empty,
   * non-JSON, or no recognized id field). The case may or may not have
   * actually been filed; the caller should treat this as a soft failure
   * — surface a warning to the user, do not retry blindly. See
   * `extractCaseIds` for the parse contract.
   */
  incomplete?: boolean;
}

function getCrmApiBase(): string {
  return process.env.CRM_API_BASE || DEFAULT_CRM_API_BASE;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

// Field names and string values must match CRM's spec exactly — keys are
// camelCase, boolean-style values are lowercase strings ('true' not 'TRUE').
// CRM silently drops keys not in the spec (e.g. capitalized 'Type',
// 'Permission to Make Changes', 'Escalation Details', or unsupported keys
// like `flow`/`appId`). Category routing is encoded in escalationDetails
// text so Salesforce can match on a literal marker.
interface AdditionalData {
  permissionToMakeChanges: 'true';
  severity: 'S2';
  escalated: 'true';
  type: 'Complete';
  escalationDetails: string;
}

interface CrmCaseBody {
  contactName: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone?: string;
  shopperId: string;
  recordType: 'standard';
  status: 'Open';
  caseOrigin: 'Automation';
  primaryCategory: 'Websites';
  secondaryCategory: 'Airo AI Builder';
  issue: 'General Support';
  // Provided to opt into CMAPI async case creation (Confluence:
  // "CMAPI Async Case Creation", Feb 2026). Without this CMAPI runs
  // synchronously through Salesforce — P99 ~5s, ~9% of calls > 10s, tail
  // > 15s — which timed out our 15s AbortSignal in test-godaddy. Async
  // returns 202/200 with `referenceId` immediately while the actual case
  // is created in the background. Format:
  //   `airo-{customerId}-{appId|na}-{epochMs}-{uuid8}`
  // — customerId + UUID suffix together prevent rapid double-submit
  // collisions and cross-customer collisions on the missing-appId path.
  externalSystemId: string;
  caseNotes: Array<{
    note: string;
    noteType: 'Status Change';
    noteTypeDetails: 'Escalation';
  }>;
  additionalData: AdditionalData;
}

// Category routing for Salesforce: encoded in escalationDetails text because
// CRM strips additionalData keys that aren't in its spec. The literal
// `[ISSUE]` / `[SUPPORT]` / `[FEEDBACK NPS X]` prefix is a routing contract.
// `feedback` includes a consent marker so support agents can tell at a
// glance whether the customer opted in for follow-up.
function buildEscalationDetails(
  input: OpenCaseInput,
  truncatedDescription: string,
): string {
  const topicsLine = input.topics && input.topics.length > 0
    ? ` | Topics: ${input.topics.join(', ')}`
    : '';
  switch (input.category) {
    case 'issue':
      return `[ISSUE] ${truncatedDescription}`;
    case 'support':
      return `[SUPPORT] ${truncatedDescription}${topicsLine}`;
    case 'feedback': {
      // Discriminated union guarantees rating + customerConsent are
      // present here; no `??` fallbacks needed (the old `?? '?'`
      // fallback would have produced `[FEEDBACK NPS ?]` on a regression
      // — flagged by review F-6).
      const consentMarker = input.customerConsent ? 'consent=yes' : 'consent=no';
      return `[FEEDBACK NPS ${input.rating} | ${consentMarker}] ${truncatedDescription}${topicsLine}`;
    }
  }
}

export function buildCaseBody(input: OpenCaseInput, profile: CustomerProfile): CrmCaseBody {
  const truncatedDescription = truncate(input.description, MAX_DESCRIPTION_CHARS);
  const escalationDetails = buildEscalationDetails(input, truncatedDescription);

  const additionalData: AdditionalData = {
    permissionToMakeChanges: 'true',
    severity: 'S2',
    escalated: 'true',
    type: 'Complete',
    escalationDetails,
  };

  // Note shape is a CRM contract: support tooling looks for the literal
  // "Comment :" prefix and the `(appid - <id>)` segment when triaging.
  // Use escalationDetails (with category marker + consent marker for
  // feedback) so the note carries the same routing prefix as
  // additionalData.escalationDetails.
  const appIdSegment = input.appId ? `(appid - ${input.appId}) ` : '';
  const note = `Comment : ${appIdSegment}${escalationDetails}`;

  // See the field-doc on `externalSystemId` above for the format reasoning.
  const externalSystemId = `airo-${input.customerId}-${input.appId ?? 'na'}-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const body: CrmCaseBody = {
    contactName: `${profile.firstName} ${profile.lastName}`.trim(),
    contactFirstName: profile.firstName,
    contactLastName: profile.lastName,
    contactEmail: profile.email,
    shopperId: input.shopperId,
    recordType: 'standard',
    status: 'Open',
    caseOrigin: 'Automation',
    primaryCategory: 'Websites',
    secondaryCategory: 'Airo AI Builder',
    issue: 'General Support',
    externalSystemId,
    caseNotes: [
      {
        note,
        noteType: 'Status Change',
        noteTypeDetails: 'Escalation',
      },
    ],
    additionalData,
  };

  if (profile.phone) {
    body.contactPhone = profile.phone;
  }

  return body;
}

type CaseIdSource = 'id' | 'caseId' | 'referenceId' | 'externalSystemId';

interface ExtractedCaseIds {
  caseId?: string;
  caseNumber?: string;
  /** Which response field the caseId came from. Used for log diagnostics
   *  so we can tell async (referenceId) from legacy sync (id) at a glance. */
  caseIdSource?: CaseIdSource;
}

/**
 * Returns null when the body could not be parsed as JSON. Empty body counts as
 * unparseable. Callers should distinguish "parsed but no caseId field" (data
 * issue worth a warning) from "could not parse" (worth a louder warning, since
 * the case may still have been filed).
 */
function extractCaseIds(responseText: string): ExtractedCaseIds | null {
  if (!responseText) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    return null;
  }
  const payload = (typeof parsed.data === 'object' && parsed.data !== null
    ? (parsed.data as Record<string, unknown>)
    : parsed);
  // CMAPI moved to async case creation in Feb 2026 (Confluence
  // "CMAPI Async Case Creation"). New response shape:
  //   { status: "ACCEPTED", referenceId: "EXT-...", message, timestamp }
  // The legacy sync shape was { id, created, allObjects } and is still
  // returned by some routes / older deployments, so we accept both. The
  // `referenceId` becomes our caseId for downstream linking — async mode
  // doesn't return a real Salesforce caseNumber; that has to be fetched
  // later via GET ?externalId=<referenceId>.
  let caseId: string | undefined;
  let caseIdSource: CaseIdSource | undefined;
  if (typeof payload.id === 'string') {
    caseId = payload.id;
    caseIdSource = 'id';
  } else if (typeof payload.caseId === 'string') {
    caseId = payload.caseId;
    caseIdSource = 'caseId';
  } else if (typeof payload.referenceId === 'string') {
    caseId = payload.referenceId;
    caseIdSource = 'referenceId';
  } else if (typeof payload.externalSystemId === 'string') {
    caseId = payload.externalSystemId;
    caseIdSource = 'externalSystemId';
  }
  const caseNumber = typeof payload.caseNumber === 'string' ? payload.caseNumber
    : typeof payload.number === 'string' ? payload.number
      : undefined;
  return { caseId, caseNumber, caseIdSource };
}

export async function openCrmCase(input: OpenCaseInput): Promise<OpenCaseResult> {
  const token = await airoCertTokenService.getToken();
  const profile = await fetchCustomerProfile(input.customerId, token);
  const body = buildCaseBody(input, profile);

  const url = `${getCrmApiBase()}${CASE_PATH}`;
  logger.info(`${LOG_DOMAIN}.post.start`, {
    url,
    customerId: input.customerId,
    appId: input.appId,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `sso-jwt ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    // 30s defends against the CMAPI sync tail (~9% of case creations >10s,
    // some >15s per CMAPI Monitoring page 4246505268). With externalSystemId
    // now in the body CMAPI should respond in <1s, but fall back to the
    // wider envelope for the case where async hasn't rolled out yet.
    signal: AbortSignal.timeout(30_000),
  });

  const responseText = await res.text().catch(() => '');

  if (!res.ok) {
    const snippet = responseText.slice(0, 300);
    logger.error(`${LOG_DOMAIN}.post.failed`, {
      status: res.status,
      customerId: input.customerId,
      appId: input.appId,
      responseSnippet: snippet,
    });
    throw new Error(`CRM case request failed (${res.status}): ${snippet}`);
  }

  const parsed = extractCaseIds(responseText);
  if (parsed === null) {
    // 2xx with empty or non-JSON body — the case may still have been filed,
    // so we don't throw, but flag loudly: there's no audit trail without a
    // caseId, and silent success would mask a CRM API contract change.
    // Returning `incomplete: true` lets the route surface a `crmIncomplete`
    // warning so the UI / support tooling can disambiguate from a
    // genuinely-failed (thrown) case.
    logger.warn(`${LOG_DOMAIN}.post.parse_failed`, {
      status: res.status,
      customerId: input.customerId,
      appId: input.appId,
      responseSnippet: responseText.slice(0, 300),
    });
    return { incomplete: true };
  }

  if (!parsed.caseId) {
    // 2xx with parseable JSON but no recognized id field — same risk as
    // parse-failed: the case may have been filed but we have no id to
    // link a note to. Distinct log so dashboards can tell the two apart.
    logger.warn(`${LOG_DOMAIN}.post.no_case_id`, {
      status: res.status,
      customerId: input.customerId,
      appId: input.appId,
      responseSnippet: responseText.slice(0, 300),
    });
    return { incomplete: true };
  }

  logger.info(`${LOG_DOMAIN}.post.success`, {
    status: res.status,
    customerId: input.customerId,
    appId: input.appId,
    caseId: parsed.caseId,
    caseNumber: parsed.caseNumber,
    caseIdSource: parsed.caseIdSource,
  });

  return { caseId: parsed.caseId, caseNumber: parsed.caseNumber };
}
