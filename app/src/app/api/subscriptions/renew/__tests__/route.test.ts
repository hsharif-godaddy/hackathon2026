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

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
});

describe('/api/subscriptions/renew POST', function renewRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockAuthContext.jwt = 'test-jwt-token';
    mockAuthContext.user.customerId = 'customer-123';
  });

  afterEach(function cleanup() {
    vi.restoreAllMocks();
  });

  function createRequest(body: object, cookies?: string): NextRequest {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cookies) {
      headers['Cookie'] = cookies;
    }
    return new NextRequest('http://localhost:3000/api/subscriptions/renew', {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    });
  }

  it('should return 401 when jwt is missing', async function noJwt() {
    mockAuthContext.jwt = '';

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication token required');
  });

  it('should return 400 when subscriptionId is missing', async function missingSubscriptionId() {
    const { POST } = await import('../route');
    const request = createRequest({});
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('subscriptionId is required');
  });

  it('should successfully renew subscription', async function successfulRenewal() {
    const detailsResponse = {
      ok: true,
      json: async () => ({
        metadata: { revision: 'rev-123' },
        offer: {
          term: { termType: 'MONTH', numberOfTerms: 1 },
        },
      }),
    };
    const renewResponse = {
      ok: true,
      json: async () => ({
        subscriptionId: 'sub-123',
        status: 'active',
      }),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(detailsResponse)
      .mockResolvedValueOnce(renewResponse);

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        subscriptionId: 'sub-123',
        status: 'active',
      },
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'subscription.renew.start',
      expect.objectContaining({
        customerId: 'customer-123',
        subscriptionId: 'sub-123',
      })
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      'subscription.renew.success',
      expect.objectContaining({
        customerId: 'customer-123',
        subscriptionId: 'sub-123',
      })
    );
  });

  it('should handle renewal API failure', async function renewalFailure() {
    const detailsResponse = {
      ok: true,
      json: async () => ({
        metadata: { revision: 'rev-123' },
        offer: { term: { termType: 'MONTH', numberOfTerms: 1 } },
      }),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(detailsResponse)
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: async () => 'Payment required',
      });

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error).toBe('Failed to renew subscription');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'subscription.renew.failed',
      expect.objectContaining({
        customerId: 'customer-123',
        subscriptionId: 'sub-123',
        status: 402,
      })
    );
  });

  it('should handle subscription details lookup failure', async function detailsFailure() {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Subscription not found',
    });

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Failed to get subscription details');
  });

  it('should handle missing revision in subscription details', async function missingRevision() {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        metadata: {}, // no revision
        offer: { term: { termType: 'MONTH', numberOfTerms: 1 } },
      }),
    });

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('No revision found for subscription');
  });

  it('should handle missing term information', async function missingTermInfo() {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        metadata: { revision: 'rev-123' },
        // no term info
      }),
    });

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Missing term information for subscription');
  });

  it('should handle unexpected errors', async function unexpectedError() {
    // Error on first fetch (getting details)
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to renew subscription');

    expect(mockLogger.error).toHaveBeenCalledWith(
      'subscription.renew.error',
      expect.objectContaining({
        error: 'Network error',
      })
    );
  });

  it('should use correct subscriptions-shim URL for test environment', async function correctTestUrl() {
    const detailsResponse = {
      ok: true,
      json: async () => ({
        metadata: { revision: 'rev-123' },
        offer: { term: { termType: 'MONTH', numberOfTerms: 1 } },
      }),
    };
    const renewResponse = {
      ok: true,
      json: async () => ({ subscriptionId: 'sub-123', status: 'active' }),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(detailsResponse)
      .mockResolvedValueOnce(renewResponse);

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    await POST(request);

    // Both calls should use the test subscriptions-shim URL
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('subscriptions-shim-ext.cp.api.test.godaddy.com'),
      expect.any(Object)
    );
  });

  it('should include correct headers including Idempotent-Id and If-Match', async function correctHeaders() {
    const detailsResponse = {
      ok: true,
      json: async () => ({
        metadata: { revision: 'rev-123' },
        offer: { term: { termType: 'MONTH', numberOfTerms: 1 } },
      }),
    };
    const renewResponse = {
      ok: true,
      json: async () => ({ subscriptionId: 'sub-123', status: 'active' }),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(detailsResponse)
      .mockResolvedValueOnce(renewResponse);

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    await POST(request);

    // Check the second call (renew) has correct headers
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'sso-jwt test-jwt-token',
          'Content-Type': 'application/json',
          'X-App-Key': 'airo-builder',
          'Idempotent-Id': 'test-uuid-1234',
          'If-Match': 'rev-123',
        }),
      })
    );
  });

  it('should include renewSubscriptions array with marketId/currency from cookies and term from subscription details', async function correctBody() {
    const detailsResponse = {
      ok: true,
      json: async () => ({
        metadata: { revision: 'rev-123' },
        offer: { term: { termType: 'YEAR', numberOfTerms: 2 } },
      }),
    };
    const renewResponse = {
      ok: true,
      json: async () => ({ subscriptionId: 'sub-123', status: 'active' }),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(detailsResponse)
      .mockResolvedValueOnce(renewResponse);

    const { POST } = await import('../route');
    const request = createRequest({
      subscriptionId: 'sub-123',
    });
    await POST(request);

    // Check the second call (renew) has correct body with renewSubscriptions format
    // marketId/currency come from cookies (default to en-US/USD in test)
    // Term comes from subscription details
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          marketId: 'en-US',
          currency: 'USD',
          renewSubscriptions: [
            {
              subscriptionId: 'sub-123',
              term: { termType: 'YEAR', numberOfTerms: 2 },
            },
          ],
        }),
      })
    );
  });

  it('should use market and currency from cookies when provided', async function usesMarketCurrencyCookies() {
    const detailsResponse = {
      ok: true,
      json: async () => ({
        metadata: { revision: 'rev-123' },
        offer: { term: { termType: 'MONTH', numberOfTerms: 1 } },
      }),
    };
    const renewResponse = {
      ok: true,
      json: async () => ({ subscriptionId: 'sub-123', status: 'active' }),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(detailsResponse)
      .mockResolvedValueOnce(renewResponse);

    const { POST } = await import('../route');
    const request = createRequest(
      { subscriptionId: 'sub-123' },
      'market=de-DE; currency=EUR; other=value'
    );
    await POST(request);

    // Should use the market and currency from cookies
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          marketId: 'de-DE',
          currency: 'EUR',
          renewSubscriptions: [
            {
              subscriptionId: 'sub-123',
              term: { termType: 'MONTH', numberOfTerms: 1 },
            },
          ],
        }),
      })
    );
  });

  it('should convert numeric revision to string for If-Match header', async function convertsRevisionToString() {
    const detailsResponse = {
      ok: true,
      json: async () => ({
        metadata: { revision: 123 }, // numeric revision
        offer: { term: { termType: 'MONTH', numberOfTerms: 1 } },
      }),
    };
    const renewResponse = {
      ok: true,
      json: async () => ({ subscriptionId: 'sub-123', status: 'active' }),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(detailsResponse)
      .mockResolvedValueOnce(renewResponse);

    const { POST } = await import('../route');
    const request = createRequest({ subscriptionId: 'sub-123' });
    await POST(request);

    // Should convert numeric revision to string
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'If-Match': '123', // string, not number
        }),
      })
    );
  });
});
