import { NextRequest, NextResponse } from 'next/server';

import { getAuthzFgaConfig, isAuthzFgaLocalMock } from '@/lib/authz-fga/config';
import { listObjects } from '@/lib/authz-fga/list-objects';
import { getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import type { SiteInfo } from '@/lib/control-plane/types';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

/** A real FGA relation value — restricts callers to AUTHZ_FGA_RELATIONS members,
 *  so a typo'd relation (which would silently always-deny) is a compile error. */
type FgaRelation = (typeof AUTHZ_FGA_RELATIONS)[keyof typeof AUTHZ_FGA_RELATIONS];

export async function enforceAabMultiUserVentureRelation(options: {
  request: NextRequest;
  siteId: string;
  customerId: string | undefined;
  siteInfo: SiteInfo | null;
  relation: FgaRelation;
  forbiddenMessage: string;
}): Promise<NextResponse | null> {
  const multiUser = await checkSwitchboardFlag('aab-multi-user', options.request);
  if (!multiUser) {
    return null;
  }

  const cfg = getAuthzFgaConfig();
  if (!cfg) {
    logger.warn('aab-multi-user.fga.skip-not-configured', {
      siteId: options.siteId,
      relation: options.relation,
    });
    return null;
  }

  const cid = options.customerId?.trim();
  if (!cid) {
    logger.info('aab-multi-user.fga.deny-no-customer-id', {
      siteId: options.siteId,
      relation: options.relation,
    });
    return NextResponse.json(
      { error: 'Forbidden', message: options.forbiddenMessage },
      { status: 403 }
    );
  }

  const ownerCustomerId = options.siteInfo?.owner_customer_id;
  if (ownerCustomerId && cid === ownerCustomerId) {
    return null;
  }

  // When the control plane response didn't surface an owner customer id we do
  // NOT fail open — this is an authorization gate, so an absent owner must not
  // grant every relation. Fall through to the FGA check below: a legitimate
  // owner holds the `owner` tuple on the venture (written by
  // ensureAppTeamVenture / the multiusers invite flow) and will pass; anyone
  // else is denied. Log for observability so we can confirm owner ids stay
  // populated upstream.
  if (!ownerCustomerId) {
    logger.warn('aab-multi-user.fga.no-owner-fall-through-to-fga', {
      siteId: options.siteId,
      relation: options.relation,
      customerId: cid,
    });
  }

  // Fail CLOSED when there's no venture to check. We only reach here as a
  // non-owner (the owner short-circuits above), and a legitimate collaborator
  // always arrives with a team_venture_id (the shared-apps listing carries
  // aabTeamVentureId). An absent venture means we cannot verify the relation, so
  // denying is correct — and mirrors the same guard in fga-write/route.ts so
  // build/download/publish/secrets/domains/delete all fail closed identically.
  const teamVentureId = options.siteInfo?.team_venture_id;
  if (!teamVentureId) {
    logger.warn('aab-multi-user.fga.deny-no-team-venture', {
      siteId: options.siteId,
      relation: options.relation,
      customerId: cid,
    });
    return NextResponse.json(
      { error: 'Forbidden', message: options.forbiddenMessage },
      { status: 403 }
    );
  }

  // Local dev mock — allow all relations without hitting FGA. Guarded so a
  // leaked AUTHZ_FGA_LOCAL_MOCK in a deployed env cannot disable enforcement.
  if (isAuthzFgaLocalMock()) {
    return null;
  }

  // Use listObjects rather than checkPermission: the FGA store for this
  // deployment resolves computed relations (role → airo_app_*) correctly via
  // ListObjects but not via Check. Both operations evaluate the same model;
  // the discrepancy is a known quirk of this FGA store configuration.
  //
  // Fail CLOSED on an FGA outage. The OAuth token fetch or listObjects can throw
  // (timeout, 5xx, network). We only reach here as a non-owner (owners
  // short-circuit above), so denying on an unverifiable relation is correct —
  // and we return an explicit 403 rather than letting the error propagate to a
  // route handler whose error mapping we don't control.
  let visibleVentureIds: string[];
  try {
    const accessToken = await getAuthzFgaAccessToken(cfg);
    visibleVentureIds = await listObjects(cfg, accessToken, {
      user: `customer:${cid}`,
      relation: options.relation,
      type: 'venture',
    });
  } catch (error) {
    logger.warn('aab-multi-user.fga.error-fail-closed', {
      siteId: options.siteId,
      customerId: cid,
      ventureId: teamVentureId,
      relation: options.relation,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Forbidden', message: options.forbiddenMessage },
      { status: 403 }
    );
  }
  const allowed = visibleVentureIds.includes(teamVentureId);

  if (!allowed) {
    logger.info('aab-multi-user.fga.relation-denied', {
      siteId: options.siteId,
      customerId: cid,
      ventureId: teamVentureId,
      relation: options.relation,
    });
    return NextResponse.json(
      { error: 'Forbidden', message: options.forbiddenMessage },
      { status: 403 }
    );
  }

  return null;
}
