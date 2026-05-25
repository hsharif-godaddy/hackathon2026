import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DkimClient } from '../dkim-client';
import { DomainOrigin } from '../utils';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock cert token — returns a fixed service JWT
vi.mock('../dkim-cert-token', () => ({
  getDkimServiceToken: vi.fn().mockResolvedValue('service-cert-jwt'),
}));

// Capture logger calls so we can assert on what's logged (and what isn't —
// shopperId scrubbing is contract).
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DkimClient', () => {
  const baseUrl = 'https://dkim.int.dev-gdcorp.tools/v1';
  const shopperId = 'shopper-1';
  const domain = 'example.com';
  const executionArn = 'arn:aws:states:us-west-2:123:execution';

  beforeEach(() => {
    mockFetch.mockReset();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    process.env.VOX_DKIM_API_URL = baseUrl;
  });

  afterEach(() => {
    delete process.env.VOX_DKIM_API_URL;
  });

  describe('activateDkim', () => {
    it('calls POST /onboard with correct payload and headers', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ executionArn }));
      const client = new DkimClient(shopperId);
      const nextRotation = '2027-01-01T00:00:00.000Z';

      await client.activateDkim(domain, DomainOrigin.INTERNAL, nextRotation);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${baseUrl}/onboard`);
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('sso-jwt service-cert-jwt');
      expect(headers['X-App-Key']).toBe('airo-builder-bff');
      expect(headers['User-Agent']).toBe('airo-builder-bff');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-XSRF-TOKEN']).toBe('1');
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({
        domain,
        shopperId,
        nextRotation,
        domainOrigin: DomainOrigin.INTERNAL,
      });
    });

    it('returns executionArn on success', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ executionArn }));
      const client = new DkimClient(shopperId);
      const result = await client.activateDkim(domain, DomainOrigin.INTERNAL, '2027-01-01T00:00:00.000Z');
      expect(result.executionArn).toBe(executionArn);
    });

    it('throws on non-2xx response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
      const client = new DkimClient(shopperId);
      await expect(client.activateDkim(domain, DomainOrigin.INTERNAL, '2027-01-01T00:00:00.000Z'))
        .rejects.toThrow('403');
    });

    it('does NOT log shopperId or nextRotation on the request log line (PII scrub)', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ executionArn }));
      const client = new DkimClient(shopperId);
      const nextRotation = '2027-01-01T00:00:00.000Z';

      await client.activateDkim(domain, DomainOrigin.INTERNAL, nextRotation);

      // Find the `dkim.client.request` log call.
      const requestLog = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === 'dkim.client.request',
      );
      expect(requestLog).toBeDefined();
      const payload = requestLog![1] as Record<string, unknown>;

      // Operationally useful fields ARE logged.
      expect(payload.method).toBe('POST');
      expect(payload.url).toBe(`${baseUrl}/onboard`);
      expect(payload.domain).toBe(domain);
      expect(payload.domainOrigin).toBe(DomainOrigin.INTERNAL);

      // PII / sensitive fields are NOT.
      expect(payload).not.toHaveProperty('shopperId');
      expect(payload).not.toHaveProperty('nextRotation');
      expect(payload).not.toHaveProperty('requestBody'); // the old key
    });

    it('does NOT log shopperId on the failure log line either', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
      const client = new DkimClient(shopperId);

      await expect(
        client.activateDkim(domain, DomainOrigin.INTERNAL, '2027-01-01T00:00:00.000Z'),
      ).rejects.toThrow('403');

      const failLog = mockLogger.error.mock.calls.find(
        (call: unknown[]) => call[0] === 'dkim.client.request.failed',
      );
      expect(failLog).toBeDefined();
      const payload = failLog![1] as Record<string, unknown>;

      expect(payload.statusCode).toBe(403);
      expect(payload.domain).toBe(domain);
      expect(payload).not.toHaveProperty('shopperId');
      expect(payload).not.toHaveProperty('requestBody');
    });
  });

  describe('deactivateDkim', () => {
    it('calls POST /offboard with domain and shopperId', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ executionArn }));
      const client = new DkimClient(shopperId);

      await client.deactivateDkim(domain);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${baseUrl}/offboard`);
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ domain, shopperId });
    });

    it('returns executionArn on success', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ executionArn }));
      const client = new DkimClient(shopperId);
      const result = await client.deactivateDkim(domain);
      expect(result.executionArn).toBe(executionArn);
    });

    it('throws on non-2xx response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
      const client = new DkimClient(shopperId);
      await expect(client.deactivateDkim(domain)).rejects.toThrow('403');
    });
  });
});
