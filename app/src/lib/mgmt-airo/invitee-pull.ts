import { getAuthzFgaConfig } from '@/lib/authz-fga/config';
import { listObjects } from '@/lib/authz-fga/list-objects';
import { getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { getMgmtAiroBaseUrl } from '@/lib/mgmt-airo/base-url';
import { logger } from '@/lib/request-context';
import { extractCustomerId } from '@/lib/utils/jwt-utils';

// Throttle the pull per customer so apps-list polling can't hammer FGA +
// mgmt-airo. Per-instance (in-memory) is fine: worst case each BFF instance
// reconciles a given customer once per window.
const THROTTLE_MS = 30_000;
// On failure, allow a retry sooner than the success window but NOT on every load
// — a sustained FGA/mgmt-airo outage must not turn each apps-list GET into two
// failing upstream calls.
const FAILURE_COOLDOWN_MS = 5_000;
// Bound the throttle map so a long-lived BFF can't accumulate one entry per
// customer forever. It's a throttle hint (not a correctness store), so evicting
// an old entry merely lets that customer pull again on their next load.
const MAX_TRACKED_CUSTOMERS = 10_000;
// Per-leg bound on the mgmt-airo reconcile call (one try, no ~33s retry storm).
const RECONCILE_TIMEOUT_MS = 3_000;
// Overall ceiling for the WHOLE pull (FGA token + listObjects + reconcile). Each
// leg has its own internal timeout (~8s token + ~4s listObjects + 3s reconcile),
// which would otherwise let a cold/degraded pod stall GET /api/sites for their
// sum (~15s). This bounds the total; the losing work is abandoned (best-effort)
// and the next load retries after the failure cooldown.
const PULL_DEADLINE_MS = 5_000;
const lastPullByCustomer = new Map<string, number>();

function rememberPull(customerId: string, ts: number): void {
  // delete-then-set moves an existing key to the tail, so iteration order is by
  // recency (LRU), not first-insertion (FIFO) — a frequently-refreshed customer
  // must not be evicted before an older idle one.
  lastPullByCustomer.delete(customerId);
  if (lastPullByCustomer.size >= MAX_TRACKED_CUSTOMERS) {
    const oldest = lastPullByCustomer.keys().next().value;
    if (oldest !== undefined) {
      lastPullByCustomer.delete(oldest);
    }
  }
  lastPullByCustomer.set(customerId, ts);
}

// Resolve `work`, but reject if it doesn't settle within `ms`. The losing promise
// keeps running (best-effort) — we just stop awaiting it so the render path isn't
// held hostage to the slowest upstream leg. The timer is cleared once either wins.
function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Invitee-pull: ensure the caller's airo_app_collaborators rows reflect their
 * current OpenFGA venture membership, so a shared app appears in their list
 * without depending on the owner's session or a background worker.
 *
 * Safety: the caller can't forge membership — the BFF reads the caller's
 * ventures from FGA with its OWN service credentials (the caller only triggers
 * it). mgmt-airo then writes ONLY the caller's own rows (customer taken from the
 * forwarded sso-jwt) and only for ventures that map to a known app, view-floor,
 * never downgrading. Grant-only; revokes stay owner-driven.
 *
 * Best-effort + throttled per customer; awaited by the caller so a just-accepted
 * invite surfaces on the same apps-list load. Only call when aab-multi-user is on.
 */
export async function reconcileInviteeShared(jwt: string): Promise<void> {
  const customerId = extractCustomerId(jwt);
  if (!customerId) {
    return;
  }

  const now = Date.now();
  const last = lastPullByCustomer.get(customerId);
  if (last && now - last < THROTTLE_MS) {
    return;
  }
  // Claim the window up front so concurrent loads don't double-fire.
  rememberPull(customerId, now);

  try {
    const result = await withDeadline(
      pullSharedVentures(customerId, jwt),
      PULL_DEADLINE_MS,
      `invitee-pull exceeded ${PULL_DEADLINE_MS}ms deadline`,
    );
    if (result) {
      logger.info('sites.invitee-pull.reconciled', {
        customerId,
        ventures: result.ventures,
        granted: result.granted,
        skipped: result.skipped,
      });
    }
  } catch (error) {
    // Shorten the window (don't clear it) so a transient failure retries after
    // FAILURE_COOLDOWN_MS rather than on the very next load. Measure the cooldown
    // from NOW (failure time) — not the entry-time `now` — so a slow/timed-out
    // call still gets the full cooldown instead of ~0ms.
    rememberPull(customerId, Date.now() - THROTTLE_MS + FAILURE_COOLDOWN_MS);
    logger.warn('sites.invitee-pull.failed', {
      customerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Reads the caller's FGA venture memberships and reconciles them in mgmt-airo.
// Returns null when there's nothing to do (FGA unconfigured, or the caller has no
// venture memberships); otherwise the reconcile counts.
async function pullSharedVentures(
  customerId: string,
  jwt: string,
): Promise<{ ventures: number; granted: number; skipped: number } | null> {
  const cfg = getAuthzFgaConfig();
  if (!cfg) {
    return null;
  }
  const token = await getAuthzFgaAccessToken(cfg);
  const ventureIds = await listObjects(cfg, token, {
    user: `customer:${customerId}`,
    relation: AUTHZ_FGA_RELATIONS.canView,
    type: 'venture',
  });
  if (ventureIds.length === 0) {
    return null;
  }
  const result = await new AiroMgmtClient({
    baseUrl: getMgmtAiroBaseUrl(),
    jwt,
    maxRetries: 1,
    timeoutMs: RECONCILE_TIMEOUT_MS,
  }).reconcileSharedFromVentures(ventureIds);
  return { ventures: ventureIds.length, granted: result.granted, skipped: result.skipped };
}
