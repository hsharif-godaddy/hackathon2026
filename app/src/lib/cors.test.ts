
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCorsOptionsHandler, withCorsHeaders } from './cors';

describe('cors', () => {
  const whitelistedOrigin = 'https://start.godaddy.com';

  describe('withCorsHeaders', () => {
    let response;

    beforeEach(() => {
      response = NextResponse.json({ ok: true });
    });

    it('returns response with additional CORS headers if origin is whitelisted', () => {
      withCorsHeaders(response, whitelistedOrigin, 'QUICK_CREATE');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(whitelistedOrigin);
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      expect(response.headers.get('Vary')).toBe('Origin');
    });

    it.each([
      'https://evil.example.com',
      'https://local.cx.godaddy.com', // no port
      'http://local.cx.godaddy.com:8443', // wrong scheme
      null,
    ])('does not set CORS headers for non-allowlisted origin %s', (origin) => {
      const response = withCorsHeaders(NextResponse.json({ ok: true }), origin, 'QUICK_CREATE');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });

    it('does not set CORS headers if origin is not supplied', () => {
      withCorsHeaders(response, undefined, 'QUICK_CREATE');
      expect(Object.fromEntries(response.headers.entries())).toStrictEqual({ 'content-type': 'application/json' });
    });

    it('does not set CORS headers if the route key is unrecognized ', () => {
      withCorsHeaders(response, undefined, 'UNKNOWN_ROUTE' as any);
      expect(Object.fromEntries(response.headers.entries())).toStrictEqual({ 'content-type': 'application/json' });
    });

    it('sets the Access-Control-Allow-Methods header correctly for quick-create/POST', () => {
      withCorsHeaders(response, whitelistedOrigin, 'QUICK_CREATE');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    });

    it('sets the Access-Control-Allow-Methods header correctly for get-sites/GET', () => {  
      withCorsHeaders(response, 'https://account.godaddy.com', 'GET_SITES');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    });
  });

  describe('createCorsOptionsHandler', () => {
    let request;

    beforeEach(() => {
      request = {
        headers: {
          get: vi.fn((header) => header === 'origin' ? whitelistedOrigin : `mocked-header-${header}`),
        },
      };
    });

    it('returns an expected response object', async () => {
      const result = createCorsOptionsHandler('QUICK_CREATE');
      expect(result).toBeInstanceOf(Function);
      expect(result.name).toBe('OPTIONS')

      const optionsResponse = await result(request);
      expect(optionsResponse.status).toBe(204);
      expect(optionsResponse.headers.get('Access-Control-Allow-Origin')).toBe(whitelistedOrigin);
    });

    it('does not include CORS headers if origin is not whitelisted', async () => {
      request.headers.get = vi.fn((header) => `mocked-header-${header}`);
      const result = createCorsOptionsHandler('GET_SITES');
      const optionsResponse = await result(request);
      expect(optionsResponse.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });
});
