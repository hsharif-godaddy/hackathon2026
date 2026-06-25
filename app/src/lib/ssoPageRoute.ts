import { SsoExpirationCode } from '@/lib/features';

/**
 * Determines which SSO page to load based on the auth failure reason and
 * whether the browser has the returning-user cookie.
 *
 * - HBI (authReason 2): 2FA step-up challenge — always /hbi, cookie irrelevant
 * - SSO Lite enabled: email-first progressive sign-in — /login/progressive
 * - authReason present (non-null): session expiry or step-up — always /login
 * - authReason null + not returning: new user — /account/create
 * - authReason null + returning: known user — /login
 */
export function getSsoPageToLoad(authReason: number | null, isReturning: boolean, useSsoLite: boolean = false): string {
  if (authReason === SsoExpirationCode.HBI) return '/hbi';
  if (useSsoLite) return '/login/progressive';
  if (authReason === null && !isReturning) return '/account/create';
  return '/login';
}
