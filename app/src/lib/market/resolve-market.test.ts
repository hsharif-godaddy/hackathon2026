import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/lib/request-context';
import { resolveMarketId } from './resolve-market';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFetchShopperMarketId = vi.fn();
vi.mock('@/lib/shopper/shopper-market', () => ({
  fetchShopperMarketId: (...args: unknown[]) => mockFetchShopperMarketId(...args),
}));

const mockGetVisitor = vi.fn();
vi.mock('../../../gasket', () => ({
  default: { actions: { getVisitor: (...args: unknown[]) => mockGetVisitor(...args) } },
}));

const fakeRequest = { headers: new Headers() } as unknown as NextRequest;

describe('resolveMarketId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses shopper market when it is non-en-US (regardless of visitor)', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce('en-IN');
    mockGetVisitor.mockResolvedValueOnce({ market: 'en-US' });

    const result = await resolveMarketId(fakeRequest, 'shopper-1', 'jwt');

    expect(result).toEqual({
      marketId: 'en-IN',
      shopperMarket: 'en-IN',
      visitorMarket: 'en-US',
      source: 'shopper-api',
    });
  });

  it('falls through to visitor market when shopper is en-US but visitor is not', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce('en-US');
    mockGetVisitor.mockResolvedValueOnce({ market: 'de-DE' });

    const result = await resolveMarketId(fakeRequest, 'shopper-1', 'jwt');

    expect(result.marketId).toBe('de-DE');
    expect(result.source).toBe('visitor-market');
  });

  it('uses visitor market when shopper is undefined and visitor is non-en-US', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce(undefined);
    mockGetVisitor.mockResolvedValueOnce({ market: 'fr-FR' });

    const result = await resolveMarketId(fakeRequest, 'shopper-1', 'jwt');

    expect(result.marketId).toBe('fr-FR');
    expect(result.source).toBe('visitor-market');
  });

  it('prefers shopper-api attribution when both signals are en-US', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce('en-US');
    mockGetVisitor.mockResolvedValueOnce({ market: 'en-US' });

    const result = await resolveMarketId(fakeRequest, 'shopper-1', 'jwt');

    expect(result).toEqual({
      marketId: 'en-US',
      shopperMarket: 'en-US',
      visitorMarket: 'en-US',
      source: 'shopper-api',
    });
  });

  it('falls back to visitor en-US when shopper is undefined', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce(undefined);
    mockGetVisitor.mockResolvedValueOnce({ market: 'en-US' });

    const result = await resolveMarketId(fakeRequest, 'shopper-1', 'jwt');

    expect(result.marketId).toBe('en-US');
    expect(result.source).toBe('visitor-market');
  });

  it('skips Shopper API when shopperId is undefined', async () => {
    mockGetVisitor.mockResolvedValueOnce({ market: 'en-IN' });

    const result = await resolveMarketId(fakeRequest, undefined, 'jwt');

    expect(mockFetchShopperMarketId).not.toHaveBeenCalled();
    expect(result).toEqual({
      marketId: 'en-IN',
      shopperMarket: undefined,
      visitorMarket: 'en-IN',
      source: 'visitor-market',
    });
  });

  it('returns en-US fallback when both signals are missing', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce(undefined);
    mockGetVisitor.mockResolvedValueOnce({ market: undefined });

    const result = await resolveMarketId(fakeRequest, 'shopper-1', 'jwt');

    expect(result).toEqual({
      marketId: 'en-US',
      shopperMarket: undefined,
      visitorMarket: undefined,
      source: 'fallback',
    });
  });

  it('passes request to gasket.getVisitor and request+shopperId+jwt to fetchShopperMarketId', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce('en-IN');
    mockGetVisitor.mockResolvedValueOnce({ market: 'en-US' });

    await resolveMarketId(fakeRequest, 'shopper-1', 'jwt-abc');

    expect(mockGetVisitor).toHaveBeenCalledWith(fakeRequest);
    expect(mockFetchShopperMarketId).toHaveBeenCalledWith(fakeRequest, 'shopper-1', 'jwt-abc');
  });

  it('falls back to shopper market when getVisitor throws', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce('en-IN');
    mockGetVisitor.mockRejectedValueOnce(new Error('visitor plugin boom'));

    const result = await resolveMarketId(fakeRequest, 'shopper-1', 'jwt');

    expect(result).toEqual({
      marketId: 'en-IN',
      shopperMarket: 'en-IN',
      visitorMarket: undefined,
      source: 'shopper-api',
    });
    expect(logger.warn).toHaveBeenCalledWith('market.resolve.visitor-failed', {
      error: 'visitor plugin boom',
    });
  });

  it('falls back to en-US when getVisitor throws and shopper is undefined', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce(undefined);
    mockGetVisitor.mockRejectedValueOnce(new Error('boom'));

    const result = await resolveMarketId(fakeRequest, 'shopper-1', 'jwt');

    expect(result).toEqual({
      marketId: 'en-US',
      shopperMarket: undefined,
      visitorMarket: undefined,
      source: 'fallback',
    });
  });

  it('logs a single market.resolve event with the resolution', async () => {
    mockFetchShopperMarketId.mockResolvedValueOnce('en-IN');
    mockGetVisitor.mockResolvedValueOnce({ market: 'en-US' });

    await resolveMarketId(fakeRequest, 'shopper-1', 'jwt');

    expect(logger.info).toHaveBeenCalledWith('market.resolve', {
      shopperMarket: 'en-IN',
      visitorMarket: 'en-US',
      marketId: 'en-IN',
      source: 'shopper-api',
    });
  });
});
