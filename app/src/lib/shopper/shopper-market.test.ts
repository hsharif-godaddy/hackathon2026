import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/lib/request-context';
import { fetchShopperMarketId } from './shopper-market';

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/getServerRootDomain', () => ({
  getApiBaseUrl: vi.fn((_req: NextRequest, subdomain: string) => `https://${subdomain}.test-godaddy.com`),
}));

const fakeRequest = { headers: new Headers() } as unknown as NextRequest;

describe('fetchShopperMarketId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns marketId on a successful response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shopperId: '7s0', marketId: 'en-IN', email: 'x@y.com' }),
    });

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBe('en-IN');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test-godaddy.com/v1/shoppers/7s0',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'sso-jwt jwt-abc',
        }),
      }),
    );
  });

  it('returns undefined when marketId is missing from the response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shopperId: '7s0', email: 'x@y.com' }),
    });

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBeUndefined();
  });

  it('normalizes empty marketId to undefined and warns', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shopperId: '7s0', marketId: '', email: 'x@y.com' }),
    });

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'shopper-market.fetch.empty-marketId',
      expect.any(Object),
    );
  });

  it('normalizes whitespace-only marketId to undefined and warns', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shopperId: '7s0', marketId: '   ', email: 'x@y.com' }),
    });

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'shopper-market.fetch.empty-marketId',
      expect.any(Object),
    );
  });

  it('trims surrounding whitespace from marketId', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shopperId: '7s0', marketId: '  en-IN  ' }),
    });

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBe('en-IN');
  });

  it('URL-encodes the shopperId path segment', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shopperId: 'a/b c', marketId: 'en-US' }),
    });

    await fetchShopperMarketId(fakeRequest, 'a/b c', 'jwt-abc');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test-godaddy.com/v1/shoppers/a%2Fb%20c',
      expect.any(Object),
    );
  });

  it('logs 4xx auth failures (401/403) at error level', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'shopper-market.fetch.http-error',
      expect.objectContaining({ status: 403 }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      'shopper-market.fetch.http-error',
      expect.anything(),
    );
  });

  it('logs non-auth HTTP failures (5xx) at warn level', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'shopper-market.fetch.http-error',
      expect.objectContaining({ status: 503 }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('returns undefined when fetch throws (network error)', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('boom'));

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBeUndefined();
  });

  it('returns undefined when fetch is aborted by timeout (TimeoutError)', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'TimeoutError';
    global.fetch = vi.fn().mockRejectedValueOnce(abortError);

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'shopper-market.fetch.failed',
      expect.objectContaining({ reason: 'timeout' }),
    );
  });

  it('returns undefined when fetch is aborted (AbortError)', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    global.fetch = vi.fn().mockRejectedValueOnce(abortError);

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'shopper-market.fetch.failed',
      expect.objectContaining({ reason: 'timeout' }),
    );
  });

  it('returns undefined and logs reason:parse-error when JSON parsing fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const result = await fetchShopperMarketId(fakeRequest, '7s0', 'jwt-abc');

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'shopper-market.fetch.failed',
      expect.objectContaining({ reason: 'parse-error' }),
    );
  });
});
