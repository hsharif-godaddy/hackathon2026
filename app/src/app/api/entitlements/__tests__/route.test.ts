import { NextRequest } from 'next/server';
import { beforeEach,describe, expect, it, vi } from 'vitest';

const mockMgmtClient = {
  getEntitlements: vi.fn()
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

const mockAuthContext = {
  jwt: 'test-jwt',
  user: {
    customerId: 'customer-123',
    shopperId: 'shopper-123'
  }
};

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: NextRequest, ...rest: any[]) => handler(request, mockAuthContext, ...rest);
  }
}));

vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<any>('@/lib/mgmt-airo');
  return {
    ...actual,
    AiroMgmtClient: vi.fn().mockImplementation(() => mockMgmtClient)
  };
});

describe('/api/entitlements GET', function entitlementsGetRouteTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    mockAuthContext.user.customerId = 'customer-123';
  });

  it('denies access when subscription belongs to another customer', async function unauthorizedSubscription() {
    const { GET } = await import('../route');

    mockMgmtClient.getEntitlements.mockResolvedValue({
      id: 'sub-123',
      customerId: 'someone-else',
      entitlementId: 'ent-999'
    });

    const request = new NextRequest('http://localhost:3000/api/entitlements?subscriptionId=sub-123');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockMgmtClient.getEntitlements).toHaveBeenCalledWith('sub-123');
  });

  it('returns subscription data when customer owns the subscription', async function authorizedSubscription() {
    const { GET } = await import('../route');

    mockMgmtClient.getEntitlements.mockResolvedValue({
      id: 'sub-123',
      customerId: 'customer-123',
      entitlementId: 'ent-abc'
    });

    const request = new NextRequest('http://localhost:3000/api/entitlements?subscriptionId=sub-123');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.subscriptionId).toBe('sub-123');
    expect(body.data.subscription.entitlementId).toBe('ent-abc');
  });

  it('propagates mgmt 404 errors', async function handlesNotFound() {
    const { GET } = await import('../route');
    const { AiroHttpError } = await import('@/lib/mgmt-airo');

    mockMgmtClient.getEntitlements.mockRejectedValue(
      new AiroHttpError(404, 'Not Found', { message: 'missing' })
    );

    const request = new NextRequest('http://localhost:3000/api/entitlements?subscriptionId=sub-404');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Subscription not found');
  });
});
