import { SsoExpirationCode } from '@/lib/features';

/**
 * Determines which SSO page to load based on the auth failure reason and
 * whether the browser has the returning-user cookie.
 *
 * - HBI (authReason 2): 2FA step-up challenge — always /hbi, cookie irrelevant
 * - authReason present (non-null): session expiry or step-up — always /login
 * - authReason null + not returning: new user — /account/create
 * - authReason null + returning: known user — /login
 */
export function getSsoPageToLoad(authReason: number | null, isReturning: boolean): string {
  if (authReason === SsoExpirationCode.HBI) return '/hbi';
  if (authReason === null && !isReturning) return '/account/create';
  return '/login';
}
