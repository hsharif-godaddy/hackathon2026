import { type NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { callbackUrl, publicOrigin } from '../config';

function mockRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe('github-config', function configTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
  });

  describe('#publicOrigin', function originTests() {
    it('uses host header', function host() {
      expect(publicOrigin(mockRequest({ host: 'example.com' }))).toBe('https://example.com');
    });

    it('uses x-forwarded-proto header', function proto() {
      expect(publicOrigin(mockRequest({
        host: 'example.com',
        'x-forwarded-proto': 'http',
      }))).toBe('http://example.com');
    });

    it('defaults to localhost:3000 when no host header', function defaultHost() {
      expect(publicOrigin(mockRequest())).toBe('https://localhost:3000');
    });

    it('defaults to https when no proto header', function defaultProto() {
      expect(publicOrigin(mockRequest({ host: 'example.com' }))).toMatch(/^https:\/\//);
    });
  });

  describe('#callbackUrl', function callbackTests() {
    it('combines origin with redirect path', function combine() {
      expect(callbackUrl(mockRequest({ host: 'example.com' }))).toBe(
        'https://example.com/api/github/callback',
      );
    });
  });
});
