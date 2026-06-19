import { NextRequest, NextResponse } from 'next/server';

import type { FgaTupleKey } from '@/lib/authz-fga/check';
import { getAuthzFgaConfig } from '@/lib/authz-fga/config';
import { enforceAabMultiUserVentureRelation } from '@/lib/authz-fga/enforce-venture-relation';
import { getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token';
import {
  AUTHZ_FGA_OWNER_ONLY_WRITABLE_RELATIONS,
  AUTHZ_FGA_RELATIONS,
  isFgaWritableRelation,
} from '@/lib/authz-fga/relations';
import { writeFgaTuples } from '@/lib/authz-fga/write';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { syncCollaboratorsToMgmtAiro } from '@/lib/mgmt-airo/collaborator-sync';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

export const dynamic = 'force-dynamic';

function isTupleKey(value: unknown): value is FgaTupleKey {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.user === 'string' &&
    o.user.length > 0 &&
    typeof o.relation === 'string' &&
    o.relation.length > 0 &&
    typeof o.object === 'string' &&
    o.object.length > 0
  );
}

/**
 * POST /api/sites/[id]/authz/fga-write
 *
 * Applies OpenFGA tuple writes/deletes for this app’s venture after invite accept
 * or other flows that need BFF-mediated FGA updates. Owner-only: the caller must
 * hold the `owner` relation on the venture (managing members is owner-restricted).
 */
export const POST = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ id: string }> }
  ): Promise<NextResponse> => {
    const { user } = authContext;
    const { id: siteId } = await params;

    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to modify authorization', 403);
    }
    if (!siteId) {
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 });
    }
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Hard gate FIRST: this route only exists to serve the multi-user team UI.
    // When aab-multi-user is off it must be a complete no-op — never write FGA
    // tuples and never run the (flag-gated, thus no-op) authz check, which would
    // otherwise fall through and allow the write. Treat off as "not found" so we
    // don't leak the route's existence or touch FGA at all.
    const multiUser = await checkSwitchboardFlag('aab-multi-user', request);
    if (!multiUser) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt, undefined, { multiUserEnabled: multiUser });
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const cfgEarly = getAuthzFgaConfig();
    if (cfgEarly && !site.team_venture_id) {
      return NextResponse.json(
        { error: 'Team venture id is not provisioned for this app yet' },
        { status: 403 }
      );
    }

    // Owner-only: managing members (assigning per-app relations) is restricted
    // to the app owner. mgmt-airo enforces the same on its collaborator-
    // management endpoints, so gating here keeps the two layers consistent and a
    // non-owner gets a clean 403 instead of a half-applied write.
    const memberDeny = await enforceAabMultiUserVentureRelation({
      request,
      siteId,
      customerId: user.customerId,
      siteInfo: site,
      relation: AUTHZ_FGA_RELATIONS.canTransfer,
      forbiddenMessage: 'Only the app owner can update team authorization for this app.',
    });
    if (memberDeny) {
      return memberDeny;
    }

    const cfg = getAuthzFgaConfig();
    if (!cfg) {
      return NextResponse.json(
        { error: 'OpenFGA is not configured for this environment' },
        { status: 503 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }
    const raw = body as { writes?: unknown; deletes?: unknown };
    const writes = Array.isArray(raw.writes) ? raw.writes.filter(isTupleKey) : [];
    const deletes = Array.isArray(raw.deletes) ? raw.deletes.filter(isTupleKey) : [];
    if (writes.length === 0 && deletes.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid writes[] or deletes[] tuple_key entry is required' },
        { status: 400 }
      );
    }

    // Constrain every tuple to THIS app's venture, to a customer subject, and to
    // a relation our authorization model allows to be written here. user_invite
    // (can_manage_members) lets a caller manage members of their own team — it
    // must not become a primitive for writing arbitrary tuples (other ventures,
    // non-customer subjects, or relations outside the model). Reject the whole
    // request if any tuple steps outside that envelope.
    const expectedObject = `venture:${site.team_venture_id}`;
    const allTuples = [...writes, ...deletes];
    const offending = allTuples.find(
      (t) =>
        t.object !== expectedObject ||
        !t.user.startsWith('customer:') ||
        !isFgaWritableRelation(t.relation)
    );
    if (offending) {
      logger.warn('sites.authz.fga-write.rejected_tuple', {
        siteId,
        object: offending.object,
        relation: offending.relation,
        expectedObject,
      });
      return NextResponse.json(
        { error: 'Tuples must target this app’s venture (customer subject) and an allowed relation' },
        { status: 400 }
      );
    }

    // Privilege-escalation guard: admin / user_update may only be written by a
    // caller who holds `owner` on the venture. A non-owner admin (who clears the
    // user_invite gate above) must NOT be able to promote anyone — including
    // themselves or an accomplice — to admin or grant user-management. `owner`
    // itself is never writable here (not in either allowlist); ownership moves
    // exclusively through the dedicated level-3 transfer flow.
    const needsOwner = allTuples.some((t) =>
      AUTHZ_FGA_OWNER_ONLY_WRITABLE_RELATIONS.has(t.relation)
    );
    if (needsOwner) {
      const ownerDeny = await enforceAabMultiUserVentureRelation({
        request,
        siteId,
        customerId: user.customerId,
        siteInfo: site,
        relation: AUTHZ_FGA_RELATIONS.canTransfer, // 'owner'
        forbiddenMessage: 'Only the app owner can assign admin or user-management roles.',
      });
      if (ownerDeny) {
        return ownerDeny;
      }
    }

    try {
      const accessToken = await getAuthzFgaAccessToken(cfg);
      await writeFgaTuples(cfg, accessToken, {
        writes: writes.length ? writes : undefined,
        deletes: deletes.length ? deletes : undefined,
      });
    } catch (err) {
      logger.error('sites.authz.fga-write.failed', {
        siteId,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: 'Failed to apply authorization updates' },
        { status: 502 }
      );
    }

    logger.info('sites.authz.fga-write.success', {
      siteId,
      writeCount: writes.length,
      deleteCount: deletes.length,
    });

    // Mirror the grant/revoke into mgmt-airo: this registers the invitee as an
    // Airo customer, authorizes them for the app, AND is the source of their
    // "shared with me" listing. Because listing now depends on this row, a
    // failed grant is surfaced (502) so the client retries — both the FGA write
    // above and the grant are idempotent, so a retry converges. Revokes stay
    // best-effort inside the sync. This only runs when aab-multi-user is on
    // (the route 404s above otherwise), so no separate kill switch is needed.
    const sync = await syncCollaboratorsToMgmtAiro({
      jwt: authContext.jwt,
      appId: siteId,
      subscriptionId: site.subscription_id,
      teamVentureId: site.team_venture_id,
      writes,
      deletes,
    });
    if (sync.grantFailures > 0) {
      logger.error('sites.authz.fga-write.collaborator-sync-failed', {
        siteId,
        grantFailures: sync.grantFailures,
        granted: sync.granted,
      });
      return NextResponse.json(
        { error: 'Authorization was saved but could not be fully propagated. Please retry.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, writes: writes.length, deletes: deletes.length });
  },
  { level: 3 }
);
