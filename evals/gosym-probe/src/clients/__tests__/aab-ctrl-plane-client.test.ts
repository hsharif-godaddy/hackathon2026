import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { AABCtrlPlaneClient } from '../aab-ctrl-plane-client.js';

const BASE_URL = 'http://localhost:4100';

function makeClient(overrides?: {
  provisionTimeoutMs?: number;
  pollIntervalMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
}) {
  return new AABCtrlPlaneClient({
    baseUrl: BASE_URL,
    pollIntervalMs: 0,
    retryDelayMs: 0,
    maxRetries: 0,
    ...overrides,
  });
}

function makeRetryClient(overrides?: {
  pollIntervalMs?: number;
}) {
  return new AABCtrlPlaneClient({
    baseUrl: BASE_URL,
    pollIntervalMs: 0,
    retryDelayMs: 0,
    maxRetries: 3,
    ...overrides,
  });
}

describe('AABCtrlPlaneClient', () => {
  let client: AABCtrlPlaneClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = makeClient();
  });

  describe('provisionApp()', () => {
    it('POSTs to /api/airo/v1/signup with empty body', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{
              id: 'app-1',
              urls: { preview: 'http://p', agent: 'http://a' },
            }],
          }),
        });

      await client.provisionApp();

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/airo/v1/signup`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );
    });

    it('returns appId and previewUrl from completed response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{
              id: 'app-xyz',
              urls: {
                preview: 'http://localhost:5100',
                agent: 'http://localhost:4000',
              },
            }],
          }),
        });

      const result = await client.provisionApp();

      expect(result).toEqual({
        appId: 'app-xyz',
        previewUrl: 'http://localhost:5100',
      });
    });

    it('GETs the correct poll URL with jobId', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-abc' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{
              id: 'app-1',
              urls: { preview: 'http://p', agent: 'http://a' },
            }],
          }),
        });

      await client.provisionApp();

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/airo/v1/jobs/job-abc/apps`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('retries on pending status until completed', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue(
            { status: 'pending', apps: [] },
          ),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue(
            { status: 'pending', apps: [] },
          ),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{
              id: 'app-1',
              urls: { preview: 'http://p', agent: 'http://a' },
            }],
          }),
        });

      const result = await client.provisionApp();

      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(result.appId).toBe('app-1');
    });

    it('retries on running status until completed', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue(
            { status: 'running', apps: [] },
          ),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{
              id: 'app-1',
              urls: { preview: 'http://p', agent: 'http://a' },
            }],
          }),
        });

      const result = await client.provisionApp();

      expect(result.appId).toBe('app-1');
    });

    it('throws on failed status with error message', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'failed',
            error: 'Docker pull failed',
            apps: [],
          }),
        });

      await expect(client.provisionApp()).rejects.toThrow(
        /provisioning failed.*docker pull failed/i,
      );
    });

    it('throws on timeout after exhausting the deadline', async () => {
      const nowSpy = vi.spyOn(Date, 'now')
        .mockReturnValueOnce(0)      // deadline = 0 + 1000
        .mockReturnValueOnce(500)    // first while check: 500 < 1000
        .mockReturnValue(2_000);     // second check: 2000 < 1000 → exit

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue(
            { status: 'pending', apps: [] },
          ),
        });

      const timedOut = makeClient({
        provisionTimeoutMs: 1_000,
        pollIntervalMs: 0,
      });

      await expect(timedOut.provisionApp()).rejects.toThrow(
        /timed out/i,
      );
      nowSpy.mockRestore();
    });

    it('throws when signup returns non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503 });

      await expect(client.provisionApp()).rejects.toThrow(
        /signup.*503/i,
      );
    });

    it('recovers from transient poll HTTP error internally', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{ id: 'app-1', urls: { preview: 'http://p', agent: 'http://a' } }],
          }),
        });

      const result = await client.provisionApp();

      expect(result.appId).toBe('app-1');
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('transient HTTP 500'),
      );
      warnSpy.mockRestore();
    });

    it('throws non-retryable after consecutive poll HTTP errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValue({ ok: false, status: 500 });

      const err = await client.provisionApp().catch((e: unknown) => e) as Error & { statusCode?: number; jobId?: string };
      expect(err.message).toMatch(/poll.*consecutive.*http/i);
      expect(err.statusCode).toBe(500);
      expect(err.jobId).toBe('job-1');
      warnSpy.mockRestore();
    });

    it('throws when completed but apps array is empty', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue(
            { status: 'completed', apps: [] },
          ),
        });

      await expect(client.provisionApp()).rejects.toThrow(
        /no app/i,
      );
    });

    it('passes an AbortSignal to each fetch call', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{
              id: 'app-1',
              urls: { preview: 'http://p', agent: 'http://a' },
            }],
          }),
        });

      await client.provisionApp();

      for (const [, options] of mockFetch.mock.calls) {
        expect(options).toMatchObject({ signal: expect.any(AbortSignal) });
      }
    });

    it('throws a descriptive error when poll response has unexpected shape', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ unexpected: true }),
        });

      await expect(client.provisionApp()).rejects.toThrow();
    });
  });

  describe('provisionApp() — retry behavior', () => {
    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('retries on transient signup failure and succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{ id: 'app-1', urls: { preview: 'http://p', agent: 'http://a' } }],
          }),
        });

      const result = await makeRetryClient().provisionApp();

      expect(result.appId).toBe('app-1');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('does not re-signup on transient poll HTTP error (handles internally)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{ id: 'app-1', urls: { preview: 'http://p', agent: 'http://a' } }],
          }),
        });

      const result = await makeRetryClient().provisionApp();

      expect(result.appId).toBe('app-1');
      expect(mockFetch).toHaveBeenCalledTimes(3);
      const signupCalls = mockFetch.mock.calls.filter(
        ([url]) => String(url).includes('/signup'),
      );
      expect(signupCalls).toHaveLength(1);
    });

    it('throws after exhausting all 3 retries', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503 });

      await expect(makeRetryClient().provisionApp()).rejects.toThrow(
        /signup.*503/i,
      );
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('does not retry on explicit provisioning failure (status: failed)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'failed',
            error: 'Docker pull failed',
            apps: [],
          }),
        });

      await expect(makeRetryClient().provisionApp()).rejects.toThrow(
        /provisioning failed.*docker pull failed/i,
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry signup when poll times out', async () => {
      const nowSpy = vi.spyOn(Date, 'now')
        .mockReturnValueOnce(0)      // deadline = 0 + 120_000
        .mockReturnValueOnce(500)    // first while check: passes
        .mockReturnValue(200_000);   // second check: exceeds deadline

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'pending', apps: [] }),
        });

      await expect(makeRetryClient().provisionApp()).rejects.toThrow(
        /timed out/i,
      );

      const signupCalls = mockFetch.mock.calls.filter(
        ([url]) => String(url).includes('/signup'),
      );
      expect(signupCalls).toHaveLength(1);
      nowSpy.mockRestore();
    });
  });

  describe('pollUntilComplete — transient error handling', () => {
    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('recovers from ZodError (malformed poll shape) and completes', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        // First poll: valid HTTP but malformed shape → ZodError
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ unexpected: true }),
        })
        // Second poll: success
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{ id: 'app-1', urls: { preview: 'http://p', agent: 'http://a' } }],
          }),
        });

      const result = await client.provisionApp();

      expect(result.appId).toBe('app-1');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('transient error'),
      );
      warnSpy.mockRestore();
    });

    it('throws NonRetryableProvisionError after repeated ZodErrors exceed threshold', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        // 4 consecutive ZodErrors (threshold is 3)
        .mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ unexpected: true }),
        });

      const err = await client.provisionApp().catch((e: unknown) => e) as Error & { jobId?: string };
      expect(err.message).toMatch(/consecutive errors/i);
      expect(err.jobId).toBe('job-1');
      warnSpy.mockRestore();
    });

    it('recovers from SyntaxError (invalid JSON body) and completes', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        // First poll: response.json() throws SyntaxError
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
        })
        // Second poll: success
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{ id: 'app-1', urls: { preview: 'http://p', agent: 'http://a' } }],
          }),
        });

      const result = await client.provisionApp();

      expect(result.appId).toBe('app-1');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('transient error'),
      );
      warnSpy.mockRestore();
    });

    it('recovers from AbortError (per-request timeout) and completes', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
      const abortError = new DOMException('signal timed out', 'AbortError');

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        // First poll: fetch rejects with AbortError
        .mockRejectedValueOnce(abortError)
        // Second poll: success
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{ id: 'app-1', urls: { preview: 'http://p', agent: 'http://a' } }],
          }),
        });

      const result = await client.provisionApp();

      expect(result.appId).toBe('app-1');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('transient error'),
      );
      warnSpy.mockRestore();
    });

    it('recovers from network TypeError (DNS/ECONNRESET) and completes', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        // First poll: fetch rejects with network TypeError
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        // Second poll: success
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{ id: 'app-1', urls: { preview: 'http://p', agent: 'http://a' } }],
          }),
        });

      const result = await client.provisionApp();

      expect(result.appId).toBe('app-1');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('transient error'),
      );
      warnSpy.mockRestore();
    });

    it('does not re-signup when poll errors are transient', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: 'completed',
            apps: [{ id: 'app-1', urls: { preview: 'http://p', agent: 'http://a' } }],
          }),
        });

      await makeRetryClient().provisionApp();

      const signupCalls = mockFetch.mock.calls.filter(
        ([url]) => String(url).includes('/signup'),
      );
      expect(signupCalls).toHaveLength(1);
      warnSpy.mockRestore();
    });
  });

  describe('deleteApp()', () => {
    it('DELETEs with local-sub-001/local-sys-001 path', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await client.deleteApp('app-abc');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/airo/v1/subscriptions` +
        `/local-sub-001/systems/local-sys-001/apps/app-abc`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('resolves silently on 404 (already deleted)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await expect(client.deleteApp('app-abc')).resolves.toBeUndefined();
    });

    it('throws on server error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(client.deleteApp('app-abc')).rejects.toThrow(
        /delete app.*app-abc.*500/i,
      );
    });
  });

  describe('resetApp()', () => {
    it('resolves on a 200 with restarted:true and ready:true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, restarted: true, ready: true }),
      });
      await expect(
        client.resetApp('app-1', { commit: 'abc', restart: true }),
      ).resolves.toBeUndefined();
    });

    it('throws on a requested restart that failed (restarted:false)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, restarted: false, restartError: 'boom' }),
      });
      await expect(client.resetApp('app-1')).rejects.toThrow(/degraded.*boom/i);
    });

    it('throws when restarted but the preview never became ready (ready:false)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          restarted: true,
          ready: false,
          readyError: 'preview health check timed out',
        }),
      });
      await expect(client.resetApp('app-1')).rejects.toThrow(
        /did not become ready.*no-op.*timed out/i,
      );
    });

    it('throws when ready is absent on a requested restart', async () => {
      // A restarted:true body that omits `ready` cannot confirm the preview is
      // serving — fail loud rather than let a no-op trial through.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, restarted: true }),
      });
      await expect(client.resetApp('app-1')).rejects.toThrow(
        /did not become ready.*unknown error/i,
      );
    });

    it('does not flag degraded when restart was not requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, restarted: false, ready: false }),
      });
      await expect(
        client.resetApp('app-1', { restart: false }),
      ).resolves.toBeUndefined();
    });

    it('throws when a restart was requested but the body is malformed', async () => {
      // A 200 whose body we cannot parse (or that omits `restarted`) leaves us
      // unable to confirm the restart succeeded — that is itself a degraded
      // signal, so we must fail loud rather than skip the check.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('not json');
        },
      });
      await expect(client.resetApp('app-1')).rejects.toThrow(
        /degraded.*missing or malformed/i,
      );
    });

    it('throws when restarted is absent on a requested restart', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      await expect(client.resetApp('app-1')).rejects.toThrow(
        /degraded.*unknown error/i,
      );
    });

    it('throws on a non-ok HTTP status', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
      await expect(client.resetApp('app-1')).rejects.toThrow(/reset app.*app-1.*500/i);
    });
  });

});
