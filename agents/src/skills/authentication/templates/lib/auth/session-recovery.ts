/**
 * Client-side stale-session recovery.
 *
 * When `useSession()` surfaces an error (or never settles) the usual cause is a
 * stale `better-auth.session_token` cookie the server can no longer validate.
 * React error boundaries can't catch it — a failed session lookup is a returned
 * value, not a thrown error — so the app would otherwise sit blank forever.
 *
 * Recovery: hit the server's `?clearCookies=1` escape hatch to expire the
 * HttpOnly cookie, then reload into a clean unauthenticated state. The reload
 * must be one-shot: if clearing doesn't fix it (truly broken auth), a second
 * attempt would loop. `claimSessionRecovery` enforces that, scoped to the tab
 * via the injected `sessionStorage`-like store.
 */

export const SESSION_RECOVERY_STORAGE_KEY = 'better-auth.session-recovery-attempted';
export const SESSION_RECOVERY_URL = '/api/auth/get-session?clearCookies=1';

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Returns `true` at most once per storage scope. The caller should only clear
 * cookies + reload when this returns `true`, so an unfixable session can't
 * reload-loop. Fails closed (returns `false`) if storage is unavailable —
 * skipping recovery is safer than an unguarded reload.
 */
export function claimSessionRecovery(storage: RecoveryStorage): boolean {
  try {
    if (storage.getItem(SESSION_RECOVERY_STORAGE_KEY) === '1') return false;
    storage.setItem(SESSION_RECOVERY_STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Resets the one-shot guard. Called once a session resolves healthy so a
 * genuinely new stale-cookie failure later in the same tab can recover again.
 * Best-effort: never throws if storage is unavailable.
 */
export function clearSessionRecovery(storage: RecoveryStorage): void {
  try {
    storage.removeItem(SESSION_RECOVERY_STORAGE_KEY);
  } catch {
    // Storage unavailable — the guard simply stays as-is.
  }
}
