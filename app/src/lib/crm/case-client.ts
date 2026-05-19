/**
 * CRM case-creation client.
 *
 * Opens a standard support case in GoDaddy CRM on the customer's behalf.
 * Runs entirely server-side: mints a cert-based SSO JWT, pulls contact info
 * from the Profile API, then POSTs the case body to the CRM
 * case-management endpoint. Severity is pinned to S2 for v1; revisit after
 * we see submission volume.
 */

import { logger } from '@/lib/request-context';
import { airoCertTokenService } from './airo-cert-token';
import { type CustomerProfile, fetchCustomerProfile } from './profile-client';

const DEFAULT_CRM_API_BASE = 'https://crm.int.test-godaddy.com';
const CASE_PATH = '/api/case-management/v1/case';
const LOG_DOMAIN = 'feedback.crm.case-client';
// Defense-in-depth cap on description size sent to CRM. The feedback form
// does not enforce a client-side maxLength yet; tracking that as a follow-up.
const MAX_NOTE_CHARS = 4000;

export interface OpenCaseInput {
  customerId: string;
  shopperId: string;
  description: string;
  appId: string | null;
}

export interface OpenCaseResult {
  caseId?: string;
  caseNumber?: string;
}

function getCrmApiBase(): string {
  return process.env.CRM_API_BASE || DEFAULT_CRM_API_BASE;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

// Field names and string values must match CRM's spec exactly — keys are
// camelCase, boolean-style values are lowercase ('true' not 'TRUE'). CRM
// silently drops keys that don't match the spec (e.g. capitalized 'Type',
// 'Permission to Make Changes', or 'Escalation Details').
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
  caseNotes: Array<{
    note: string;
    noteType: 'Status Change';
    noteTypeDetails: 'Escalation';
  }>;
  additionalData: AdditionalData;
}

export function buildCaseBody(input: OpenCaseInput, profile: CustomerProfile): CrmCaseBody {
  const truncatedDescription = truncate(input.description, MAX_NOTE_CHARS);
  const additionalData: AdditionalData = {
    permissionToMakeChanges: 'true',
    severity: 'S2',
    escalated: 'true',
    type: 'Complete',
    // Same cap as caseNotes — the route accepts an unbounded description, so
    // multi-MB textarea submissions could otherwise reach CRM verbatim.
    escalationDetails: truncatedDescription,
  };

  // Note shape is a CRM contract: support tooling looks for the literal
  // "Comment :" prefix and the `(appid - <id>)` segment when triaging.
  const appIdSegment = input.appId ? `(appid - ${input.appId}) ` : '';
  const note = `Comment : ${appIdSegment}${truncatedDescription}`;

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

/**
 * Returns null when the body could not be parsed as JSON. Empty body counts as
 * unparseable. Callers should distinguish "parsed but no caseId field" (data
 * issue worth a warning) from "could not parse" (worth a louder warning, since
 * the case may still have been filed).
 */
function extractCaseIds(responseText: string): OpenCaseResult | null {
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
  const caseId = typeof payload.id === 'string' ? payload.id
    : typeof payload.caseId === 'string' ? payload.caseId
      : undefined;
  const caseNumber = typeof payload.caseNumber === 'string' ? payload.caseNumber
    : typeof payload.number === 'string' ? payload.number
      : undefined;
  return { caseId, caseNumber };
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
    signal: AbortSignal.timeout(10_000),
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
    logger.warn(`${LOG_DOMAIN}.post.parse_failed`, {
      status: res.status,
      customerId: input.customerId,
      appId: input.appId,
      responseSnippet: responseText.slice(0, 300),
    });
    return {};
  }

  logger.info(`${LOG_DOMAIN}.post.success`, {
    status: res.status,
    customerId: input.customerId,
    appId: input.appId,
    caseId: parsed.caseId,
    caseNumber: parsed.caseNumber,
  });

  return parsed;
}
