/**
 * Best-effort writer for the venture->app mapping in mgmt-airo.
 *
 * The self-scoped invitee-pull reconcile (`reconcileInviteeShared` ->
 * `POST /customers/me/reconcile-shared`) only knows the ventures the caller is an
 * FGA member of. To turn "the invitee is a member of venture V" into "...which is
 * app A under subscription S" (so it can write the invitee's collaborator row),
 * mgmt-airo needs the venture->app mapping. That mapping is written here, from the
 * OWNER side, at every point where we know the (venture, app, subscription) triple:
 * venture creation, the owner-driven collaborator sync/reconcile, and as a
 * backstop when the owner opens the app. Without it, invitee-pull resolves nothing
 * (`reconcile-shared` -> `GetByVenture` not found -> skipped) and a collaborator
 * only appears once the owner is online to drive the grant directly.
 */

import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { getMgmtAiroBaseUrl } from '@/lib/mgmt-airo/base-url';
import { logger } from '@/lib/request-context';

/**
 * Write the venture->app mapping into mgmt-airo. Idempotent (mgmt-airo upserts by
 * app_id). Best-effort and NEVER throws: a failure only delays invitee-pull
 * resolution for this app until the next owner action re-writes it, so callers on
 * hot paths can fire-and-forget. Owner-authorized — pass the owner's sso-jwt
 * (mgmt-airo's SetVenture is owner-only); a non-owner jwt is rejected there. No-op
 * when the subscription or venture id is missing.
 */
export async function setAppVentureMappingBestEffort(params: {
  jwt: string;
  appId: string;
  subscriptionId?: string;
  ventureId?: string;
}): Promise<void> {
  const { jwt, appId, subscriptionId, ventureId } = params;
  if (!subscriptionId || !ventureId) {
    // Expected by design (PaaS apps have no subscription_id; non-multi-user apps
    // have no venture id), and high-volume on agent-token — info, not warn.
    logger.info('venture-mapping.skip-missing-context', {
      appId,
      hasSubscription: Boolean(subscriptionId),
      hasVenture: Boolean(ventureId),
    });
    return;
  }
  try {
    await new AiroMgmtClient({ baseUrl: getMgmtAiroBaseUrl(), jwt }).setAppVenture(
      subscriptionId,
      appId,
      ventureId,
    );
    logger.info('venture-mapping.written', { appId, ventureId, subscriptionId });
  } catch (error) {
    logger.warn('venture-mapping.write-failed', {
      appId,
      ventureId,
      subscriptionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
