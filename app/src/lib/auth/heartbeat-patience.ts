import { SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY } from '@/config/switchboard-flags';
import { getSwitchboardFlag } from '@/hooks/useSwitchboard';
import { logger } from '@/lib/request-context';
import { isReturningUser } from '@/lib/returningUser';

const NETWORK_WAIT_MS: number = 5_000;
const INITIAL_DELAY_MS: number = 2_000;
const RETRY_INTERVAL_MS: number = 1_000;
const MAX_RETRIES: number = 3;
export const HEARTBEAT_PATIENCE_RELOAD_KEY: string = '__airo_heartbeat_patience_reload';

export interface HeartbeatPatienceResult {
  recovered: boolean;
}

/**
 * Determines whether heartbeat patience should activate. Returns false for
 * anonymous visitors (no returning-user cookie), disabled flag, or if patience
 * already ran this page load (succeeded or exhausted).
 */
export function shouldAttemptHeartbeatPatience(): boolean {
  const flagEnabled: boolean =
    getSwitchboardFlag(SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY) ?? false;

  if (!flagEnabled) return false;

  if (!isReturningUser()) return false;

  if (
    typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem(HEARTBEAT_PATIENCE_RELOAD_KEY) === '1'
  ) {
    return false;
  }

  return true;
}

/**
 * Probes /api/auth/validate after a 2s initial delay, retrying up to 3 more
 * times at 1s intervals (4 probes total, ~5s budget). On a successful probe
 * (response.ok), sets a session marker and reloads. On exhaustion or abort,
 * sets the same marker (preventing a second patience loop on protected routes)
 * and resolves with recovered=false.
 *
 * Shared between AuthProvider (public pages) and SsoLoginPrompt (protected
 * pages) — the session marker ensures only one loop runs per page load.
 */
export async function awaitHeartbeatRecovery(
  signal: AbortSignal,
): Promise<HeartbeatPatienceResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await new Promise<void>((resolve) => {
      const onOnline = (): void => { window.removeEventListener('online', onOnline); resolve(); };
      window.addEventListener('online', onOnline);
      const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
        window.removeEventListener('online', onOnline);
        resolve();
      }, NETWORK_WAIT_MS);
      signal.addEventListener('abort', () => {
        window.removeEventListener('online', onOnline);
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
    if (signal.aborted) {
      markAttempted();
      return { recovered: false };
    }
  }

  if (signal.aborted) {
    markAttempted();
    return { recovered: false };
  }

  // Kick an immediate vat refresh before probing, via heartbeat-js dispatch()
  // (window.heartbeat) rather than a hand-rolled ui_heartbeat POST. Fire-and-forget:
  // the INITIAL_DELAY_MS wait below (abortable) gives the refresh time to land
  // before the probe loop; redirectOn401:false suppresses navigation on failure.
  // Guarded like gasket-auth's own call: dispatch() runs synchronously up to a
  // cookie decode that can throw (URIError on a malformed info_idp); a throw
  // here must not skip the probe loop / markAttempted below.
  try {
    window.heartbeat?.dispatch?.({ redirectOn401: false })?.catch(() => {});
  } catch {
    // fall through to the probe loop
  }

  await new Promise<void>((resolve) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(resolve, INITIAL_DELAY_MS);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

  if (signal.aborted) {
    markAttempted();
    return { recovered: false };
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => {
        const delay: ReturnType<typeof setTimeout> = setTimeout(resolve, RETRY_INTERVAL_MS);
        signal.addEventListener('abort', () => { clearTimeout(delay); resolve(); }, { once: true });
      });
      if (signal.aborted) {
        markAttempted();
        return { recovered: false };
      }
    }
    try {
      const probe: Response = await fetch('/api/auth/validate?level=1', {
        credentials: 'include',
        signal,
      });
      if (signal.aborted) {
        markAttempted();
        return { recovered: false };
      }
      if (probe.ok) {
        logger.info('auth.heartbeat-patience.recovered', { attempt });
        markAttempted();
        window.location.reload();
        return { recovered: true };
      }
    } catch (err: unknown) {
      if (signal.aborted) {
        markAttempted();
        return { recovered: false };
      }
      logger.warn('auth.heartbeat-patience.probe-error', {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.warn('auth.heartbeat-patience.exhausted');
  markAttempted();
  return { recovered: false };
}

function markAttempted(): void {
  try {
    sessionStorage.setItem(HEARTBEAT_PATIENCE_RELOAD_KEY, '1');
  } catch (err: unknown) {
    logger.warn('auth.heartbeat-patience.storage-error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
