import { logger } from '@/lib/request-context';

const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;

const POLL_INTERVAL_MS = 30_000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000;

const activePolls = new Map<string, number>();

/**
 * Fire-and-forget, owner-side trigger for the collaborator reconcile
 * (`POST /api/sites/:id/collaborators/reconcile`).
 *
 * The multiusersEsm Team panel writes the venture's FGA membership directly and
 * gives us no invite callback, so an invited user gets no `airo_app_collaborators`
 * row (and never appears in their "shared with me" listing) until we mirror FGA →
 * the table. The reconcile route is owner-authorized and idempotent (it grants
 * AND revokes rows to match current FGA membership). This one-shot is used for a
 * single reconcile on panel OPEN and panel CLOSE; ongoing convergence after a
 * team-UI change (invite/resend/revoke) is driven by `startReconcilePolling`.
 * Calling it repeatedly just converges; it 404s harmlessly when aab-multi-user is
 * off. `keepalive` lets it complete across an unmount/navigation.
 *
 * Auto-retry: if the response reports `grantFailures > 0`, up to 3 retries fire
 * with a short delay between each so the invitee appears without waiting for the
 * next manual trigger. Persistent failures surface in logs for ops.
 */
export function triggerCollaboratorReconcile(appId: string | undefined | null): void {
  if (!appId) {
    return;
  }
  void doReconcile(appId, 0);
}

/**
 * Start (or reset) a background polling loop that reconciles every 30s for up to
 * 5 minutes. Runs UNCONDITIONALLY through the whole window — it does NOT stop on
 * the first successful grant. FGA is eventually consistent and several invited
 * members can propagate on different ticks, so an early-exit on the first grant
 * could miss later invitees. Each reconcile is idempotent (grant + revoke).
 *
 * Only one loop runs per appId: a subsequent call clears the existing timer and
 * resets the 5-minute deadline, so repeated invite/resend/revoke actions just
 * extend the window — they never stack parallel loops.
 */
export function startReconcilePolling(appId: string | undefined | null): void {
  if (!appId) {
    return;
  }
  const existing = activePolls.get(appId);
  if (existing) {
    // A loop is already running — just reset its 5-minute deadline. No extra
    // immediate reconcile, so rapid changes within a window don't spam the route.
    clearTimeout(existing);
  } else {
    // Fresh start (e.g. the first invite/resend/revoke this window) — reconcile
    // immediately so the change is mirrored without waiting 30s for the first
    // tick, matching the prompt reconcile the panel fires on open/close.
    void doReconcileAndReport(appId);
  }
  const deadline = Date.now() + POLL_MAX_DURATION_MS;
  schedulePollTick(appId, deadline);
}

export function stopReconcilePolling(appId: string | undefined | null): void {
  if (!appId) {
    return;
  }
  const timer = activePolls.get(appId);
  if (timer) {
    clearTimeout(timer);
    activePolls.delete(appId);
  }
}

function schedulePollTick(appId: string, deadline: number): void {
  const timer = window.setTimeout(async () => {
    if (Date.now() >= deadline) {
      activePolls.delete(appId);
      logger.warn('collaborator.reconcile.poll_expired', { appId });
      return;
    }
    // Reconcile on every tick through the full window — never stop early.
    await doReconcileAndReport(appId);
    // Re-arm ONLY if the loop is still active. stopReconcilePolling can run while
    // the await above is in-flight (panel unmount / app change), which deletes
    // this appId from activePolls; clearTimeout can't cancel an already-fired
    // tick parked on the await, so without this guard the resolving fetch would
    // schedule a fresh timer and resurrect a loop the caller believes is stopped.
    if (activePolls.has(appId)) {
      schedulePollTick(appId, deadline);
    }
  }, POLL_INTERVAL_MS);
  activePolls.set(appId, timer);
}

async function doReconcileAndReport(appId: string): Promise<void> {
  try {
    const resp = await fetch(`/api/sites/${appId}/collaborators/reconcile`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    });
    if (!resp.ok) {
      // Surface persistent failures (e.g. repeated 5xx) so a stuck window is
      // visible in logs before the final poll_expired warn.
      logger.warn('collaborator.reconcile.poll_http_error', { appId, status: resp.status });
      return;
    }
    const body = await resp.json();
    if (typeof body.granted === 'number' && body.granted > 0) {
      logger.info('collaborator.reconcile.poll_granted', { appId, granted: body.granted });
    }
  } catch (error) {
    // Transient (network/unmount); the next tick retries within the window.
    logger.warn('collaborator.reconcile.poll_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function doReconcile(appId: string, attempt: number): Promise<void> {
  try {
    const resp = await fetch(`/api/sites/${appId}/collaborators/reconcile`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    });
    if (!resp.ok) {
      return;
    }
    const body = await resp.json();
    if (attempt < MAX_RETRIES && typeof body.grantFailures === 'number' && body.grantFailures > 0) {
      logger.warn('collaborator.reconcile.partial_retry_scheduled', {
        appId,
        grantFailures: body.grantFailures,
        attempt: attempt + 1,
      });
      setTimeout(() => doReconcile(appId, attempt + 1), RETRY_DELAY_MS);
    }
  } catch (error) {
    logger.warn('collaborator.reconcile.trigger_failed', {
      appId,
      attempt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
