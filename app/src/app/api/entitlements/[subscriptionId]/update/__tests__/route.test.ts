import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: NextRequest) => handler(request, { jwt: 'test-jwt', user: { customerId: 'customer-123', shopperId: 'shopper-123' } });
  }
}));

describe('/api/entitlements/[subscriptionId]/update PUT', function entitlementsUpdateRouteTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
  });

  it('returns 410 deprecated', async function returnsDeprecated() {
    const { PUT } = await import('../route');

    const request = new NextRequest('http://localhost:3000/api/entitlements/sub-123/update', {
      method: 'PUT',
      body: JSON.stringify({ entitlementId: 'ent-abc' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error).toContain('deprecated');
  });
});
