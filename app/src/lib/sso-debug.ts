import { SsoExpirationCode } from '@/lib/features';
import { AUTH_PREFLIGHT_TIMEOUT_MS, AuthDismissedError, authPreflight, SSO_TIMEOUT_OVERRIDE_KEY } from '@/lib/gasket-config';
import { ContextLogger } from '@/lib/request-context';
import { useAuthUIStore } from '@/stores/useAuthUIStore';

export function isSsoDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('__airo_debug') === '1';
}

export function initSsoDebugTools(): void {
  if (!isSsoDebugEnabled()) return;

  const sso = {
    expire(opts?: { level?: 1 | 2 | 3 }): void {
      const level = opts?.level ?? 1;
      const authReason = level === 3 ? SsoExpirationCode.HBI : SsoExpirationCode.LOGIN;
      const store = useAuthUIStore.getState();
      store.setSsoAuthReason(authReason);
      store.setRedirectUrl(window.location.href);
      store.openSsoLogin();
      console.info(`[__airo.sso] modal opened — level ${level}, authReason: ${authReason ?? 'none'}`);
    },

    succeed(): void {
      const store = useAuthUIStore.getState();
      if (!store.isSsoLoginOpen) {
        console.warn('[__airo.sso] no modal is open');
        return;
      }
      console.warn('[__airo.sso] analytics side-effect: fires auth_gate.completed / auth_gate_completed journey milestone — avoid in prod sessions');
      store.closeSsoLogin('success');
      console.info('[__airo.sso] modal closed → success');
    },

    dismiss(): void {
      const store = useAuthUIStore.getState();
      if (!store.isSsoLoginOpen) {
        console.warn('[__airo.sso] no modal is open');
        return;
      }
      console.warn('[__airo.sso] analytics side-effect: fires auth_gate.dismissed journey milestone; on /create?initialPrompt=… this also redirects to homepage');
      store.closeSsoLogin('dismiss');
      console.info('[__airo.sso] modal closed → dismiss');
    },

    expireIn(ms: number, opts?: { level?: 1 | 2 | 3 }): void {
      const clamped = Math.max(ms, 0);
      console.info(`[__airo.sso] modal will open in ${clamped}ms`);
      setTimeout(() => sso.expire(opts), clamped);
    },

    timeout(ms: number): void {
      const clamped = Math.min(Math.max(ms, 1000), AUTH_PREFLIGHT_TIMEOUT_MS);
      localStorage.setItem(SSO_TIMEOUT_OVERRIDE_KEY, String(clamped));
      if (clamped !== ms) {
        console.warn(`[__airo.sso] clamped ${ms}ms → ${clamped}ms (range: 1000–${AUTH_PREFLIGHT_TIMEOUT_MS}ms)`);
      } else {
        console.info(`[__airo.sso] preflight timeout → ${clamped}ms (takes effect on next modal open)`);
      }
    },

    clearTimeout(): void {
      localStorage.removeItem(SSO_TIMEOUT_OVERRIDE_KEY);
      console.info(`[__airo.sso] preflight timeout cleared → default ${AUTH_PREFLIGHT_TIMEOUT_MS}ms`);
    },

    status(): void {
      const store = useAuthUIStore.getState();
      const raw = localStorage.getItem(SSO_TIMEOUT_OVERRIDE_KEY);
      const ctx = ContextLogger.getClientBaseContext();
      const now = Math.floor(Date.now() / 1000);

      const formatEpoch = (epoch: unknown): string => {
        if (typeof epoch !== 'number') return 'unknown';
        const ago = Math.round((now - epoch) / 60);
        return `${new Date(epoch * 1000).toLocaleString()} (${ago}m ago)`;
      };

      const formatExp = (epoch: unknown): string => {
        if (typeof epoch !== 'number') return 'unknown';
        const remaining = Math.round((epoch - now) / 60);
        return `${new Date(epoch * 1000).toLocaleString()} (in ${remaining}m)`;
      };

      console.table({
        'last login (iat)': formatEpoch(ctx.tokenIat),
        'last heartbeat (hbi)': formatEpoch(ctx.tokenHbi),
        'token expires (exp)': formatExp(ctx.tokenExp),
        'persistent session': ctx.isPersistent ?? 'unknown',
        'auth type': ctx.authType ?? 'unknown',
        'modal open': store.isSsoLoginOpen,
        'modal loading': store.isSsoLoading,
        'auth reason': store.ssoAuthReason ?? 'none',
        'last close reason': store.ssoCloseReason ?? 'none',
        'redirect URL': store.redirectUrl ?? 'none',
        'preflight timeout': raw ? `${raw}ms (override)` : `${AUTH_PREFLIGHT_TIMEOUT_MS}ms (default)`,
      });
    },

    token(): void {
      const ctx = ContextLogger.getClientBaseContext();
      const now = Math.floor(Date.now() / 1000);

      if (!ctx.tokenIat) {
        console.warn('[__airo.sso] token not yet loaded — auth state not initialized');
        return;
      }

      const fmt = (epoch: unknown, label: string): void => {
        if (typeof epoch !== 'number') return;
        const delta = Math.round((epoch - now) / 60);
        const sign = delta >= 0 ? `in ${delta}m` : `${Math.abs(delta)}m ago`;
        console.info(`  ${label}: ${new Date(epoch * 1000).toLocaleString()} (${sign})`);
      };

      console.info('[__airo.sso] current token:');
      fmt(ctx.tokenIat, 'iat  (last login)    ');
      fmt(ctx.tokenHbi, 'hbi  (last heartbeat)');
      fmt(ctx.tokenExp, 'exp  (expires)       ');
      if (ctx.isPersistent !== undefined) console.info(`  per  (persistent):    ${ctx.isPersistent}`);
      if (ctx.authType) console.info(`  auth type:           ${ctx.authType}`);
    },

    async preflight(level: 1 | 2 | 3 = 1): Promise<void> {
      console.info(`[__airo.sso] calling authPreflight(${level})…`);
      try {
        const result = await authPreflight(level);
        if (result === null) {
          console.info('[__airo.sso] preflight passed — auth is valid');
        } else {
          console.warn(`[__airo.sso] preflight returned non-null response: ${result.status}`);
        }
      } catch (err) {
        if (err instanceof AuthDismissedError) {
          console.info('[__airo.sso] preflight: user dismissed the modal');
        } else {
          console.warn(`[__airo.sso] preflight threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
  };

  (window as typeof window & { __airo?: { sso: typeof sso } }).__airo = { sso };

  console.info(
    '%c__airo.sso%c debug tools active\n' +
    '  expire(opts?)      open modal now  { level: 1|2|3 }  (level 3 → /hbi)\n' +
    '  expireIn(ms, opts) open modal after delay\n' +
    '  succeed()          close modal → success\n' +
    '  dismiss()          close modal → dismiss\n' +
    '  timeout(ms)        how long modal stays open before timing out  1000–300000 ms\n' +
    '  clearTimeout()     restore default modal timeout\n' +
    '  token()            print decoded token claims (iat, hbi, exp, per, authType)\n' +
    '  preflight(level?)  run authPreflight directly (tests pending-SSO locking)\n' +
    '  status()           print full SSO + modal state',
    'font-weight:bold',
    'font-weight:normal',
  );
}
