import { describe, expect, it } from 'vitest';

import { getSsoPageToLoad } from '../ssoPageRoute';

// SsoExpirationCode values (keep in sync with lib/features.ts)
const AUTH_CODE = { NOT_EXPIRED: 0, LOGIN: 1, HBI: 2, VAT: 3 } as const;

describe('getSsoPageToLoad', () => {
  describe('new user (no returning cookie)', () => {
    it('routes to /account/create when there is no auth reason', () => {
      expect(getSsoPageToLoad(null, false)).toBe('/account/create');
    });

    it('routes to /login when auth reason is LOGIN (session expiry)', () => {
      expect(getSsoPageToLoad(AUTH_CODE.LOGIN, false)).toBe('/login');
    });

    it('routes to /login when auth reason is VAT', () => {
      expect(getSsoPageToLoad(AUTH_CODE.VAT, false)).toBe('/login');
    });

    it('routes to /hbi when auth reason is HBI (2FA step-up)', () => {
      expect(getSsoPageToLoad(AUTH_CODE.HBI, false)).toBe('/hbi');
    });
  });

  describe('returning user (cookie present)', () => {
    it('routes to /login when there is no auth reason', () => {
      expect(getSsoPageToLoad(null, true)).toBe('/login');
    });

    it('routes to /login when auth reason is LOGIN', () => {
      expect(getSsoPageToLoad(AUTH_CODE.LOGIN, true)).toBe('/login');
    });

    it('routes to /hbi when auth reason is HBI regardless of cookie', () => {
      expect(getSsoPageToLoad(AUTH_CODE.HBI, true)).toBe('/hbi');
    });
  });

  it('routes to /login for any unknown non-null auth reason (forward compat)', () => {
    expect(getSsoPageToLoad(99, false)).toBe('/login');
    expect(getSsoPageToLoad(99, true)).toBe('/login');
  });
});
