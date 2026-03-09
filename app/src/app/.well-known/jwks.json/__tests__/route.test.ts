import { generateKeyPairSync } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPublicKeys = vi.fn();
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('../../../../lib/jwt-service', () => ({
  getJWTService: () => ({ getPublicKeys: mockGetPublicKeys }),
}));

vi.mock('../../../../lib/request-context', () => ({
  logger: mockLogger,
}));

// Generate a real RSA key pair for pemToJwk to work with
const { publicKey: rsaPublicPem } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function makeKeyMetadata(overrides: Record<string, unknown> = {}) {
  return {
    keyId: 'key-1',
    status: 'active',
    publicKey: rsaPublicPem as string,
    ...overrides,
  };
}

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/.well-known/jwks.json', { headers });
}

// Each test gets a fresh module to reset module-level cache/inflight state
async function importRoute() {
  return import('../route') as Promise<typeof import('../route')>;
}

describe('JWKS route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mockGetPublicKeys.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  describe('GET', () => {
    it('returns 200 with JWKS keys and proper headers', async () => {
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const { GET } = await importRoute();

      const response = await GET(makeRequest() as never);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.keys).toHaveLength(1);
      expect(data.keys[0].kid).toBe('key-1');
      expect(data.keys[0].kty).toBe('RSA');
      expect(data.keys[0].alg).toBe('RS256');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('cache-control')).toContain('max-age=300');
      expect(response.headers.get('etag')).toMatch(/^"jwks-[a-f0-9]{12}"$/);
    });

    it('filters to only active and rotating keys', async () => {
      mockGetPublicKeys.mockResolvedValue([
        makeKeyMetadata({ keyId: 'active-1', status: 'active' }),
        makeKeyMetadata({ keyId: 'rotating-1', status: 'rotating' }),
        makeKeyMetadata({ keyId: 'retired-1', status: 'retired' }),
      ]);
      const { GET } = await importRoute();

      const response = await GET(makeRequest() as never);
      const data = await response.json();

      expect(data.keys).toHaveLength(2);
      const kids = data.keys.map((k: { kid: string }) => k.kid);
      expect(kids).toContain('active-1');
      expect(kids).toContain('rotating-1');
      expect(kids).not.toContain('retired-1');
    });

    it('sorts keys by keyId for deterministic ETag', async () => {
      mockGetPublicKeys.mockResolvedValue([
        makeKeyMetadata({ keyId: 'z-key' }),
        makeKeyMetadata({ keyId: 'a-key' }),
      ]);
      const { GET } = await importRoute();

      const response = await GET(makeRequest() as never);
      const data = await response.json();

      expect(data.keys[0].kid).toBe('a-key');
      expect(data.keys[1].kid).toBe('z-key');
    });

    it('returns 304 when If-None-Match matches ETag', async () => {
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const { GET } = await importRoute();

      // First request to get the ETag
      const first = await GET(makeRequest() as never);
      const etag = first.headers.get('etag')!;

      // Second request with matching If-None-Match
      const second = await GET(makeRequest({ 'if-none-match': etag }) as never);

      expect(second.status).toBe(304);
      expect(second.headers.get('etag')).toBe(etag);
      expect(second.headers.get('access-control-allow-origin')).toBe('*');
      expect(second.headers.get('cache-control')).toContain('max-age=300');
    });

    it('returns 304 for If-None-Match: *', async () => {
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const { GET } = await importRoute();

      // Prime the cache
      await GET(makeRequest() as never);

      const response = await GET(makeRequest({ 'if-none-match': '*' }) as never);

      expect(response.status).toBe(304);
    });

    it('returns 304 for comma-separated ETags', async () => {
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const { GET } = await importRoute();

      const first = await GET(makeRequest() as never);
      const etag = first.headers.get('etag')!;

      const response = await GET(
        makeRequest({ 'if-none-match': `"other-etag", ${etag}, "another"` }) as never
      );

      expect(response.status).toBe(304);
    });

    it('returns 304 for weak validator prefix', async () => {
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const { GET } = await importRoute();

      const first = await GET(makeRequest() as never);
      const etag = first.headers.get('etag')!;

      const response = await GET(
        makeRequest({ 'if-none-match': `W/${etag}` }) as never
      );

      expect(response.status).toBe(304);
    });

    it('returns 503 with CORS headers on error', async () => {
      mockGetPublicKeys.mockRejectedValue(new Error('upstream failure'));
      const { GET } = await importRoute();

      const response = await GET(makeRequest() as never);

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe('jwks_unavailable');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('retry-after')).toBe('60');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'jwks.wellknown.error',
        expect.objectContaining({ error: 'upstream failure' })
      );
    });
  });

  describe('caching', () => {
    it('serves from cache on second request without re-fetching', async () => {
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const { GET } = await importRoute();

      await GET(makeRequest() as never);
      expect(mockGetPublicKeys).toHaveBeenCalledTimes(1);

      await GET(makeRequest() as never);
      expect(mockGetPublicKeys).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after cache TTL expires', async () => {
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const { GET } = await importRoute();

      await GET(makeRequest() as never);
      expect(mockGetPublicKeys).toHaveBeenCalledTimes(1);

      // Advance past 5-minute TTL
      vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);

      await GET(makeRequest() as never);
      expect(mockGetPublicKeys).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent cold-miss requests into a single fetch', async () => {
      let resolveGetPublicKeys: (value: unknown[]) => void;
      mockGetPublicKeys.mockReturnValue(
        new Promise(resolve => { resolveGetPublicKeys = resolve; })
      );
      const { GET } = await importRoute();

      const req = makeRequest() as never;
      const p1 = GET(req);
      const p2 = GET(req);

      resolveGetPublicKeys!([makeKeyMetadata()]);
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockGetPublicKeys).toHaveBeenCalledTimes(1);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
    });

    it('falls back to stale cache when fresh fetch returns empty', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata({ keyId: 'good-key' })]);
      const { GET } = await importRoute();

      // Prime the cache
      const first = await GET(makeRequest() as never);
      const firstData = await first.json();
      expect(firstData.keys[0].kid).toBe('good-key');

      // Expire the cache
      vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);

      // Return empty keys
      mockGetPublicKeys.mockResolvedValue([]);

      const second = await GET(makeRequest() as never);
      const secondData = await second.json();

      expect(second.status).toBe(200);
      expect(secondData.keys[0].kid).toBe('good-key');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'jwks.wellknown.stale.fallback',
        expect.objectContaining({ cachedAt: expect.any(Number) })
      );
    });

    it('rate-limits upstream retries when serving stale cache', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const { GET } = await importRoute();

      // Prime cache
      await GET(makeRequest() as never);

      // Expire cache
      vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);

      // Empty result triggers stale fallback which updates cachedAt
      mockGetPublicKeys.mockResolvedValue([]);
      await GET(makeRequest() as never);
      expect(mockGetPublicKeys).toHaveBeenCalledTimes(2);

      // Next request should be within the refreshed TTL — no new fetch
      await GET(makeRequest() as never);
      expect(mockGetPublicKeys).toHaveBeenCalledTimes(2);
    });
  });

  describe('HEAD', () => {
    it('returns headers without body', async () => {
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const { HEAD } = await importRoute();

      const response = await HEAD(makeRequest() as never);

      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toMatch(/^"jwks-[a-f0-9]{12}"$/);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.text()).toBe('');
    });

    it('returns 304 when ETag matches', async () => {
      mockGetPublicKeys.mockResolvedValue([makeKeyMetadata()]);
      const { GET, HEAD } = await importRoute();

      const getResp = await GET(makeRequest() as never);
      const etag = getResp.headers.get('etag')!;

      const response = await HEAD(makeRequest({ 'if-none-match': etag }) as never);

      expect(response.status).toBe(304);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('returns 503 with CORS on error', async () => {
      mockGetPublicKeys.mockRejectedValue(new Error('fail'));
      const { HEAD } = await importRoute();

      const response = await HEAD(makeRequest() as never);

      expect(response.status).toBe(503);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('retry-after')).toBe('60');
    });
  });

  describe('OPTIONS', () => {
    it('returns CORS preflight headers', async () => {
      const { OPTIONS } = await importRoute();

      const response = await OPTIONS();

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-methods')).toContain('GET');
      expect(response.headers.get('content-length')).toBe('0');
    });
  });

  describe('key conversion errors', () => {
    it('skips keys that fail PEM conversion and logs error', async () => {
      mockGetPublicKeys.mockResolvedValue([
        makeKeyMetadata({ keyId: 'good-key' }),
        makeKeyMetadata({ keyId: 'bad-key', publicKey: 'not-a-pem' }),
      ]);
      const { GET } = await importRoute();

      const response = await GET(makeRequest() as never);
      const data = await response.json();

      expect(data.keys).toHaveLength(1);
      expect(data.keys[0].kid).toBe('good-key');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'jwks.wellknown.key.conversion.error',
        expect.objectContaining({ keyId: 'bad-key' })
      );
    });
  });
});
