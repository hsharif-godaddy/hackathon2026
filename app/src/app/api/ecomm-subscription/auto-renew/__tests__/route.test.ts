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

describe('/api/ecomm-subscription/auto-renew POST', function autoRenewRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockAuthContext.jwt = 'test-jwt-token';
    mockAuthContext.user.customerId = 'customer-123';
  });

  afterEach(function cleanup() {
    vi.restoreAllMocks();
  });

  function createRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost:3000/api/ecomm-subscription/auto-renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('should return 401 when jwt is missing', async function noJwt() {
    mockAuthContext.jwt = '';

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123', autoRenew: false });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication token required');
  });

  it('should return 400 when builderEntitlementId is missing', async function missingEntitlementId() {
    const { POST } = await import('../route');
    const request = createRequest({ autoRenew: false });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('builderEntitlementId is required');
  });

  it('should return 400 when autoRenew is not a boolean', async function invalidAutoRenew() {
    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123', autoRenew: 'false' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('autoRenew must be a boolean');
  });

  it('should successfully set autoRenew to false', async function setAutoRenewFalse() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          subscriptionId: 'sub-456',
          metadata: { revision: 'rev-123' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123', autoRenew: false });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'ecomm-subscription.auto-renew.start',
      expect.objectContaining({
        customerId: 'customer-123',
        builderEntitlementId: 'ent-123',
        autoRenew: false,
      })
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      'ecomm-subscription.auto-renew.success',
      expect.objectContaining({
        customerId: 'customer-123',
        subscriptionId: 'sub-456',
      })
    );
  });

  it('should successfully set autoRenew to true', async function setAutoRenewTrue() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          subscriptionId: 'sub-456',
          metadata: { revision: 'rev-456' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123', autoRenew: true });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should handle subscription lookup failure', async function lookupFailure() {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    });

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-notfound', autoRenew: false });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Failed to find subscription for entitlement');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.auto-renew.lookup-failed',
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
      json: async () => ({ metadata: { revision: 'rev-123' } }),
    });

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-empty', autoRenew: false });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('No subscription found for entitlement');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.auto-renew.no-subscription-id',
      expect.objectContaining({
        customerId: 'customer-123',
        builderEntitlementId: 'ent-empty',
      })
    );
  });

  it('should handle missing revision in lookup response', async function noRevision() {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ subscriptionId: 'sub-456' }),
    });

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-no-rev', autoRenew: false });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('No revision found for subscription');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.auto-renew.no-revision',
      expect.objectContaining({
        customerId: 'customer-123',
        builderEntitlementId: 'ent-no-rev',
        subscriptionId: 'sub-456',
      })
    );
  });

  it('should handle autoRenew update failure', async function updateFailure() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          subscriptionId: 'sub-456',
          metadata: { revision: 'rev-123' },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => 'Conflict',
      });

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123', autoRenew: false });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Failed to update auto-renew status');
    expect(body.details).toBe('Conflict');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.auto-renew.update-failed',
      expect.objectContaining({
        customerId: 'customer-123',
        subscriptionId: 'sub-456',
        autoRenew: false,
        status: 409,
      })
    );
  });

  it('should handle unexpected errors', async function unexpectedError() {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123', autoRenew: false });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to update auto-renew status');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'ecomm-subscription.auto-renew.error',
      expect.objectContaining({
        error: 'Network error',
      })
    );
  });

  it('should include correct headers in autoRenew update call', async function correctHeaders() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          subscriptionId: 'sub-456',
          metadata: { revision: 'rev-789' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123', autoRenew: false });
    await POST(request);

    // Second call should be the autoRenew update
    const secondCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[1].headers).toMatchObject({
      'Authorization': 'sso-jwt test-jwt-token',
      'Content-Type': 'application/json',
      'X-App-Key': 'airo-builder',
      'If-Match': 'rev-789',
    });
    expect(secondCall[1].headers['Idempotent-Id']).toBeDefined();
    expect(secondCall[1].body).toBe(JSON.stringify({ autoRenew: false }));
  });

  it('should use correct subscriptions-shim URLs', async function correctUrls() {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          subscriptionId: 'sub-456',
          metadata: { revision: 'rev-123' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    const { POST } = await import('../route');
    const request = createRequest({ builderEntitlementId: 'ent-123', autoRenew: false });
    await POST(request);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;

    // First call: subscription lookup
    expect(calls[0][0]).toContain('subscriptions-shim-ext.cp.api.test.godaddy.com');
    expect(calls[0][0]).toContain('/v2/customers/customer-123/subscriptionByEntitlementId');
    expect(calls[0][0]).toContain('entitlementId=ent-123');

    // Second call: autoRenew update
    expect(calls[1][0]).toContain('subscriptions-shim-ext.cp.api.test.godaddy.com');
    expect(calls[1][0]).toContain('/v2/customers/customer-123/subscriptions/sub-456/autoRenew');
  });
});
