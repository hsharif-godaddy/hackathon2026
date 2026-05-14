import { describe, it, expect, vi } from 'vitest';

import { decodeJwtExp } from '../jwt-expiry.js';

function encodePayload(claims: Record<string, unknown>): string {
  const json = JSON.stringify(claims);
  return Buffer.from(json).toString('base64url');
}

function makeJwt(claims: Record<string, unknown>): string {
  return `eyJhbGciOiJSUzI1NiJ9.${encodePayload(claims)}.fake-signature`;
}

describe('decodeJwtExp', () => {
  describe('with exp claim', () => {
    it('should return exp when present', () => {
      const exp = 1700000000;
      expect(decodeJwtExp(makeJwt({ exp }))).toBe(exp);
    });

    it('should prefer exp over iat', () => {
      const exp = 1700000000;
      expect(decodeJwtExp(makeJwt({ exp, iat: 1699990000 }))).toBe(exp);
    });
  });

  describe('with iat only', () => {
    it('should return iat + 30 minutes when exp is missing', () => {
      const iat = 1700000000;
      expect(decodeJwtExp(makeJwt({ iat }))).toBe(iat + 30 * 60);
    });
  });

  describe('with neither exp nor iat', () => {
    it('should return null for empty claims', () => {
      expect(decodeJwtExp(makeJwt({}))).toBeNull();
    });

    it('should return null for non-numeric exp', () => {
      expect(decodeJwtExp(makeJwt({ exp: 'not-a-number' }))).toBeNull();
    });
  });

  describe('malformed inputs', () => {
    it('should return null for non-string input', () => {
      expect(decodeJwtExp(123 as unknown as string)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(decodeJwtExp('')).toBeNull();
    });

    it('should return null for token with wrong number of parts', () => {
      expect(decodeJwtExp('only-one-part')).toBeNull();
      expect(decodeJwtExp('two.parts')).toBeNull();
      expect(decodeJwtExp('a.b.c.d')).toBeNull();
    });

    it('should return null for invalid base64 payload', () => {
      expect(decodeJwtExp('header.!!!invalid-base64!!!.sig')).toBeNull();
    });

    it('should return null for non-JSON payload', () => {
      const notJson = Buffer.from('this is not json').toString('base64url');
      expect(decodeJwtExp(`header.${notJson}.sig`)).toBeNull();
    });
  });

  describe('onDecodeFailed callback', () => {
    it('should call onDecodeFailed when payload is not valid JSON', () => {
      const callback = vi.fn();
      const notJson = Buffer.from('not json').toString('base64url');

      decodeJwtExp(`header.${notJson}.sig`, callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0]).toBeInstanceOf(SyntaxError);
    });

    it('should not call onDecodeFailed on successful decode', () => {
      const callback = vi.fn();
      decodeJwtExp(makeJwt({ exp: 1700000000 }), callback);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not call onDecodeFailed for structural issues (wrong part count)', () => {
      const callback = vi.fn();
      decodeJwtExp('only-one-part', callback);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('non-object JSON payloads', () => {
    it('should return null for null payload', () => {
      const payload = Buffer.from('null').toString('base64url');
      expect(decodeJwtExp(`h.${payload}.s`)).toBeNull();
    });

    it('should return null for array payload', () => {
      const payload = Buffer.from('[1,2,3]').toString('base64url');
      expect(decodeJwtExp(`h.${payload}.s`)).toBeNull();
    });

    it('should return null for string payload', () => {
      const payload = Buffer.from('"just-a-string"').toString('base64url');
      expect(decodeJwtExp(`h.${payload}.s`)).toBeNull();
    });

    it('should return null for number payload', () => {
      const payload = Buffer.from('42').toString('base64url');
      expect(decodeJwtExp(`h.${payload}.s`)).toBeNull();
    });
  });

  describe('base64url edge cases', () => {
    it('should handle base64url with padding needed', () => {
      const exp = 1700000000;
      const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
      expect(decodeJwtExp(`h.${payload}.s`)).toBe(exp);
    });

    it('should handle standard base64 with + and /', () => {
      const exp = 1700000000;
      const payload = Buffer.from(JSON.stringify({ exp }))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      expect(decodeJwtExp(`h.${payload}.s`)).toBe(exp);
    });
  });
});
