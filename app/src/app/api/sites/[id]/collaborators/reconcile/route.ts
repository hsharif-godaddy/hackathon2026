import { NextRequest, NextResponse } from 'next/server';

import { enforceAabMultiUserVentureRelation } from '@/lib/authz-fga/enforce-venture-relation';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { reconcileCollaboratorsFromFga } from '@/lib/mgmt-airo/collaborator-sync';
import { resolveOwnerPaidPlan } from '@/lib/mgmt-airo/resolve-owner-paid-plan';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sites/[id]/collaborators/reconcile
 *
 * Mirror the app's OpenFGA venture membership into the mgmt-airo
 * `airo_app_collaborators` table. The Team panel (multiusersEsm CDS bundle)
 * writes venture/FGA tuples directly and never calls `fga-write`, so invited
 * users otherwise get no collaborator row and never appear in their
 * "shared with me" listing. The owner triggers this — e.g. when the Team panel
 * closes — so real invites propagate.
 *
 * Owner-only: the caller must hold the `owner` relation on the venture, and the
 * underlying grants go out with the owner's sso-jwt (mgmt-airo's
 * OwnerOnlyAuthorization), so a collaborator can't self-grant. Grant-only.
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

    // Feature-gated: inert (and route hidden) when aab-multi-user is off.
    const multiUser = await checkSwitchboardFlag('aab-multi-user', request);
    if (!multiUser) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt, undefined, { multiUserEnabled: multiUser });
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    // No venture yet ⇒ nothing to reconcile (not an error — common before the
    // owner first opens the Team panel, which lazily provisions the venture).
    if (!site.team_venture_id) {
      return NextResponse.json({ success: true, members: 0, granted: 0, grantFailures: 0, skipped: 'no_team_venture' });
    }

    // Owner-only: managing an app's collaborator set is restricted to the owner
    // (mgmt-airo enforces the same on its collaborator-management endpoints).
    // Gating here too means a non-owner gets a clean 403 instead of a half-
    // applied invite (FGA written, mgmt-airo grant rejected). The owner short-
    // circuits via owner_customer_id; otherwise the FGA `owner` relation is checked.
    const deny = await enforceAabMultiUserVentureRelation({
      request,
      siteId,
      customerId: user.customerId,
      siteInfo: site,
      relation: AUTHZ_FGA_RELATIONS.canTransfer,
      forbiddenMessage: 'Only the app owner can manage team members for this app.',
    });
    if (deny) {
      return deny;
    }

    // Server-side paywall enforcement: free-tier owners cannot manage
    // collaborators. Backend gate backing the client-side paywall banner.
    const ownerPlan = await resolveOwnerPaidPlan({
      jwt: authContext.jwt,
      subscriptionId: site.subscription_id,
      siteId,
    });
    if (!ownerPlan.allowed) {
      if (ownerPlan.reason === 'fetch_failed') {
        return NextResponse.json(
          { error: 'Unable to verify subscription status. Please try again.' },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: 'A paid plan is required to manage collaborators' },
        { status: 403 }
      );
    }

    const result = await reconcileCollaboratorsFromFga({
      jwt: authContext.jwt,
      appId: siteId,
      subscriptionId: site.subscription_id,
      teamVentureId: site.team_venture_id,
      ownerCustomerId: site.owner_customer_id,
    });

    if (result.grantFailures > 0) {
      logger.warn('sites.collaborators.reconcile.partial', { siteId, ...result });
    } else {
      logger.info('sites.collaborators.reconcile.success', { siteId, ...result });
    }

    return NextResponse.json({ success: true, ...result });
  },
);
