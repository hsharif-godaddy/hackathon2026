import { SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY } from '@/config/switchboard-flags';
import { getSwitchboardFlag } from '@/hooks/useSwitchboard';
import { logger } from '@/lib/request-context';
import { isReturningUser } from '@/lib/returningUser';

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
