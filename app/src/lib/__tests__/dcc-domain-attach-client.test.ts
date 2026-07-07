import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainConnectSignatureError, generateDomainConnectSignature } from '../dcc-domain-attach-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('generateDomainConnectSignature', () => {
  const queryParams: Record<string, string> = {
    domain: 'example.com',
    redirect_uri: 'https://app.example.com/callback',
    state: 'state123',
    v1: '1.2.3.4',
    dcv: 'dcv123',
  };
  const customerJwt = 'customer-jwt-token';

  beforeEach(() => {
    mockFetch.mockReset();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    delete process.env.DCC_DOMAIN_ATTACH_API_URL;
    delete process.env.DCC_APP_KEY;
  });

  afterEach(() => {
    delete process.env.DCC_DOMAIN_ATTACH_API_URL;
    delete process.env.DCC_APP_KEY;
  });

  describe('success path', () => {
    it('calls the signature endpoint with correct payload and headers', async () => {
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ signature: 'sig-value', keyName: 'domain-attach.api.godaddy.com' }),
      );

      await generateDomainConnectSignature(queryParams, customerJwt);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1/domainConnect/generateSignature');
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`sso-jwt ${customerJwt}`);
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-App-Key']).toBe('airo-app-builder');
      expect(headers['X-Request-ID']).toBeDefined();

      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ query: queryParams });
    });

    it('returns the signature and keyName on success', async () => {
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ signature: 'sig-value', keyName: 'domain-attach.api.godaddy.com' }),
      );

      const result = await generateDomainConnectSignature(queryParams, customerJwt);

      expect(result.signature).toBe('sig-value');
      expect(result.keyName).toBe('domain-attach.api.godaddy.com');
    });

    it('sets an abort signal for the request timeout', async () => {
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ signature: 'sig', keyName: 'key' }),
      );

      await generateDomainConnectSignature(queryParams, customerJwt);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('uses DCC_APP_KEY env var when set', async () => {
      process.env.DCC_APP_KEY = 'custom-app-key';
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ signature: 'sig', keyName: 'key' }),
      );

      await generateDomainConnectSignature(queryParams, customerJwt);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-App-Key']).toBe('custom-app-key');
    });
  });

  describe('response validation', () => {
    it('throws when signature is missing', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ keyName: 'key' }));

      await expect(generateDomainConnectSignature(queryParams, customerJwt)).rejects.toThrow(
        DomainConnectSignatureError,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'dcc.generate_signature.invalid_response',
        expect.objectContaining({ hasSignature: false, hasKeyName: true }),
      );
    });

    it('throws when keyName is missing', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ signature: 'sig' }));

      await expect(generateDomainConnectSignature(queryParams, customerJwt)).rejects.toThrow(
        DomainConnectSignatureError,
      );
    });

    it('throws when signature is not a string', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ signature: 123, keyName: 'key' }));

      await expect(generateDomainConnectSignature(queryParams, customerJwt)).rejects.toThrow(
        DomainConnectSignatureError,
      );
    });

    it('throws when signature is an empty string', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ signature: '', keyName: 'key' }));

      await expect(generateDomainConnectSignature(queryParams, customerJwt)).rejects.toThrow(
        DomainConnectSignatureError,
      );
    });

    it('throws when response is null', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(null));

      await expect(generateDomainConnectSignature(queryParams, customerJwt)).rejects.toThrow(
        DomainConnectSignatureError,
      );
    });
  });

  describe('error handling', () => {
    it('throws with the error body message on non-ok HTTP response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'API_ERROR', message: 'signing failed' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(generateDomainConnectSignature(queryParams, customerJwt)).rejects.toThrow(
        'signing failed',
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'dcc.generate_signature.error',
        expect.objectContaining({ status: 502 }),
      );
    });

    it('falls back to HTTP status when error body is not JSON', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

      await expect(generateDomainConnectSignature(queryParams, customerJwt)).rejects.toThrow('HTTP 500');
    });

    it('wraps network errors with cause preservation', async () => {
      const networkError = new Error('network down');
      mockFetch.mockRejectedValueOnce(networkError);

      try {
        await generateDomainConnectSignature(queryParams, customerJwt);
        expect.fail('should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(DomainConnectSignatureError);
        expect((error as Error).message).toContain('network down');
        expect((error as Error).cause).toBe(networkError);
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        'dcc.generate_signature.exception',
        expect.objectContaining({ error: 'network down' }),
      );
    });

    it('does not re-log or re-wrap an already-logged HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));

      await expect(generateDomainConnectSignature(queryParams, customerJwt)).rejects.toThrow(
        DomainConnectSignatureError,
      );

      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'dcc.generate_signature.exception',
        expect.anything(),
      );
    });
  });

  describe('URL resolution', () => {
    it('uses the explicit DCC_DOMAIN_ATTACH_API_URL override when set', async () => {
      process.env.DCC_DOMAIN_ATTACH_API_URL = 'https://custom.example.com';
      mockFetch.mockResolvedValueOnce(makeOkResponse({ signature: 'sig', keyName: 'key' }));

      await generateDomainConnectSignature(queryParams, customerJwt);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://custom.example.com/v1/domainConnect/generateSignature');
    });

    it('uses the passed baseUrl parameter when provided', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ signature: 'sig', keyName: 'key' }));

      await generateDomainConnectSignature(queryParams, customerJwt, 'https://domain-attach.api.godaddy.com');

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://domain-attach.api.godaddy.com/v1/domainConnect/generateSignature');
    });

    it('defaults to the test host when neither baseUrl nor DCC_DOMAIN_ATTACH_API_URL is set', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ signature: 'sig', keyName: 'key' }));

      await generateDomainConnectSignature(queryParams, customerJwt);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('domain-attach.api.test-godaddy.com');
    });
  });
});
