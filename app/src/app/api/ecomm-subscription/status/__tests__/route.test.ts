import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockAuthContext = {
  jwt: 'test-jwt-token',
  user: {
    customerId: 'customer-123',
    shopperId: 'shopper-123',
  },
};

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: (req: NextRequest, ctx: typeof mockAuthContext) => Promise<Response>) => {
    return async (request: NextRequest) => handler(request, mockAuthContext);
  },
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomainFromHeaders: () => 'test-godaddy.com',
}));

describe('/api/ecomm-subscription/status GET', function statusRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockAuthContext.jwt = 'test-jwt-token';
    mockAuthContext.user.customerId = 'customer-123';
  });

  afterEach(function cleanup() {
    vi.restoreAllMocks();
  });

  function createRequest(queryParams: Record<string, string> = {}): NextRequest {
    const url = new URL('http://localhost:3000/api/ecomm-subscription/status');
    Object.entries(queryParams).forEach(function addParam([key, value]) {
      url.searchParams.set(key, value);
    });
    return new NextRequest(url);
  }

  it('should return 401 when jwt is missing', async function noJwt() {
    mockAuthContext.jwt = '';

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication token required');
  });

  it('should return 400 when builderEntitlementId is missing', async function missingEntitlementId() {
    const { GET } = await import('../route');
    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('builderEntitlementId query parameter is required');
  });

  it('should successfully return subscription status', async function successfulStatus() {
    const subscriptionLookupResponse = {
      ok: true,
      json: async () => ({ subscriptionId: 'sub-456' }),
    };

    const subscriptionDetailsResponse = {
      ok: true,
      json: async () => ({
        offer: { autoRenew: true },
        paidThroughDate: '2027-01-29T07:00:00Z',
      }),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(subscriptionLookupResponse)
      .mockResolvedValueOnce(subscriptionDetailsResponse);

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      subscriptionId: 'sub-456',
      autoRenew: true,
      paidThroughDate: '2027-01-29T07:00:00Z',
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'ecomm-subscription.status.start',
      expect.objectContaining({
        customerId: 'customer-123',
        builderEntitlementId: 'ent-123',
      })
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      'ecomm-subscription.status.success',
      expect.objectContaining({
        customerId: 'customer-123',
        subscriptionId: 'sub-456',
        autoRenew: true,
        paidThroughDate: '2027-01-29T07:00:00Z',
      })
    );
  });

  it('should handle subscription lookup failure', async function lookupFailure() {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    });

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-notfound' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Failed to find subscription for entitlement');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.status.lookup-failed',
      expect.objectContaining({
        customerId: 'customer-123',
        builderEntitlementId: 'ent-notfound',
        status: 404,
      })
    );
  });

  it('should handle missing subscriptionId in lookup response', async function noSubscriptionId() {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-empty' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('No subscription found for entitlement');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.status.no-subscription-id',
      expect.objectContaining({
        customerId: 'customer-123',
        builderEntitlementId: 'ent-empty',
      })
    );
  });

  it('should handle subscription details fetch failure', async function detailsFailure() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscriptionId: 'sub-456' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal error',
      });

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to get subscription details');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.status.details-failed',
      expect.objectContaining({
        customerId: 'customer-123',
        subscriptionId: 'sub-456',
        status: 500,
      })
    );
  });

  it('should handle unexpected errors', async function unexpectedError() {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to get subscription status');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.status.error',
      expect.objectContaining({
        error: 'Network error',
      })
    );
  });

  it('should use correct subscriptions-shim URL for test environment', async function correctTestUrl() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscriptionId: 'sub-456' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          offer: { autoRenew: false },
          paidThroughDate: '2027-02-01T00:00:00Z',
        }),
      });

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123' });
    await GET(request);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('subscriptions-shim-ext.cp.api.test.godaddy.com'),
      expect.any(Object)
    );
  });

  it('should include correct headers in API calls', async function correctHeaders() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscriptionId: 'sub-456' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ offer: { autoRenew: true }, paidThroughDate: '2027-01-29T07:00:00Z' }),
      });

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123' });
    await GET(request);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Authorization': 'sso-jwt test-jwt-token',
          'Content-Type': 'application/json',
          'X-App-Key': 'airo-builder',
        }),
      })
    );
  });

  it('should return 500 when autoRenew is missing from subscription details', async function missingAutoRenew() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscriptionId: 'sub-456' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          offer: {},
          paidThroughDate: '2027-01-29T07:00:00Z',
        }),
      });

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Subscription details missing valid autoRenew flag');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.status.invalid-auto-renew',
      expect.objectContaining({
        customerId: 'customer-123',
        subscriptionId: 'sub-456',
        autoRenewValue: undefined,
      })
    );
  });

  it('should return 500 when autoRenew is not a boolean', async function nonBooleanAutoRenew() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscriptionId: 'sub-456' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          offer: { autoRenew: 'yes' },
          paidThroughDate: '2027-01-29T07:00:00Z',
        }),
      });

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Subscription details missing valid autoRenew flag');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.status.invalid-auto-renew',
      expect.objectContaining({
        customerId: 'customer-123',
        subscriptionId: 'sub-456',
        autoRenewValue: 'yes',
      })
    );
  });

  it('should return 500 when offer is missing from subscription details', async function missingOffer() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscriptionId: 'sub-456' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          paidThroughDate: '2027-01-29T07:00:00Z',
        }),
      });

    const { GET } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Subscription details missing valid autoRenew flag');
  });
});
