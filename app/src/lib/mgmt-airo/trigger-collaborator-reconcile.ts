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
 * the table. The reconcile route is owner-authorized, grant-only, and idempotent,
 * so it's safe to call at every natural moment the owner manages the team — panel
 * open, panel close, and shortly after the team UI changes (an invite/role edit).
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
 * Start a background polling loop that reconciles every 30s for up to 5 minutes,
 * stopping early when `granted > 0` (the invitee's row was successfully mirrored).
 * Only one poll loop runs per appId — subsequent calls reset the deadline without
 * spawning duplicates, so rapid invite→invite doesn't stack loops.
 */
export function startReconcilePolling(appId: string | undefined | null): void {
  if (!appId) {
    return;
  }
  const existing = activePolls.get(appId);
  if (existing) {
    clearTimeout(existing);
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
    const success = await doReconcileAndReport(appId);
    if (success) {
      activePolls.delete(appId);
      return;
    }
    schedulePollTick(appId, deadline);
  }, POLL_INTERVAL_MS);
  activePolls.set(appId, timer);
}

async function doReconcileAndReport(appId: string): Promise<boolean> {
  try {
    const resp = await fetch(`/api/sites/${appId}/collaborators/reconcile`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    });
    if (!resp.ok) {
      return false;
    }
    const body = await resp.json();
    return typeof body.granted === 'number' && body.granted > 0;
  } catch {
    return false;
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
