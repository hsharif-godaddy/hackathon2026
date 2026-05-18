import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the ai-lib S2S auth
vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getS2SToken: vi.fn().mockResolvedValue('mock-s2s-token'),
    isS2SAuthEnabled: vi.fn().mockReturnValue(true),
  };
});

// Mock logger so test output stays clean and we can spot-check log calls
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockFetch = vi.fn();

const TEST_BASE_URL = 'https://stripe-service.test.local';

describe('StripeService', () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    global.fetch = mockFetch;
    originalEnv = { ...process.env };
    process.env.STRIPE_SERVICE_API_URL = TEST_BASE_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    vi.resetModules();
  });

  describe('createSandbox', () => {
    it('POSTs /v1/sandboxes with bearer token, x-app-key, and the input body', async () => {
      const { stripeService } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            sandboxId: 'cbsbx_fake_X',
            accountId: 'acct_fake_X',
            claimUrl: 'https://example.com/fake-claim/cbsbx_fake_X',
          }),
      });

      const result = await stripeService.createSandbox({
        appId: 'app-1',
        email: 'a@b.c',
        country: 'US',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/v1/sandboxes`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: 'Bearer mock-s2s-token',
            'x-app-key': 'airo-app-builder',
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ appId: 'app-1', email: 'a@b.c', country: 'US' });

      expect(result).toEqual({
        sandboxId: 'cbsbx_fake_X',
        accountId: 'acct_fake_X',
        claimUrl: 'https://example.com/fake-claim/cbsbx_fake_X',
      });
    });

    it('returns the same shape on idempotent 200 (existing sandbox)', async () => {
      const { stripeService } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sandboxId: 'cbsbx_fake_existing',
            accountId: 'acct_fake_existing',
            claimUrl: 'https://example.com/fake-claim/cbsbx_fake_existing',
          }),
      });

      const result = await stripeService.createSandbox({
        appId: 'app-1',
        email: 'a@b.c',
        country: 'US',
      });

      expect(result.sandboxId).toBe('cbsbx_fake_existing');
    });

    it('throws StripeServiceError carrying status + code on 400 INVALID_JSON', async () => {
      const { stripeService, StripeServiceError } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ code: 'INVALID_JSON', error: 'request body is not valid JSON' })),
      });

      const promise = stripeService.createSandbox({ appId: 'app-1', email: 'a@b.c', country: 'US' });
      await expect(promise).rejects.toBeInstanceOf(StripeServiceError);
      await expect(promise).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_JSON',
      });
    });

    it('throws StripeServiceError on 500 STRIPE_CREATE_FAILED (preview-not-enabled passthrough)', async () => {
      const { stripeService, StripeServiceError } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () =>
          Promise.resolve(
            JSON.stringify({ code: 'STRIPE_CREATE_FAILED', error: 'failed to create Stripe sandbox' }),
          ),
      });

      const promise = stripeService.createSandbox({ appId: 'app-1', email: 'a@b.c', country: 'US' });
      await expect(promise).rejects.toBeInstanceOf(StripeServiceError);
      await expect(promise).rejects.toMatchObject({
        status: 500,
        code: 'STRIPE_CREATE_FAILED',
      });
    });

    it('falls back to UNKNOWN code when error body is non-JSON', async () => {
      const { stripeService, StripeServiceError } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => Promise.resolve('<html>Bad Gateway</html>'),
      });

      const promise = stripeService.createSandbox({ appId: 'app-1', email: 'a@b.c', country: 'US' });
      await expect(promise).rejects.toBeInstanceOf(StripeServiceError);
      await expect(promise).rejects.toMatchObject({
        status: 502,
        code: 'UNKNOWN',
        responseText: '<html>Bad Gateway</html>',
      });
    });
  });

  describe('getStatus', () => {
    it('GETs /v1/status?appId=X and returns the typed result', async () => {
      const { stripeService } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sandboxId: 'cbsbx_fake_X',
            claimStatus: 'provisioned',
          }),
      });

      const result = await stripeService.getStatus('app-1');

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/v1/status?appId=app-1`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-s2s-token',
            'x-app-key': 'airo-app-builder',
          }),
        }),
      );
      expect(result).toEqual({ sandboxId: 'cbsbx_fake_X', claimStatus: 'provisioned' });
    });

    it('passes through liveAccountId when present', async () => {
      const { stripeService } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sandboxId: 'cbsbx_fake_X',
            claimStatus: 'live',
            liveAccountId: 'acct_live_real',
          }),
      });

      const result = await stripeService.getStatus('app-1');
      expect(result?.liveAccountId).toBe('acct_live_real');
    });

    it('returns null on 404 NOT_FOUND (no sandbox for this appId)', async () => {
      const { stripeService } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify({ code: 'NOT_FOUND', error: 'no sandbox for this appId' })),
      });

      const result = await stripeService.getStatus('app-without-sandbox');
      expect(result).toBeNull();
    });

    it('throws StripeServiceError on 500 STORE_QUERY_FAILED', async () => {
      const { stripeService, StripeServiceError } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () =>
          Promise.resolve(JSON.stringify({ code: 'STORE_QUERY_FAILED', error: 'sandbox lookup failed' })),
      });

      const promise = stripeService.getStatus('app-1');
      await expect(promise).rejects.toBeInstanceOf(StripeServiceError);
      await expect(promise).rejects.toMatchObject({ status: 500, code: 'STORE_QUERY_FAILED' });
    });

    it('URL-encodes the appId query param', async () => {
      const { stripeService } = await import('../StripeService.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ sandboxId: 'cbsbx_fake_X', claimStatus: 'provisioned' }),
      });

      // appIds in this codebase are alphanumeric, but the encoder is the
      // safety net — defensively assert it runs.
      await stripeService.getStatus('a b/c');
      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/v1/status?appId=a%20b%2Fc`,
        expect.any(Object),
      );
    });
  });

  describe('URL fallback', () => {
    it('uses env-keyed default when STRIPE_SERVICE_API_URL is unset', async () => {
      // Production-path coverage: when the operator hasn't set
      // STRIPE_SERVICE_API_URL, the service falls back to the env-keyed
      // map driven by resolveEnv() (which sniffs GODADDY_API_BASE_URL).
      delete process.env.STRIPE_SERVICE_API_URL;
      process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com';

      const { stripeService } = await import('../StripeService.js');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ sandboxId: 'cbsbx_fake_X', claimStatus: 'provisioned' }),
      });

      await stripeService.getStatus('app-1');

      const calledUrl: string = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('dev-godaddy.com');
      expect(calledUrl).toContain('/v1/status');
    });
  });

  describe('error normalization', () => {
    it('propagates fetch DOMException timeouts as-is (preserves DOMException identity)', async () => {
      const { stripeService } = await import('../StripeService.js');

      // AbortSignal.timeout fires DOMException('TimeoutError') when the
      // signal trips. handleCatchError must propagate this unchanged so
      // upstream observers can tell timeouts apart from generic errors.
      const timeout = new DOMException('signal timed out', 'TimeoutError');
      mockFetch.mockRejectedValueOnce(timeout);

      await expect(
        stripeService.createSandbox({ appId: 'app-1', email: 'a@b.c', country: 'US' }),
      ).rejects.toBe(timeout);
    });

    it('propagates fetch AbortError as-is', async () => {
      const { stripeService } = await import('../StripeService.js');

      const abort = new DOMException('aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abort);

      await expect(stripeService.getStatus('app-1')).rejects.toBe(abort);
    });

    it('normalizes a non-Error rejection into an Error with cause', async () => {
      const { stripeService } = await import('../StripeService.js');

      // fetch can technically reject with a non-Error value (e.g. a string
      // from a misbehaving polyfill). handleCatchError should still
      // produce an Error so callers don't have to defensively check.
      mockFetch.mockRejectedValueOnce('plain string failure');

      await expect(
        stripeService.createSandbox({ appId: 'app-1', email: 'a@b.c', country: 'US' }),
      ).rejects.toThrow('plain string failure');
    });
  });

  describe('StripeServiceError', () => {
    it('truncates oversized responseText to MAX_RESPONSE_TEXT_LENGTH', async () => {
      const { stripeService, StripeServiceError } = await import('../StripeService.js');

      const huge = 'x'.repeat(StripeServiceError.MAX_RESPONSE_TEXT_LENGTH + 5000);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => Promise.resolve(huge),
      });

      try {
        await stripeService.createSandbox({ appId: 'app-1', email: 'a@b.c', country: 'US' });
        expect.fail('expected createSandbox to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(StripeServiceError);
        const sse = err as InstanceType<typeof StripeServiceError>;
        expect(sse.responseText.length).toBeLessThanOrEqual(
          StripeServiceError.MAX_RESPONSE_TEXT_LENGTH + '…[truncated]'.length,
        );
        expect(sse.responseText.endsWith('[truncated]')).toBe(true);
      }
    });

    it('does not truncate small responseText', async () => {
      const { stripeService, StripeServiceError } = await import('../StripeService.js');

      const small = JSON.stringify({ code: 'INVALID_JSON', error: 'bad body' });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(small),
      });

      try {
        await stripeService.createSandbox({ appId: 'app-1', email: 'a@b.c', country: 'US' });
        expect.fail('expected createSandbox to throw');
      } catch (err) {
        const sse = err as InstanceType<typeof StripeServiceError>;
        expect(sse.responseText).toBe(small);
      }
    });
  });
});
