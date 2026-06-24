import { getAuthzFgaConfig } from '@/lib/authz-fga/config';
import { getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token';
import { writeFgaTuples } from '@/lib/authz-fga/write';
import type { SiteInfo } from '@/lib/control-plane/types';
import { V2ControlPlaneAdapter } from '@/lib/control-plane/v2-control-plane-adapter';
import { setAppVentureMappingBestEffort } from '@/lib/mgmt-airo/set-venture-mapping';
import { logger } from '@/lib/request-context';
import { extractShopperId } from '@/lib/utils/jwt-utils';
import { VentureService } from '@/lib/venture-service';

/**
 * Write the `owner` tuple `customer:<id> -> owner -> venture:<vid>` so the
 * caller's subsequent FGA checks (`airo_app_build`, `_publish`, etc.) succeed
 * via the role hierarchy in the shared GoDaddy venture model. Per
 * `relations.ts`: owner inherits ALL `airo_app_*` relations.
 *
 * Best-effort: failures here log a warning but do not propagate, because
 * `enforce-venture-relation.ts` will fall through to the FGA check on the next
 * request and will simply 403 if the tuple wasn't written. The user can retry.
 */
async function writeOwnerTupleBestEffort(options: {
  siteId: string;
  customerId: string;
  ventureId: string;
}): Promise<void> {
  const cfg = getAuthzFgaConfig();
  if (!cfg) {
    return;
  }
  try {
    const token = await getAuthzFgaAccessToken(cfg);
    await writeFgaTuples(cfg, token, {
      writes: [
        {
          user: `customer:${options.customerId}`,
          relation: 'owner',
          object: `venture:${options.ventureId}`,
        },
      ],
    });
    logger.info('ensure-app-venture.owner-tuple-written', {
      siteId: options.siteId,
      ventureId: options.ventureId,
      customerId: options.customerId,
    });
  } catch (error) {
    logger.warn('ensure-app-venture.owner-tuple-write-failed', {
      siteId: options.siteId,
      ventureId: options.ventureId,
      customerId: options.customerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Local dev rarely has S2S certs configured. Without GRAPHQL_CLIENT_CERT (env or
// file), the Product Graph call inside VentureService blocks for ~17s before
// throwing "Authentication token not available", which compounds into multi-minute
// agent-token responses. Skip outright in that case.
function hasProductGraphCert(): boolean {
  if (process.env.GRAPHQL_CLIENT_CERT && process.env.GRAPHQL_CLIENT_KEY) return true;
  const certPath = process.env.GRAPHQL_CLIENT_CERT_PATH;
  const keyPath = process.env.GRAPHQL_CLIENT_KEY_PATH;
  return Boolean(certPath && keyPath);
}

export async function ensureAppTeamVenture(options: {
  // The caller resolves the aab-multi-user flag once (soft — Switchboard outage
  // treated as off) and threads it in. We must NOT read Switchboard here: this
  // runs on the agent-token hot path, and a throwing flag read would turn an
  // outage into a 500 for every provisioned-app owner instead of degrading.
  multiUserEnabled: boolean;
  siteId: string;
  customerId: string;
  jwt: string;
  siteInfo: SiteInfo | null;
}): Promise<string | null> {
  if (options.siteInfo?.team_venture_id) {
    // Venture already exists — don't re-mint. But the mgmt-airo venture->app
    // mapping may be missing (the venture predates this write, or was created by
    // a path that didn't record it), which silently breaks invitee-pull. Re-assert
    // it as a backstop whenever the OWNER opens the app (the hottest, most reliable
    // owner-side trigger). Owner-only + multi-user-gated to avoid needless calls
    // and the 403 a non-owner would get from mgmt-airo's owner-only SetVenture.
    // Fire-and-forget: this is a self-healing backstop, not on the response's
    // critical path, and the helper never throws (no unhandled rejection).
    if (
      options.siteInfo.owner_customer_id &&
      options.customerId === options.siteInfo.owner_customer_id &&
      options.multiUserEnabled
    ) {
      void setAppVentureMappingBestEffort({
        jwt: options.jwt,
        appId: options.siteId,
        subscriptionId: options.siteInfo.subscription_id,
        ventureId: options.siteInfo.team_venture_id,
      });
    }
    return options.siteInfo.team_venture_id;
  }

  if (!options.multiUserEnabled) {
    return null;
  }

  // Without siteInfo we don't know who owns the app, so we can't verify
  // ownership and must not create a venture. This also prevents invited users
  // (whose getSite fails → siteInfo=null) from minting a stale venture row.
  if (!options.siteInfo) {
    logger.info('ensure-app-venture.skip-no-site-info', {
      siteId: options.siteId,
      customerId: options.customerId,
    });
    return null;
  }

  const ownerCustomerId = options.siteInfo.owner_customer_id;
  // Without a known owner we cannot verify the caller owns the app, so we must
  // NOT mint a venture — doing so on a brand-new app whose owner hasn't been
  // stamped yet (or any race) would create an orphan venture bound to the wrong
  // customer. Fail closed; the next request (once getSite returns the owner)
  // creates it correctly.
  if (!ownerCustomerId) {
    logger.info('ensure-app-venture.skip-no-owner', {
      siteId: options.siteId,
      customerId: options.customerId,
    });
    return null;
  }
  if (options.customerId !== ownerCustomerId) {
    logger.info('ensure-app-venture.skip-non-owner', {
      siteId: options.siteId,
      customerId: options.customerId,
    });
    return null;
  }

  if (!hasProductGraphCert()) {
    logger.warn('ensure-app-venture.skip-no-cert', {
      siteId: options.siteId,
      customerId: options.customerId,
    });
    return null;
  }

  const shopperId = extractShopperId(options.jwt);
  if (!shopperId) {
    logger.warn('ensure-app-venture.no-shopper-id', {
      siteId: options.siteId,
      customerId: options.customerId,
    });
    return null;
  }

  try {
    // Mint a FRESH venture for THIS app so collaboration is isolated 1:1 to the
    // app. createProfileForShopper creates a brand-new venture on every call
    // (verified against Product Graph — it does NOT 403 / reuse), which is
    // exactly what we want: each app gets its own venture, so inviting a
    // collaborator to one app never leaks them onto the owner's other apps.
    //
    // Do NOT use getOrCreateVentureForCustomer here: it returns the shopper's
    // single `image_manager_venture_id` (one venture per CUSTOMER, shared with
    // Getty/image-manager), which made every app share one venture and leaked
    // members across all of the owner's apps. Idempotency is the
    // `team_venture_id`-already-set early return above — once an app has a
    // venture we never re-mint, so this runs at most once per app.
    const ventureService = new VentureService(options.jwt);
    const ventureId = await ventureService.createProfileForShopper(shopperId);

    // Seed the owner FGA tuple FIRST — before persisting the venture id — so the
    // owner's authoritative ownership proof exists as soon as the venture does.
    // This is the proof the FGA gate falls back to when the optimistic
    // owner_customer_id stamp is later cleared (reconcileSharedOwnership fails
    // closed during a transient shared-apps 401): a real owner still passes via
    // this `owner` tuple, while a collaborator with no tuple is correctly denied.
    // If we wrote it AFTER updateSiteVariables and that persist threw, the tuple
    // would never be attempted and a stamp-clear could lock the owner out of
    // their own app. Best-effort: an FGA hiccup logs and the immediate request
    // is still covered by owner-bypass via the stamp.
    await writeOwnerTupleBestEffort({
      siteId: options.siteId,
      customerId: options.customerId,
      ventureId,
    });

    const adapter = new V2ControlPlaneAdapter();
    await adapter.updateSiteVariables(
      options.siteId,
      { aabTeamVentureId: ventureId },
      options.jwt,
    );

    logger.info('ensure-app-venture.created', {
      siteId: options.siteId,
      ventureId,
      customerId: options.customerId,
    });

    // Record the venture->app mapping in mgmt-airo so a later self-scoped
    // collaborator reconcile (invitee-pull) can resolve this venture back to the
    // app + subscription and write the invitee's collaborator row. Awaited here
    // (not a hot path — runs at most once per app, on venture creation).
    await setAppVentureMappingBestEffort({
      jwt: options.jwt,
      appId: options.siteId,
      subscriptionId: options.siteInfo.subscription_id,
      ventureId,
    });

    return ventureId;
  } catch (error) {
    logger.error('ensure-app-venture.failed', {
      siteId: options.siteId,
      customerId: options.customerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
