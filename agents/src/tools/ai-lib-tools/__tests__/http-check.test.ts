import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const mockFetch = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

import { httpCheckAITool } from '../http-check.js';

const makeResponse = ({
  status = 200,
  contentType = 'application/json',
  body = '{}',
}: {
  status?: number;
  contentType?: string;
  body?: string;
} = {}): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string): string | null => (name === 'content-type' ? contentType : null) },
    text: async (): Promise<string> => body,
  }) as unknown as Response;

const makeContext = (appBaseUrl?: string): object => ({
  experimental_context: { metadata: appBaseUrl ? { appBaseUrl } : {} },
});

const execute = (
  input: {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
    body?: string;
    headers?: Record<string, string>;
    expectStatus?: number;
    expectContentType?: string;
    timeoutMs?: number;
  },
  appBaseUrl?: string
): Promise<unknown> =>
  httpCheckAITool.execute!(
    { method: 'GET', timeoutMs: 5000, expectContentType: 'application/json', ...input },
    makeContext(appBaseUrl) as never
  );

describe('httpCheckAITool', function httpCheckTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('URL resolution', function urlResolutionTests() {
    it('returns error when relative path is used without appBaseUrl', async function noBaseUrl() {
      const result = await execute({ url: '/api/health' });
      expect(result).toMatchObject({
        ok: false,
        status: 0,
        mismatchReason: expect.stringContaining('App base URL not available'),
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('resolves relative path against appBaseUrl', async function relativeResolution() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: '/api/health' }, 'http://127.0.0.1:8080');
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:8080/api/health', expect.anything());
    });

    it('preserves base URL query params when resolving relative paths', async function preservesBaseParams() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: '/api/health' }, 'http://127.0.0.1:8080?airoShareToken=abc123');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('airoShareToken=abc123');
      expect(calledUrl).toContain('/api/health');
    });

    it('merges input query params with base URL params', async function mergesParams() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: '/api/search?q=test' }, 'http://127.0.0.1:8080?airoShareToken=abc123');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('airoShareToken=abc123');
      expect(calledUrl).toContain('q=test');
    });

    it('uses absolute URL as-is', async function absoluteUrl() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'http://example.com/api' });
      expect(mockFetch).toHaveBeenCalledWith('http://example.com/api', expect.anything());
    });

    it('normalizes localhost hostname to 127.0.0.1', async function localhostNormalization() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'http://localhost:3000/api' });
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:3000/api', expect.anything());
    });

    it('does not normalize localhost.example.com', async function noSubdomainNormalization() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'https://localhost.example.com/api' });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe('https://localhost.example.com/api');
    });
  });

  describe('TLS skip agent', function tlsTests() {
    it('sets dispatcher for 127.0.0.1 HTTPS', async function tlsSkip127() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'https://127.0.0.1:8443/api' });
      expect(mockFetch.mock.calls[0][1].dispatcher).toBeDefined();
    });

    it('sets dispatcher for [::1] HTTPS', async function tlsSkipIpv6() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'https://[::1]:8443/api' });
      expect(mockFetch.mock.calls[0][1].dispatcher).toBeDefined();
    });

    it('sets dispatcher for *.dev-godaddy.com HTTPS', async function tlsSkipDevGodaddy() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'https://local.gasket.dev-godaddy.com:8443/api' });
      expect(mockFetch.mock.calls[0][1].dispatcher).toBeDefined();
    });

    it('sets dispatcher for *.local HTTPS', async function tlsSkipDotLocal() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'https://myapp.local/api' });
      expect(mockFetch.mock.calls[0][1].dispatcher).toBeDefined();
    });

    it('does not set dispatcher for external HTTPS', async function noTlsSkipExternal() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'https://api.example.com/health' });
      expect(mockFetch.mock.calls[0][1].dispatcher).toBeUndefined();
    });

    it('does not set dispatcher for plain HTTP on local host', async function noTlsSkipHttp() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'http://127.0.0.1:3000/api' });
      expect(mockFetch.mock.calls[0][1].dispatcher).toBeUndefined();
    });
  });

  describe('status matching', function statusTests() {
    it('returns ok:true for 2xx response', async function twoXxOk() {
      mockFetch.mockResolvedValue(makeResponse({ status: 200 }));
      const result = await execute({ url: 'http://127.0.0.1:3000/api' });
      expect(result).toMatchObject({ ok: true, status: 200 });
    });

    it('returns ok:false for non-2xx without expectStatus', async function nonTwoXxFail() {
      mockFetch.mockResolvedValue(makeResponse({ status: 404 }));
      const result = await execute({ url: 'http://127.0.0.1:3000/api' }) as Record<string, unknown>;
      expect(result).toMatchObject({ ok: false, status: 404 });
      expect(result.mismatchReason).toMatch(/404/);
    });

    it('returns ok:true when response status matches expectStatus', async function expectStatusMatch() {
      mockFetch.mockResolvedValue(makeResponse({ status: 404 }));
      const result = await execute({ url: 'http://127.0.0.1:3000/api', expectStatus: 404 }) as Record<string, unknown>;
      expect(result).toMatchObject({ ok: true, status: 404 });
      expect(result.mismatchReason).toBeUndefined();
    });

    it('returns ok:false with mismatchReason when expectStatus does not match', async function expectStatusMismatch() {
      mockFetch.mockResolvedValue(makeResponse({ status: 200 }));
      const result = await execute({ url: 'http://127.0.0.1:3000/api', expectStatus: 201 });
      expect(result).toMatchObject({ ok: false, mismatchReason: 'Expected status 201, got 200' });
    });
  });

  describe('HTML auto-fail', function htmlTests() {
    it('fails when response is HTML and no expectStatus is given', async function htmlAutoFail() {
      mockFetch.mockResolvedValue(makeResponse({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html></html>' }));
      const result = await execute({ url: 'http://127.0.0.1:3000/api' });
      expect(result).toMatchObject({ ok: false, mismatchReason: expect.stringContaining('text/html') });
    });

    it('does not auto-fail HTML when expectStatus and expectContentType are set', async function htmlExpectStatusOverride() {
      mockFetch.mockResolvedValue(makeResponse({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html></html>' }));
      const result = await execute({ url: 'http://127.0.0.1:3000/api', expectStatus: 200, expectContentType: 'text/html' });
      expect(result).toMatchObject({ ok: true, status: 200 });
    });
  });

  describe('request body', function bodyTests() {
    it('attaches body and injects content-type for POST', async function postBodyInjection() {
      mockFetch.mockResolvedValue(makeResponse({ status: 201 }));
      await execute({ url: 'http://127.0.0.1:3000/api', method: 'POST', body: '{"name":"test"}' });
      const opts = mockFetch.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
      expect(opts.body).toBe('{"name":"test"}');
      expect(opts.headers['content-type']).toBe('application/json');
    });

    it('preserves caller-provided Content-Type for PUT', async function putPreservesContentType() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'http://127.0.0.1:3000/api', method: 'PUT', body: 'text', headers: { 'Content-Type': 'text/plain' } });
      const opts = mockFetch.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
      expect(opts.headers['Content-Type']).toBe('text/plain');
      expect(opts.headers['content-type']).toBeUndefined();
    });

    it('does not attach body for GET even when body is provided', async function getIgnoresBody() {
      mockFetch.mockResolvedValue(makeResponse());
      await execute({ url: 'http://127.0.0.1:3000/api', method: 'GET', body: '{"ignored":true}' });
      expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
    });
  });

  describe('bodyTruncated', function bodyTruncatedTests() {
    it('sets bodyTruncated:false when body fits within 512 chars', async function notTruncated() {
      mockFetch.mockResolvedValue(makeResponse({ body: '{"ok":true}' }));
      const result = await execute({ url: 'http://127.0.0.1:3000/api' }) as Record<string, unknown>;
      expect(result.bodyTruncated).toBe(false);
      expect(result.bodyPreview).toBe('{"ok":true}');
    });

    it('sets bodyTruncated:true and clips bodyPreview when body exceeds 512 chars', async function truncated() {
      const longBody = 'x'.repeat(600);
      mockFetch.mockResolvedValue(makeResponse({ body: longBody }));
      const result = await execute({ url: 'http://127.0.0.1:3000/api' }) as Record<string, unknown>;
      expect(result.bodyTruncated).toBe(true);
      expect((result.bodyPreview as string).length).toBe(512);
    });
  });

  describe('HEAD method', function headTests() {
    it('skips body read for HEAD requests', async function headNoBody() {
      const mockText = vi.fn<() => Promise<string>>();
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: (): string => 'application/json' },
        text: mockText,
      });
      const result = await execute({ url: 'http://127.0.0.1:3000/api', method: 'HEAD' }) as Record<string, unknown>;
      expect(mockText).not.toHaveBeenCalled();
      expect(result.bodyPreview).toBe('');
    });
  });

  describe('error handling', function errorTests() {
    it('returns ok:false with error message on network failure', async function networkFailure() {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await execute({ url: 'http://127.0.0.1:3000/api' });
      expect(result).toMatchObject({ ok: false, status: 0, mismatchReason: 'ECONNREFUSED' });
    });

    it('reports timeout message when request is aborted by the timeout', async function timeoutAbort() {
      vi.useFakeTimers();
      mockFetch.mockImplementation(function (_url: string, opts: RequestInit) { return new Promise<Response>((_, reject) => {
          (opts.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        }); }
      );

      const resultPromise = execute({ url: 'http://127.0.0.1:3000/api', timeoutMs: 500 });
      await vi.advanceTimersByTimeAsync(600);
      const result = await resultPromise;

      expect(result).toMatchObject({ ok: false, status: 0, mismatchReason: 'Timed out after 500ms' });
      vi.useRealTimers();
    });
  });
});
