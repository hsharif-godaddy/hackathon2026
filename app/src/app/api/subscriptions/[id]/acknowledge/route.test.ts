import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
  return {
    ...actual,
    AiroMgmtClient: vi.fn(),
  };
});
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any, options: any) => {
    (handler as any).__authOptions = options;
    return handler;
  },
}));
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('POST /api/subscriptions/[id]/acknowledge', () => {
  let mockClient: any;
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockClient = {
      getSubscription: vi.fn(),
      acknowledgeConversion: vi.fn(),
    };

    const { AiroMgmtClient } = await import('@/lib/mgmt-airo');
    vi.mocked(AiroMgmtClient as any).mockImplementation(() => mockClient);

    const routeModule = await import('./route');
    POST = routeModule.POST;
  });

  const authContext = {
    jwt: 'test-jwt',
    user: { customerId: 'cust-123' },
  };

  const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

  const makeRequest = () =>
    new NextRequest('http://localhost/api/subscriptions/sub-1/acknowledge', {
      method: 'POST',
    });

  const makeSubscription = (overrides = {}) => ({
    id: 'sub-1',
    customerId: 'cust-123',
    attributes: [{ id: 'attr-1', key: 'free-plan', value: { orderId: 'order-1', conversionEventDate: null } }],
    ...overrides,
  });

  it('returns success for valid subscriptionId owned by user', async () => {
    const sub = makeSubscription();
    mockClient.getSubscription.mockResolvedValue(sub);
    mockClient.acknowledgeConversion.mockResolvedValue({
      id: 'attr-1', key: 'free-plan',
      value: { orderId: 'order-123', conversionEventDate: '2026-04-23T12:00:00Z' },
    });

    const response = await POST(makeRequest(), authContext, makeParams('sub-1'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockClient.getSubscription).toHaveBeenCalledWith('sub-1', { includeAttributes: true });
    expect(mockClient.acknowledgeConversion).toHaveBeenCalledWith(sub);
  });

  it('returns 403 when subscription belongs to different customer', async () => {
    mockClient.getSubscription.mockResolvedValue(makeSubscription({ customerId: 'other-customer' }));

    const response = await POST(makeRequest(), authContext, makeParams('sub-1'));

    expect(response.status).toBe(403);
    expect(mockClient.acknowledgeConversion).not.toHaveBeenCalled();
  });

  it('returns 500 when mgmt-airo fails with generic error', async () => {
    mockClient.getSubscription.mockResolvedValue(makeSubscription());
    mockClient.acknowledgeConversion.mockRejectedValue(new Error('mgmt-airo error'));

    const response = await POST(makeRequest(), authContext, makeParams('sub-1'));

    expect(response.status).toBe(500);
  });

  it('passes AiroHttpError status through to response', async () => {
    const { AiroHttpError } = await import('@/lib/mgmt-airo');
    mockClient.getSubscription.mockResolvedValue(makeSubscription());
    mockClient.acknowledgeConversion.mockRejectedValue(new AiroHttpError(404, 'Not Found', 'attribute not found'));

    const response = await POST(makeRequest(), authContext, makeParams('sub-1'));

    expect(response.status).toBe(404);
  });

  it('passes through getSubscription AiroHttpError status', async () => {
    const { AiroHttpError } = await import('@/lib/mgmt-airo');
    mockClient.getSubscription.mockRejectedValue(new AiroHttpError(404, 'Not Found', 'subscription not found'));

    const response = await POST(makeRequest(), authContext, makeParams('sub-1'));

    expect(response.status).toBe(404);
    expect(mockClient.acknowledgeConversion).not.toHaveBeenCalled();
  });

  it('returns 500 when getSubscription throws generic error', async () => {
    mockClient.getSubscription.mockRejectedValue(new Error('network failure'));

    const response = await POST(makeRequest(), authContext, makeParams('sub-1'));

    expect(response.status).toBe(500);
    expect(mockClient.acknowledgeConversion).not.toHaveBeenCalled();
  });

  it('returns 500 and logs non-Error thrown value', async () => {
    mockClient.getSubscription.mockResolvedValue(makeSubscription());
    mockClient.acknowledgeConversion.mockRejectedValue('string error');

    const response = await POST(makeRequest(), authContext, makeParams('sub-1'));
    const { logger } = await import('@/lib/request-context');

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('subscription.acknowledge.error', expect.objectContaining({
      error: 'Unknown error',
    }));
  });

  it('uses fallback base URL when MGMT_AIRO_BASE_URL is not set', async () => {
    const original = process.env.MGMT_AIRO_BASE_URL;
    delete process.env.MGMT_AIRO_BASE_URL;
    try {
      const sub = makeSubscription();
      mockClient.getSubscription.mockResolvedValue(sub);
      mockClient.acknowledgeConversion.mockResolvedValue({ id: 'attr-1' });

      const response = await POST(makeRequest(), authContext, makeParams('sub-1'));

      expect(response.status).toBe(200);
    } finally {
      if (original !== undefined) {
        process.env.MGMT_AIRO_BASE_URL = original;
      }
    }
  });

  it('returns 400 when subscriptionId is empty', async () => {
    const response = await POST(makeRequest(), authContext, makeParams(''));

    expect(response.status).toBe(400);
    expect(mockClient.getSubscription).not.toHaveBeenCalled();
  });

  it('uses default auth (not level 3)', async () => {
    expect((POST as any).__authOptions).toBeUndefined();
  });
});
