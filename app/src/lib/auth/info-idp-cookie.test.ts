/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerWarn = vi.fn();

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import {
  getAccountNameFromInfoIdp,
  getEmailFromDocumentInfoIdpCookies,
  getEmailFromInfoIdp,
  getEmailFromRequestInfoIdpCookies,
  parseInfoIdp,
} from '@/lib/auth/info-idp-cookie';

describe('info-idp-cookie', function infoIdpCookieTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('#getEmailFromInfoIdp', function getEmailTests() {
    it('should read email from the active auth block', function authBlockEmail() {
      const raw = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: {
          email: 'shopper@example.com',
          firstname: 'Test',
          lastname: 'User',
        },
      }));

      expect(getEmailFromInfoIdp(raw)).toBe('shopper@example.com');
    });

    it('should fall back to username when email is absent', function usernameFallback() {
      const raw = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: {
          username: 'shopper@example.com',
        },
      }));

      expect(getEmailFromInfoIdp(raw)).toBe('shopper@example.com');
    });

    it('should scan AUTH_BLOCKS when active auth block has no email', function authBlocksFallback() {
      const raw = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: {},
        s2s: {
          email: 'delegated@example.com',
        },
      }));

      expect(getEmailFromInfoIdp(raw)).toBe('delegated@example.com');
    });
  });

  describe('#getAccountNameFromInfoIdp', function accountNameTests() {
    it('should compose account name from first and last name', function fullName() {
      const raw = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: {
          firstname: 'Cookie',
          lastname: 'User',
        },
      }));

      expect(getAccountNameFromInfoIdp(raw)).toBe('Cookie User');
    });

    it('should fall back to info.basic when auth type is absent', function basicBlockFallback() {
      const raw = encodeURIComponent(JSON.stringify({
        basic: {
          firstname: 'Basic',
          lastname: 'Only',
        },
      }));

      expect(getAccountNameFromInfoIdp(raw)).toBe('Basic Only');
    });

    it('should fall back to info_accountName when name parts are absent', function accountNameField() {
      const raw = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: {
          info_accountName: 'Account Display Name',
        },
      }));

      expect(getAccountNameFromInfoIdp(raw)).toBe('Account Display Name');
    });
  });

  describe('#getEmailFromRequestInfoIdpCookies', function requestCookieTests() {
    it('should prefer login_info_idp over info_idp', function cookiePrecedence() {
      const loginInfoIdp = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: { email: 'login@example.com' },
      }));
      const infoIdp = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: { email: 'info@example.com' },
      }));

      const email = getEmailFromRequestInfoIdpCookies({
        get: (name: string) => {
          if (name === 'login_info_idp') return { value: loginInfoIdp };
          if (name === 'info_idp') return { value: infoIdp };
          return undefined;
        },
      });

      expect(email).toBe('login@example.com');
    });
  });

  describe('#getEmailFromDocumentInfoIdpCookies', function documentCookieTests() {
    it('should prefer login_info_idp over info_idp', function documentCookiePrecedence() {
      const loginInfoIdp = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: { email: 'login@example.com' },
      }));
      const infoIdp = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: { email: 'info@example.com' },
      }));

      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: `info_idp=${infoIdp}; login_info_idp=${loginInfoIdp}`,
      });

      expect(getEmailFromDocumentInfoIdpCookies()).toBe('login@example.com');
    });
  });

  describe('#parseInfoIdp', function parseTests() {
    it('should return null for malformed cookie values', function malformed() {
      expect(parseInfoIdp('not-json', 'info_idp')).toBeNull();
      expect(mockLoggerWarn).toHaveBeenCalledWith('auth.infoIdp.parse.failed', { cookieName: 'info_idp' });
    });
  });
});
