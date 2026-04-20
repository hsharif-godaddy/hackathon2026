import { describe, expect, it } from 'vitest';

import { extractCookieValue } from '@/lib/cookies';

describe('cookies', () => {
  describe('#extractCookieValue', () => {
    it('returns null when header is null', () => {
      expect(extractCookieValue(null, 'auth_jomax')).toBeNull();
    });

    it('returns null when header is empty', () => {
      expect(extractCookieValue('', 'auth_jomax')).toBeNull();
    });

    it('returns the value of a single cookie', () => {
      expect(extractCookieValue('auth_jomax=abc123', 'auth_jomax')).toBe('abc123');
    });

    it('extracts the named cookie from a multi-cookie header', () => {
      const header = 'foo=bar; auth_jomax=token-value; other=baz';
      expect(extractCookieValue(header, 'auth_jomax')).toBe('token-value');
    });

    it('trims surrounding whitespace from name and value', () => {
      const header = '  auth_jomax  =  spaced-value  ; foo=bar';
      expect(extractCookieValue(header, 'auth_jomax')).toBe('spaced-value');
    });

    it('returns null when the cookie is not present', () => {
      expect(extractCookieValue('foo=bar; baz=qux', 'auth_jomax')).toBeNull();
    });

    it('does not partial-match a cookie name (auth_jomax_other should not match auth_jomax)', () => {
      expect(extractCookieValue('auth_jomax_other=value', 'auth_jomax')).toBeNull();
    });

    it('preserves "=" inside the cookie value (e.g. base64 padding)', () => {
      expect(extractCookieValue('auth_jomax=abc==', 'auth_jomax')).toBe('abc==');
    });

    it('skips malformed segments without an "="', () => {
      const header = 'malformed; auth_jomax=ok';
      expect(extractCookieValue(header, 'auth_jomax')).toBe('ok');
    });

    it('returns the first occurrence when the cookie name appears twice', () => {
      const header = 'auth_jomax=first; auth_jomax=second';
      expect(extractCookieValue(header, 'auth_jomax')).toBe('first');
    });
  });
});
