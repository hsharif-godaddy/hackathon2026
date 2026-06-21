/**
 * Collaborator sync — mirrors AAB multi-user FGA grants/revokes into the
 * mgmt-airo `airo_app_collaborators` table (consumer track).
 *
 * Why this exists: an invited collaborator is only an OpenFGA tuple on the
 * BFF/UI side. mgmt-airo never learns about them, so the invitee fails
 * RequireRegisteredCustomer ("Customer not registered with Airo") and the
 * owner-scoped ownership checks — which is why grants/secrets-diff/publish
 * return 403/500/errors for invited users. Recording a collaborator row
 * (a) registers the invitee in airo_customers, (b) lets mgmt-airo authorize
 * them for the app, and (c) is now ALSO the source of the invitee's
 * "shared with me" listing (`GET /customers/me/shared-apps`). Billing is
 * unaffected: the subscription owner stays the paying principal (owner-pays).
 *
 * Reliability (v4 cutover): because the collaborator row now drives BOTH authz
 * AND listing, the grant path is no longer best-effort — a failed grant is
 * reported back so the caller can fail the invite and have the client retry
 * (FGA writes and the grant are both idempotent). The route already gates this
 * on `aab-multi-user` (it 404s when off), so no separate kill switch is needed.
 * Revoke stays best-effort (a stale row is a cleanup concern, not a correctness
 * one — the FGA tuple removal already drops in-app permissions).
 *
 * Auth: the caller's own sso-jwt (the inviting owner) — same as every other
 * mgmt-airo call. mgmt-airo authorizes the write via EntityOwnerAuthorization;
 * the BFF has already enforced the OpenFGA `user_invite` relation upstream.
 */

import type { FgaTupleKey } from '@/lib/authz-fga/check';
import { getAuthzFgaConfig } from '@/lib/authz-fga/config';
import { listObjects } from '@/lib/authz-fga/list-objects';
import { listUsers } from '@/lib/authz-fga/list-users';
import { getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export interface CollaboratorSyncParams {
  /** The caller's sso-jwt (the inviting owner) — used to call mgmt-airo. */
  jwt: string;
  appId: string;
  subscriptionId?: string;
  /** The app's FGA venture id, used to scope the post-delete remaining-access check. */
  teamVentureId?: string;
  /** Tuples just written (grants) — `customer:<id>` subjects. */
  writes: FgaTupleKey[];
  /** Tuples just deleted (potential revokes) — `customer:<id>` subjects. */
  deletes: FgaTupleKey[];
}

export interface CollaboratorSyncResult {
  /** Number of grants that did NOT land in mgmt-airo. >0 means the caller
   *  should treat the invite as not-yet-propagated and have the client retry. */
  grantFailures: number;
  /** Number of grants that succeeded (or were already present — idempotent). */
  granted: number;
}

const CUSTOMER_PREFIX = 'customer:';

/**
 * Capability tokens mirrored into the `airo_app_collaborators.role` column as a
 * comma-separated SET (e.g. `view,publish,domains`) and enforced per-route by
 * mgmt-airo. We persist the exact capability set — not a coarse role tier —
 * because the venture FGA model supports arbitrary/custom permission
 * combinations; collapsing to admin/manager/employee would both wrongly deny a
 * custom role its real permissions and wrongly grant ones it lacks. These tokens
 * must match the ones mgmt-airo parses (entities.CollaboratorCap*).
 *
 * `view` is the read-only floor sentinel: a member with no elevated capability
 * is stored as `view`, never empty, so mgmt-airo never falls back to its legacy
 * "editor" (full) default. App delete/transfer are owner-only and never tokens.
 */
const COLLABORATOR_CAP = {
  view: 'view',
  publish: 'publish',
  secrets: 'secrets',
  domains: 'domains',
  download: 'download',
} as const;

const lc = (s: string): string => s.trim().toLowerCase();

/**
 * Build a resolver that maps a venture member's customer id to their stored
 * capability set (a CSV of {@link COLLABORATOR_CAP} tokens), read directly from
 * the venture's FGA permission tuples — one membership per sensitive capability
 * mgmt-airo gates on. The resolver returns the EXACT subset the member holds, so
 * custom roles are honored faithfully; members with no elevated capability get
 * the `view` floor. Throws if any FGA read fails — callers decide whether to
 * skip (reconcile retries) or fail the grants.
 */
async function deriveCapabilityResolver(
  cfg: NonNullable<ReturnType<typeof getAuthzFgaConfig>>,
  token: string,
  teamVentureId: string
): Promise<(customerId: string) => string> {
  const member = (relation: string) =>
    listUsers(cfg, token, {
      objectType: 'venture',
      objectId: teamVentureId,
      relation,
      userType: 'customer',
      higherConsistency: true,
    });
  const [publishers, secretsManagers, domainsManagers, downloaders] = await Promise.all([
    member(AUTHZ_FGA_RELATIONS.canPublish),
    member(AUTHZ_FGA_RELATIONS.canManageSecrets),
    member(AUTHZ_FGA_RELATIONS.canManageDomains),
    member(AUTHZ_FGA_RELATIONS.canDownload),
  ]);
  const holds = {
    publish: new Set(publishers.map(lc)),
    secrets: new Set(secretsManagers.map(lc)),
    domains: new Set(domainsManagers.map(lc)),
    download: new Set(downloaders.map(lc)),
  };
  return (customerId: string): string => {
    const id = lc(customerId);
    const caps: string[] = [];
    if (holds.publish.has(id)) caps.push(COLLABORATOR_CAP.publish);
    if (holds.secrets.has(id)) caps.push(COLLABORATOR_CAP.secrets);
    if (holds.domains.has(id)) caps.push(COLLABORATOR_CAP.domains);
    if (holds.download.has(id)) caps.push(COLLABORATOR_CAP.download);
    return caps.length > 0 ? caps.join(',') : COLLABORATOR_CAP.view;
  };
}

/** Unique customer ids from `customer:<id>` tuple subjects (ignores others). */
function uniqueCustomerIds(tuples: FgaTupleKey[]): string[] {
  const ids = new Set<string>();
  for (const t of tuples) {
    if (t.user.startsWith(CUSTOMER_PREFIX)) {
      const id = t.user.slice(CUSTOMER_PREFIX.length).trim();
      if (id) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

function mgmtAiroBaseUrl(): string {
  return process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
}

/**
 * Mirror the just-applied FGA writes/deletes into mgmt-airo collaborators.
 * Returns how many grants failed so the caller can decide whether to fail the
 * request. Never throws — failures are counted/logged, not propagated.
 */
export async function syncCollaboratorsToMgmtAiro(
  params: CollaboratorSyncParams
): Promise<CollaboratorSyncResult> {
  const { jwt, appId, subscriptionId, teamVentureId, writes, deletes } = params;

  const grantIds = uniqueCustomerIds(writes);
  // A customer present in both writes and deletes is a role change, not a
  // removal — keep them. Only deletes-without-a-write are revoke candidates.
  const grantSet = new Set(grantIds);
  const revokeCandidates = uniqueCustomerIds(deletes).filter((id) => !grantSet.has(id));

  if (grantIds.length === 0 && revokeCandidates.length === 0) {
    return { grantFailures: 0, granted: 0 };
  }

  if (!subscriptionId) {
    // We cannot record a collaborator without the owner's subscription.
    // Treat pending grants as failures so the invite isn't silently half-applied.
    logger.error('collaborator.sync.missing_subscription', {
      appId,
      pendingGrants: grantIds.length,
    });
    return { grantFailures: grantIds.length, granted: 0 };
  }

  // Derive each grantee's capability set from the venture's FGA permissions so
  // mgmt-airo can enforce it per-route. When FGA isn't configured the whole
  // multi-user gate is off (enforceAabMultiUserVentureRelation skips too), so we
  // grant without a set and mgmt-airo keeps its default. When FGA IS configured
  // but the read fails, we fail the grants rather than write an over-permissive
  // default — the route already retries on grant failures.
  let capabilitiesFor: ((customerId: string) => string) | null = null;
  const cfg = getAuthzFgaConfig();
  if (grantIds.length > 0 && cfg && teamVentureId) {
    try {
      const token = await getAuthzFgaAccessToken(cfg);
      capabilitiesFor = await deriveCapabilityResolver(cfg, token, teamVentureId);
    } catch (err) {
      logger.error('collaborator.sync.capability_derivation_failed', {
        appId,
        subscriptionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { grantFailures: grantIds.length, granted: 0 };
    }
  }

  // Same auth as every other mgmt-airo call: the caller's sso-jwt.
  const client = new AiroMgmtClient({ baseUrl: mgmtAiroBaseUrl(), jwt });

  let grantFailures = 0;
  let granted = 0;

  const grantTasks = grantIds.map((customerId) =>
    client
      .grantCollaborator(subscriptionId, appId, {
        collaboratorCustomerId: customerId,
        ...(capabilitiesFor ? { role: capabilitiesFor(customerId) } : {}),
      })
      .then(() => {
        granted += 1;
        logger.info('collaborator.sync.grant.success', { appId, subscriptionId, customerId });
      })
      .catch((err) => {
        grantFailures += 1;
        logger.error('collaborator.sync.grant.failed', {
          appId,
          subscriptionId,
          customerId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
  );

  // Revoke stays best-effort (see file header).
  const revokeTasks = revokeCandidates.map((customerId) =>
    maybeRevoke(client, { appId, subscriptionId, teamVentureId, customerId })
  );

  await Promise.allSettled([...grantTasks, ...revokeTasks]);

  return { grantFailures, granted };
}

/**
 * Revoke a collaborator only when they no longer hold ANY app access on the
 * venture (checked via the broadest inherited relation, `airo_app_view`). This
 * prevents a role-downgrade that removes only some relations from wrongly
 * dropping the backend binding. On any uncertainty (no venture id / no FGA
 * config / read error) we skip and log rather than revoke blindly.
 */
async function maybeRevoke(
  client: AiroMgmtClient,
  opts: { appId: string; subscriptionId: string; teamVentureId?: string; customerId: string }
): Promise<void> {
  const { appId, subscriptionId, teamVentureId, customerId } = opts;
  try {
    if (teamVentureId) {
      const cfg = getAuthzFgaConfig();
      if (cfg) {
        const token = await getAuthzFgaAccessToken(cfg);
        const ventures = await listObjects(cfg, token, {
          user: `${CUSTOMER_PREFIX}${customerId}`,
          relation: AUTHZ_FGA_RELATIONS.canView,
          type: 'venture',
        });
        if (ventures.includes(teamVentureId)) {
          // Still has access (e.g. role downgrade) — keep the binding.
          logger.info('collaborator.sync.revoke.skipped.still_has_access', { appId, customerId });
          return;
        }
      }
    }

    await client.revokeCollaborator(subscriptionId, appId, customerId);
    logger.info('collaborator.sync.revoke.success', { appId, subscriptionId, customerId });
  } catch (err) {
    logger.warn('collaborator.sync.revoke.failed', {
      appId,
      subscriptionId,
      customerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface ReconcileParams {
  /** The caller's sso-jwt (the owner / a member who can manage members). */
  jwt: string;
  appId: string;
  subscriptionId?: string;
  /** The app's FGA venture id — the source of truth for membership. */
  teamVentureId?: string;
  /** The app's real owner — never recorded as a collaborator (owner-pays). */
  ownerCustomerId?: string;
}

export interface ReconcileResult {
  /** Venture members (minus the owner) that should have a collaborator row. */
  members: number;
  /** Rows granted this pass (idempotent upserts). */
  granted: number;
  /** Grants that failed. */
  grantFailures: number;
  /** Rows revoked this pass (collaborator no longer a venture member). */
  revoked: number;
  /** Revokes that failed. */
  revokeFailures: number;
  /** Error messages for failed grants (truncated) — surfaced to the owner for diagnosis. */
  grantErrors?: string[];
  /** Error messages for failed revokes (truncated) — surfaced to the owner for diagnosis. */
  revokeErrors?: string[];
}

/**
 * Reconcile the `airo_app_collaborators` rows for an app FROM its venture's FGA
 * membership. This is the bridge for the real invite path: the multiusersEsm
 * Team panel writes venture/FGA tuples directly and never calls `fga-write`, so
 * `syncCollaboratorsToMgmtAiro` never runs and invited users get no row (and so
 * never appear in `/customers/me/shared-apps`). Running this on the owner's side
 * (e.g. when the Team panel closes) discovers the venture's members via FGA
 * `listUsers` and grants a row for each — owner-authorized, so the owner-pays
 * trust boundary is preserved (a collaborator still can't self-grant).
 *
 * Two-way (grant AND revoke): every venture member gets/keeps a row, and any
 * existing row whose customer is no longer a venture member is revoked — that's
 * what makes "remove user" actually drop the invitee's access (otherwise the
 * stale row keeps them in `/customers/me/shared-apps`). Safe against a transient
 * bad FGA read: both grant and revoke derive from the SAME authoritative
 * `listUsers` result each run, so a wrongful revoke is re-granted on the next
 * reconcile (panel open/close/change all re-fire it). Revoke only runs when both
 * the FGA read and the collaborator-list read succeed; otherwise it's skipped.
 * Never throws — failures are counted/logged.
 */
export async function reconcileCollaboratorsFromFga(
  params: ReconcileParams
): Promise<ReconcileResult> {
  const { jwt, appId, subscriptionId, teamVentureId, ownerCustomerId } = params;
  const empty: ReconcileResult = { members: 0, granted: 0, grantFailures: 0, revoked: 0, revokeFailures: 0 };

  if (!subscriptionId || !teamVentureId) {
    logger.warn('collaborator.reconcile.missing_context', {
      appId,
      hasSubscription: Boolean(subscriptionId),
      hasVenture: Boolean(teamVentureId),
    });
    return empty;
  }

  const cfg = getAuthzFgaConfig();
  if (!cfg) {
    logger.warn('collaborator.reconcile.no_fga_config', { appId });
    return empty;
  }

  let memberCustomerIds: string[];
  let capabilitiesFor: (customerId: string) => string;
  try {
    const token = await getAuthzFgaAccessToken(cfg);
    memberCustomerIds = await listUsers(cfg, token, {
      objectType: 'venture',
      objectId: teamVentureId,
      relation: AUTHZ_FGA_RELATIONS.canView, // airo_app_view — held by every role
      userType: 'customer',
      // Read-after-write: the revoke decision keys off this membership, so a
      // stale read must not miss a just-added member and wrongly drop them.
      higherConsistency: true,
    });
    // Derive each member's capability set from the same authoritative FGA state,
    // so every (idempotent) grant rewrites the stored set — legacy "editor" rows
    // and any permission change converge on the next reconcile.
    capabilitiesFor = await deriveCapabilityResolver(cfg, token, teamVentureId);
  } catch (err) {
    logger.error('collaborator.reconcile.list_users_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }

  // Every venture viewer except the real owner should have a collaborator row.
  const ownerLc = ownerCustomerId?.trim().toLowerCase();
  const desired = [
    ...new Set(memberCustomerIds.map((c) => c.trim()).filter(Boolean)),
  ].filter((c) => c.toLowerCase() !== ownerLc);

  const client = new AiroMgmtClient({ baseUrl: mgmtAiroBaseUrl(), jwt });
  const desiredSet = new Set(desired.map((c) => c.toLowerCase()));

  // Grant phase — every venture member gets/keeps a row (idempotent upsert).
  let granted = 0;
  let grantFailures = 0;
  const grantErrors: string[] = [];
  await Promise.allSettled(
    desired.map((customerId) =>
      client
        .grantCollaborator(subscriptionId, appId, {
          collaboratorCustomerId: customerId,
          role: capabilitiesFor(customerId),
        })
        .then(() => {
          granted += 1;
          logger.info('collaborator.reconcile.grant.success', { appId, subscriptionId, customerId });
        })
        .catch((err) => {
          grantFailures += 1;
          const message = err instanceof Error ? err.message : String(err);
          grantErrors.push(`${customerId}: ${message}`.slice(0, 300));
          logger.error('collaborator.reconcile.grant.failed', {
            appId,
            subscriptionId,
            customerId,
            error: message,
          });
        })
    )
  );

  // Revoke phase — drop rows for customers no longer in the venture's FGA
  // membership (the owner removed them in the Team panel). Only runs when the
  // collaborator-list read succeeds; a failed read skips revoke entirely so we
  // never strip access on incomplete data. The owner is never a collaborator row,
  // but guard anyway.
  let revoked = 0;
  let revokeFailures = 0;
  const revokeErrors: string[] = [];
  try {
    const existing = await client.listCollaborators(subscriptionId, appId);
    const toRevoke = (existing.collaborators ?? []).filter((row) => {
      const cidLc = row.customerId?.trim().toLowerCase();
      return cidLc && cidLc !== ownerLc && !desiredSet.has(cidLc);
    });
    await Promise.allSettled(
      toRevoke.map((row) =>
        client
          .revokeCollaborator(subscriptionId, appId, row.customerId)
          .then(() => {
            revoked += 1;
            logger.info('collaborator.reconcile.revoke.success', {
              appId,
              subscriptionId,
              customerId: row.customerId,
            });
          })
          .catch((err) => {
            revokeFailures += 1;
            const message = err instanceof Error ? err.message : String(err);
            revokeErrors.push(`${row.customerId}: ${message}`.slice(0, 300));
            logger.error('collaborator.reconcile.revoke.failed', {
              appId,
              subscriptionId,
              customerId: row.customerId,
              error: message,
            });
          })
      )
    );
  } catch (err) {
    logger.warn('collaborator.reconcile.list_collaborators_failed', {
      appId,
      subscriptionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { members: desired.length, granted, grantFailures, revoked, revokeFailures, grantErrors, revokeErrors };
}
