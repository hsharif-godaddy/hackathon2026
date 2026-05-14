import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@airo/ai-lib', () => ({
  isS2SAuthEnabled: vi.fn(() => false),
  getS2SToken: vi.fn(),
  refreshS2SToken: vi.fn(),
}));

import { isS2SAuthEnabled, getS2SToken, refreshS2SToken } from '@airo/ai-lib';

import { BaseDriverV2, type BaseDriverV2Config } from '../base-driver-v2.js';

class TestDriver extends BaseDriverV2 {
  constructor(config: Partial<BaseDriverV2Config> = {}) {
    super({
      serviceName: 'test-driver',
      baseUrl: 'https://api.example.com',
      ...config,
    });
  }

  doGet(endpoint: string, params?: URLSearchParams, headers?: Record<string, string>) {
    return this.get(endpoint, params, headers);
  }

  doPost(endpoint: string, body: unknown, headers?: Record<string, string>) {
    return this.post(endpoint, body, headers);
  }

  doPut(endpoint: string, body: unknown, headers?: Record<string, string>) {
    return this.put(endpoint, body, headers);
  }

  doWithRetryOn401<T>(op: string, ctx: Record<string, unknown>, run: () => Promise<T>) {
    return this.withRetryOn401(op, ctx, run);
  }

  getDriverHeaders(additional?: Record<string, string>) {
    return this.getHeaders(additional);
  }

  checkHasAuth() {
    return this.hasAuth();
  }
}

function mockFetchResponse(status = 200, body: unknown = { ok: true }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

const savedEnv: Record<string, string | undefined> = {};
function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
}
function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('BaseDriverV2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv({ SSO_JWT: 'test-jwt-token' });
    vi.mocked(isS2SAuthEnabled).mockReturnValue(false);
  });

  afterEach(() => {
    restoreEnv();
  });

  describe('#constructor', () => {
    it('should initialize with mandatory baseUrl and serviceName', () => {
      const driver = new TestDriver({ baseUrl: 'https://custom.example.com' });

      expect(driver.apiBaseUrl).toBe('https://custom.example.com');
    });

    it('should resolve appKey from env var when appKeyEnvVar is provided', () => {
      setEnv({ MY_APP_KEY: 'custom-key' });
      const driver = new TestDriver({ appKeyEnvVar: 'MY_APP_KEY' });

      expect(driver.getDriverHeaders()['x-app-key']).toBe('custom-key');
    });

    it('should fall back to defaultAppKey when env var is not set', () => {
      const driver = new TestDriver({ appKeyEnvVar: 'NONEXISTENT_KEY', defaultAppKey: 'fallback-key' });

      expect(driver.getDriverHeaders()['x-app-key']).toBe('fallback-key');
    });

    it('should use airo-app-builder as final fallback for appKey', () => {
      const driver = new TestDriver();

      expect(driver.getDriverHeaders()['x-app-key']).toBe('airo-app-builder');
    });
  });

  describe('#hasAuth', () => {
    it('should return true when SSO_JWT is set', () => {
      expect(new TestDriver().checkHasAuth()).toBe(true);
    });

    it('should return true when S2S auth is enabled', () => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);

      expect(new TestDriver().checkHasAuth()).toBe(true);
    });

    it('should return false when neither SSO_JWT nor S2S is configured', () => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(false);

      expect(new TestDriver().checkHasAuth()).toBe(false);
    });
  });

  describe('#getHeaders', () => {
    it('should include Authorization with sso-jwt prefix', () => {
      const headers = new TestDriver().getDriverHeaders();

      expect(headers['Authorization']).toBe('sso-jwt test-jwt-token');
    });

    it('should include x-app-key and Accept headers', () => {
      const headers = new TestDriver().getDriverHeaders();

      expect(headers['x-app-key']).toBe('airo-app-builder');
      expect(headers['Accept']).toBe('application/json');
    });

    it('should allow overriding default headers via additionalHeaders', () => {
      const headers = new TestDriver().getDriverHeaders({ 'Accept': '*/*', 'X-Custom': 'val' });

      expect(headers['Accept']).toBe('*/*');
      expect(headers['X-Custom']).toBe('val');
    });
  });

  describe('#get', () => {
    it('should make a GET request to the correct URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());
      const driver = new TestDriver();

      await driver.doGet('/v1/resource');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/resource',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should append query params to the URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());
      const driver = new TestDriver();

      await driver.doGet('/v1/search', new URLSearchParams({ q: 'test' }));

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/search?q=test',
        expect.anything(),
      );
    });

    it('should pass additional headers', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());
      const driver = new TestDriver();

      await driver.doGet('/v1/resource', undefined, { 'User-Agent': 'test/1.0' });

      const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['User-Agent']).toBe('test/1.0');
    });
  });

  describe('#post', () => {
    it('should make a POST request with JSON body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());
      const driver = new TestDriver();

      await driver.doPost('/v1/resource', { name: 'test' });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/resource',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        }),
      );
      const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['Content-Type']).toBe('application/json');
    });
  });

  describe('#put', () => {
    it('should make a PUT request with JSON body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());
      const driver = new TestDriver();

      await driver.doPut('/v1/resource/1', { name: 'updated' });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/resource/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'updated' }),
        }),
      );
    });
  });

  describe('S2S auth', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
      vi.mocked(getS2SToken).mockResolvedValue('s2s-token-value');
    });

    it('should fetch S2S token on first request', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());
      const driver = new TestDriver();

      await driver.doGet('/v1/resource');

      expect(getS2SToken).toHaveBeenCalled();
    });

    it('should include S2S token in Authorization header', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());
      const driver = new TestDriver();

      await driver.doGet('/v1/resource');

      const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['Authorization']).toBe('sso-jwt s2s-token-value');
    });
  });

  describe('401 retry', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
      vi.mocked(getS2SToken).mockResolvedValue('initial-token');
      vi.mocked(refreshS2SToken).mockResolvedValue('refreshed-token');
    });

    it('should retry once with refreshed token on 401', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(401))
        .mockResolvedValueOnce(mockFetchResponse(200));

      const driver = new TestDriver();
      const response = await driver.doGet('/v1/protected');

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(refreshS2SToken).toHaveBeenCalled();
    });

    it('should not retry 401 when using local SSO_JWT (non-S2S)', async () => {
      vi.mocked(isS2SAuthEnabled).mockReturnValue(false);
      setEnv({ SSO_JWT: 'local-jwt' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(401));

      const driver = new TestDriver();
      const response = await driver.doGet('/v1/protected');

      expect(response.status).toBe(401);
      expect(refreshS2SToken).not.toHaveBeenCalled();
    });

    it('should use refreshed token headers on retry request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(401))
        .mockResolvedValueOnce(mockFetchResponse(200));

      const driver = new TestDriver();
      await driver.doGet('/v1/protected');

      const retryHeaders = fetchSpy.mock.calls[1][1]?.headers as Record<string, string>;
      expect(retryHeaders['Authorization']).toBe('sso-jwt refreshed-token');
    });
  });

  describe('#withRetryOn401', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
      vi.mocked(getS2SToken).mockResolvedValue('initial-token');
      vi.mocked(refreshS2SToken).mockResolvedValue('refreshed-token');
    });

    it('should return result on success', async () => {
      const driver = new TestDriver();
      const result = await driver.doWithRetryOn401('search', {}, async () => 'ok');

      expect(result).toBe('ok');
    });

    it('should retry on 401 error and return second attempt result', async () => {
      const driver = new TestDriver();
      let attempt = 0;

      const result = await driver.doWithRetryOn401('search', {}, async () => {
        attempt++;
        if (attempt === 1) throw Object.assign(new Error('401'), { response: { status: 401 } });
        return 'retried-ok';
      });

      expect(result).toBe('retried-ok');
      expect(refreshS2SToken).toHaveBeenCalled();
    });

    it('should rethrow non-401 errors without retry', async () => {
      const driver = new TestDriver();

      await expect(
        driver.doWithRetryOn401('search', {}, async () => {
          throw new Error('500 Server Error');
        }),
      ).rejects.toThrow('500 Server Error');

      expect(refreshS2SToken).not.toHaveBeenCalled();
    });
  });

  describe('401→401 exhaustion (executeWithRetry)', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
      vi.mocked(getS2SToken).mockResolvedValue('initial-token');
      vi.mocked(refreshS2SToken).mockResolvedValue('refreshed-token');
    });

    it('should return the 401 response verbatim after one retry — no third call', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(401))
        .mockResolvedValueOnce(mockFetchResponse(401));

      const driver = new TestDriver();
      const response = await driver.doGet('/v1/protected');

      expect(response.status).toBe(401);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(refreshS2SToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('withRetryOn401 exhaustion', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
      vi.mocked(getS2SToken).mockResolvedValue('initial-token');
      vi.mocked(refreshS2SToken).mockResolvedValue('refreshed-token');
    });

    it('should warn exhausted and invalidate token on second 401', async () => {
      const driver = new TestDriver();
      const warnSpy = vi.spyOn(driver['logger'], 'warn');

      await expect(
        driver.doWithRetryOn401('op', { key: 'val' }, async () => {
          throw Object.assign(new Error('401'), { response: { status: 401 } });
        }),
      ).rejects.toThrow('401');

      expect(refreshS2SToken).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'base-driver-v2.test-driver.op.reauth_retry.exhausted',
        expect.objectContaining({ key: 'val' }),
      );
    });
  });

  describe('concurrent 401 refresh deduplication', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
      vi.mocked(getS2SToken).mockResolvedValue('initial-token');
      vi.mocked(refreshS2SToken).mockResolvedValue('refreshed-token');
    });

    it('should call refreshS2SToken exactly once when two concurrent requests both 401', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(401))
        .mockResolvedValueOnce(mockFetchResponse(401))
        .mockResolvedValue(mockFetchResponse(200));

      const driver = new TestDriver();

      // First request triggers getS2SToken, then fetch → 401 → refreshS2SToken → retry
      // Start both before either completes the retry
      const p1 = driver.doGet('/v1/a');
      const p2 = driver.doGet('/v1/b');

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(refreshS2SToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('TOKEN_REFRESH_BUFFER_SECONDS boundary', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
    });

    it('should not refresh when token expires in 6 min (> 5 min buffer)', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const exp = nowSec + 360; // 6 minutes from now
      const tokenPayload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
      const token = `h.${tokenPayload}.s`;
      vi.mocked(getS2SToken).mockResolvedValue(token);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());
      const driver = new TestDriver();

      await driver.doGet('/v1/a');
      expect(getS2SToken).toHaveBeenCalledTimes(1);

      await driver.doGet('/v1/b');
      expect(getS2SToken).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should refresh when token expires in 4 min (< 5 min buffer)', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const exp = nowSec + 240; // 4 minutes from now
      const tokenPayload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
      const token = `h.${tokenPayload}.s`;
      vi.mocked(getS2SToken).mockResolvedValue(token);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());
      const driver = new TestDriver();

      await driver.doGet('/v1/a');
      expect(getS2SToken).toHaveBeenCalledTimes(1);

      await driver.doGet('/v1/b');
      // Second call should trigger another getS2SToken since token is within buffer
      expect(getS2SToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('ensureInitialized forceRefresh vs non-force mutex', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
    });

    it('should not let forceRefresh piggyback on a non-force in-flight promise', async () => {
      let resolveFirst!: (v: string) => void;
      vi.mocked(getS2SToken).mockImplementation(
        () => new Promise(r => { resolveFirst = r; }),
      );
      vi.mocked(refreshS2SToken).mockResolvedValue('force-refreshed-token');

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(401))
        .mockResolvedValue(mockFetchResponse(200));

      const driver = new TestDriver();

      // Start a normal request — getS2SToken hangs
      const p1 = driver.doGet('/v1/a');

      // Resolve the initial token, which will then 401 and trigger forceRefresh
      resolveFirst('initial-token');
      await p1;

      // refreshS2SToken should have been called (not coalesced with getS2SToken)
      expect(refreshS2SToken).toHaveBeenCalled();
    });
  });

  describe('initFailure caching', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
    });

    it('should cache and rethrow init failure on subsequent calls without re-fetching', async () => {
      vi.mocked(getS2SToken).mockRejectedValue(new Error('IAM unavailable'));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());

      const driver = new TestDriver();

      await expect(driver.doGet('/v1/resource')).rejects.toThrow('IAM unavailable');
      expect(getS2SToken).toHaveBeenCalledTimes(1);

      await expect(driver.doGet('/v1/resource')).rejects.toThrow('IAM unavailable');
      expect(getS2SToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrent token fetch', () => {
    beforeEach(() => {
      delete process.env.SSO_JWT;
      vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
    });

    it('should deduplicate concurrent getS2SToken calls', async () => {
      let resolveToken: (v: string) => void;
      vi.mocked(getS2SToken).mockImplementation(
        () => new Promise(r => { resolveToken = r; }),
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse());

      const driver = new TestDriver();
      const p1 = driver.doGet('/v1/a');
      const p2 = driver.doGet('/v1/b');

      resolveToken!('shared-token');
      await Promise.all([p1, p2]);

      expect(getS2SToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('network error logging', () => {
    it('should log structured network error and rethrow on fetch failure', async () => {
      const cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), {
        code: 'ENOTFOUND',
        errno: -3008,
      });
      const fetchError = Object.assign(new TypeError('fetch failed'), { cause });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(fetchError);

      const driver = new TestDriver();
      const errorSpy = vi.spyOn(driver['logger'], 'error');

      await expect(driver.doGet('/v1/resource')).rejects.toThrow('fetch failed');

      expect(errorSpy).toHaveBeenCalledWith(
        'base-driver-v2.test-driver.request.network_failed',
        expect.objectContaining({
          method: 'GET',
          errorName: 'TypeError',
          errorMessage: 'fetch failed',
          causeName: 'Error',
          causeMessage: 'getaddrinfo ENOTFOUND api.example.com',
          causeCode: 'ENOTFOUND',
        }),
      );
    });

    it('should log network error for POST requests', async () => {
      const cause = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause }),
      );

      const driver = new TestDriver();
      const errorSpy = vi.spyOn(driver['logger'], 'error');

      await expect(driver.doPost('/v1/resource', { data: 1 })).rejects.toThrow('fetch failed');

      expect(errorSpy).toHaveBeenCalledWith(
        'base-driver-v2.test-driver.request.network_failed',
        expect.objectContaining({
          method: 'POST',
          causeCode: 'ECONNREFUSED',
        }),
      );
    });

    it('should handle fetch errors without a cause property', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

      const driver = new TestDriver();
      const errorSpy = vi.spyOn(driver['logger'], 'error');

      await expect(driver.doGet('/v1/resource')).rejects.toThrow('fetch failed');

      expect(errorSpy).toHaveBeenCalledWith(
        'base-driver-v2.test-driver.request.network_failed',
        expect.objectContaining({
          errorName: 'TypeError',
          causeName: undefined,
          causeCode: undefined,
        }),
      );
    });
  });
});
