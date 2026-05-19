/**
 * CRM case creation endpoint.
 *
 * Opens a support case in GoDaddy CRM on the customer's behalf when they
 * submit the "Report Issue" step of the feedback modal. customerId and
 * shopperId come from the authenticated JWT — never the request body —
 * so a caller cannot open cases on another user's account.
 *
 * Gated by the `appbuilder-crm-case-create` Switchboard flag during rollout.
 * Blocks employee-impersonation (`e2s`) and GoDaddy internal (TLA) accounts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isEmployeeAuthType } from '@airo/shared/auth';

import { airoCertTokenService, openCrmCase } from '@/lib/crm';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

export const dynamic = 'force-dynamic';

const FEATURE_FLAG = 'appbuilder-crm-case-create';
const LOG_DOMAIN = 'feedback.crm.case';

// `followUp` is intentionally NOT declared here: stale browser tabs may
// still send it, and we want the BFF to silently drop it rather than 400.
// The route test pins this drop behavior.
interface CrmCaseRequestBody {
  description?: unknown;
  appId?: unknown;
}

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  const { customerId, shopperId, authType } = authContext.user;

  if (isEmployeeAuthType(authType)) {
    logger.info(`${LOG_DOMAIN}.submit.rejected`, {
      reason: 'impersonation-not-allowed',
      customerId,
    });
    return NextResponse.json({ error: 'impersonation-not-allowed' }, { status: 403 });
  }

  if (shopperId?.length === 3) {
    logger.info(`${LOG_DOMAIN}.submit.rejected`, {
      reason: 'internal-user-not-allowed',
      customerId,
      shopperId,
    });
    return NextResponse.json({ error: 'internal-user-not-allowed' }, { status: 403 });
  }

  let flagOn = false;
  try {
    flagOn = await checkSwitchboardFlag(FEATURE_FLAG, request);
  } catch (err) {
    logger.warn(`${LOG_DOMAIN}.flag.lookup_failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!flagOn) {
    return NextResponse.json({ error: 'feature-disabled' }, { status: 403 });
  }

  // Cert env vars not deployed → treat the feature as disabled rather than
  // attempting to mint a token that will fail downstream.
  if (!airoCertTokenService.isConfigured()) {
    logger.info(`${LOG_DOMAIN}.submit.rejected`, {
      reason: 'cert-not-configured',
      customerId,
    });
    return NextResponse.json({ error: 'feature-disabled' }, { status: 403 });
  }

  let raw: CrmCaseRequestBody;
  try {
    raw = (await request.json()) as CrmCaseRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!description) {
    return NextResponse.json({ error: 'description-required' }, { status: 400 });
  }

  const appId = typeof raw.appId === 'string' && raw.appId.length > 0 ? raw.appId : null;

  logger.info(`${LOG_DOMAIN}.submit.start`, { customerId, appId });

  try {
    const result = await openCrmCase({
      customerId,
      shopperId,
      description,
      appId,
    });
    logger.info(`${LOG_DOMAIN}.submit.success`, {
      customerId,
      appId,
      caseId: result.caseId,
      caseNumber: result.caseNumber,
    });
    return NextResponse.json({ success: true, caseId: result.caseId, caseNumber: result.caseNumber });
  } catch (err) {
    logger.error(`${LOG_DOMAIN}.submit.failed`, {
      customerId,
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'crm-case-failed' }, { status: 502 });
  }
});
