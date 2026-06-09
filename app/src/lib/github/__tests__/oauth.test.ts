import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config', () => ({
  get: vi.fn(function get() {
    return {
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      tokenUrl: 'https://github.com/login/oauth/access_token',
    };
  }),
}));

import {
  buildOAuthCookie,
  clearOAuthCookie,
  decodeState,
  encodeState,
  exchangeCodeForTokens,
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  parseCookies,
  refreshAccessToken,
  validateReturnTo,
} from '../oauth';

describe('github-oauth', function oauthTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
  });

  describe('#generateNonce', function nonceTests() {
    it('returns a 64-character hex string', function length() {
      expect(generateNonce()).toHaveLength(64);
    });

    it('only contains hex characters', function hex() {
      expect(generateNonce()).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces unique values on successive calls', function unique() {
      expect(generateNonce()).not.toBe(generateNonce());
    });
  });

  describe('#generateCodeVerifier', function verifierTests() {
    it('returns a non-empty string', function nonEmpty() {
      expect(generateCodeVerifier().length).toBeGreaterThan(0);
    });

    it('is base64url encoded with no +, /, or = characters', function encoding() {
      expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('#generateCodeChallenge', function challengeTests() {
    it('is deterministic for the same verifier', function deterministic() {
      const verifier = generateCodeVerifier();
      expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier));
    });

    it('produces different challenges for different verifiers', function different() {
      expect(generateCodeChallenge('verifier-a')).not.toBe(generateCodeChallenge('verifier-b'));
    });

    it('returns base64url encoded output', function encoding() {
      expect(generateCodeChallenge('test-verifier')).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('#encodeState / #decodeState', function stateTests() {
    it('round-trips encode then decode', function roundTrip() {
      const state = { appId: 'app-1', returnTo: '/dashboard', nonce: 'abc123' };
      expect(decodeState(encodeState(state))).toEqual(state);
    });

    it('returns null for invalid base64', function invalidBase64() {
      expect(decodeState('!!!not-base64!!!')).toBeNull();
    });

    it('returns null for valid base64 but invalid JSON', function invalidJson() {
      expect(decodeState(Buffer.from('not json').toString('base64url'))).toBeNull();
    });

    it('returns null for empty string', function empty() {
      expect(decodeState('')).toBeNull();
    });
  });

  describe('#buildOAuthCookie', function cookieTests() {
    it('includes HttpOnly', function httpOnly() {
      expect(buildOAuthCookie('tok', 'val')).toContain('HttpOnly');
    });

    it('includes Path=/api/github', function path() {
      expect(buildOAuthCookie('tok', 'val')).toContain('Path=/api/github');
    });

    it('includes Max-Age=300', function maxAge() {
      expect(buildOAuthCookie('tok', 'val')).toContain('Max-Age=300');
    });

    it('includes SameSite=Lax', function sameSite() {
      expect(buildOAuthCookie('tok', 'val')).toContain('SameSite=Lax');
    });

    it('does not include Secure in non-production', function noSecure() {
      expect(buildOAuthCookie('tok', 'val')).not.toContain('Secure');
    });

    it('includes Secure in production', function secure() {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(buildOAuthCookie('tok', 'val')).toContain('Secure');
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });

  describe('#clearOAuthCookie', function clearCookieTests() {
    it('sets Max-Age=0', function maxAge() {
      expect(clearOAuthCookie('tok')).toContain('Max-Age=0');
    });

    it('includes HttpOnly', function httpOnly() {
      expect(clearOAuthCookie('tok')).toContain('HttpOnly');
    });

    it('preserves the cookie name', function name() {
      expect(clearOAuthCookie('my_cookie')).toMatch(/^my_cookie=/);
    });
  });

  describe('#parseCookies', function parseCookieTests() {
    it('returns empty object for null', function nullInput() {
      expect(parseCookies(null)).toEqual({});
    });

    it('returns empty object for empty string', function emptyInput() {
      expect(parseCookies('')).toEqual({});
    });

    it('parses a single cookie', function single() {
      expect(parseCookies('name=value')).toEqual({ name: 'value' });
    });

    it('parses multiple cookies separated by semicolons', function multiple() {
      expect(parseCookies('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
    });

    it('handles values containing = signs', function equals() {
      expect(parseCookies('tok=abc=def=')).toEqual({ tok: 'abc=def=' });
    });

    it('trims whitespace around keys and values', function whitespace() {
      expect(parseCookies('  a = 1 ;  b = 2 ')).toEqual({ a: '1', b: '2' });
    });
  });

  describe('#validateReturnTo', function validateTests() {
    it('allows simple relative paths', function simple() {
      expect(validateReturnTo('/dashboard')).toBe(true);
    });

    it('allows paths with query strings', function query() {
      expect(validateReturnTo('/app?id=123')).toBe(true);
    });

    it('allows nested paths', function nested() {
      expect(validateReturnTo('/en-US/develop')).toBe(true);
    });

    it('rejects empty string', function empty() {
      expect(validateReturnTo('')).toBe(false);
    });

    it('rejects protocol-relative URLs', function protocolRelative() {
      expect(validateReturnTo('//evil.com')).toBe(false);
    });

    it('rejects absolute URLs', function absolute() {
      expect(validateReturnTo('https://evil.com')).toBe(false);
    });

    it('rejects backslash trick', function backslash() {
      expect(validateReturnTo('/\\evil.com')).toBe(false);
    });
  });

  describe('#exchangeCodeForTokens', function exchangeTests() {
    it('throws on non-ok HTTP response', async function httpError() {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('Bad Gateway', { status: 502 }),
      );

      await expect(exchangeCodeForTokens('code', 'verifier', 'http://localhost/cb'))
        .rejects.toThrow('GitHub token exchange HTTP 502');
      vi.restoreAllMocks();
    });

    it('throws when response JSON contains error field', async function oauthError() {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'bad_verification_code', error_description: 'bad code' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(exchangeCodeForTokens('code', 'verifier', 'http://localhost/cb'))
        .rejects.toThrow('bad code');
      vi.restoreAllMocks();
    });

    it('throws when access_token or expires_in missing', async function missingFields() {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ token_type: 'bearer' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(exchangeCodeForTokens('code', 'verifier', 'http://localhost/cb'))
        .rejects.toThrow('missing required fields');
      vi.restoreAllMocks();
    });

    it('returns parsed tokens on valid response', async function valid() {
      const payload = { access_token: 'gho_abc', refresh_token: 'ghr_xyz', expires_in: 28800, token_type: 'bearer' };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await exchangeCodeForTokens('code', 'verifier', 'http://localhost/cb');
      expect(result.access_token).toBe('gho_abc');
      expect(result.expires_in).toBe(28800);
      vi.restoreAllMocks();
    });
  });

  describe('#refreshAccessToken', function refreshTests() {
    it('throws on non-ok HTTP response', async function httpError() {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      );

      await expect(refreshAccessToken('ghr_old'))
        .rejects.toThrow('GitHub token refresh HTTP 500');
      vi.restoreAllMocks();
    });

    it('throws when response contains error', async function oauthError() {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(refreshAccessToken('ghr_old'))
        .rejects.toThrow('GitHub token refresh failed');
      vi.restoreAllMocks();
    });

    it('throws when access_token or expires_in missing', async function missingFields() {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ token_type: 'bearer' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(refreshAccessToken('ghr_old'))
        .rejects.toThrow('missing required fields');
      vi.restoreAllMocks();
    });
  });
});
