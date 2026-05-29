import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/lib/request-context';
import { resolveMarketId } from './resolve-market';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

  it('uses visitor.market when it is non-en-US', async () => {
    mockGetVisitor.mockResolvedValueOnce({ market: 'en-IN' });

    const result = await resolveMarketId(fakeRequest);

    expect(result).toEqual({
      marketId: 'en-IN',
      visitorMarket: 'en-IN',
      source: 'visitor-market',
    });
  });

  it('returns en-US with source=visitor-market when visitor.market is en-US', async () => {
    mockGetVisitor.mockResolvedValueOnce({ market: 'en-US' });

    const result = await resolveMarketId(fakeRequest);

    expect(result).toEqual({
      marketId: 'en-US',
      visitorMarket: 'en-US',
      source: 'visitor-market',
    });
  });

  it('returns en-US fallback when visitor.market is undefined', async () => {
    mockGetVisitor.mockResolvedValueOnce({ market: undefined });

    const result = await resolveMarketId(fakeRequest);

    expect(result).toEqual({
      marketId: 'en-US',
      visitorMarket: undefined,
      source: 'fallback',
    });
  });

  it('falls back to en-US and warns when getVisitor throws', async () => {
    mockGetVisitor.mockRejectedValueOnce(new Error('visitor plugin boom'));

    const result = await resolveMarketId(fakeRequest);

    expect(result).toEqual({
      marketId: 'en-US',
      visitorMarket: undefined,
      source: 'fallback',
    });
    expect(logger.warn).toHaveBeenCalledWith('market.resolve.visitor-failed', {
      error: 'visitor plugin boom',
    });
  });

  it('passes request to gasket.actions.getVisitor', async () => {
    mockGetVisitor.mockResolvedValueOnce({ market: 'en-IN' });

    await resolveMarketId(fakeRequest);

    expect(mockGetVisitor).toHaveBeenCalledWith(fakeRequest);
  });

  it('logs a single market.resolve event with the resolution', async () => {
    mockGetVisitor.mockResolvedValueOnce({ market: 'de-DE' });

    await resolveMarketId(fakeRequest);

    expect(logger.info).toHaveBeenCalledWith('market.resolve', {
      marketId: 'de-DE',
      visitorMarket: 'de-DE',
      source: 'visitor-market',
    });
  });
});
