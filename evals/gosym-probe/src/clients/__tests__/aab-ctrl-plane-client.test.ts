import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { AABCtrlPlaneClient } from '../aab-ctrl-plane-client.js';

const BASE_URL = 'http://localhost:4100';

function makeClient(overrides?: {
  provisionTimeoutMs?: number;
  pollIntervalMs?: number;
}) {
  return new AABCtrlPlaneClient({
    baseUrl: BASE_URL,
    pollIntervalMs: 0,
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

    it('throws when poll returns non-ok response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ statusJobId: 'job-1' }),
        })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(client.provisionApp()).rejects.toThrow(
        /poll.*500/i,
      );
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
});
