import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMgmtClient = {
  getEntitlements: vi.fn(),
  updateEntitlement: vi.fn()
};

const mockVentureService = {
  getCustomerProjects: vi.fn()
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

vi.mock('@/lib/venture-service', () => ({
  VentureService: vi.fn().mockImplementation(() => mockVentureService)
}));

describe('/api/entitlements/[subscriptionId]/update PUT', function entitlementsUpdateRouteTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    mockAuthContext.user.customerId = 'customer-123';
  });

  function createRequest(body: Record<string, any>): NextRequest {
    return new NextRequest('http://localhost:3000/api/entitlements/sub-123/update', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  it('rejects updates when subscription is not owned by caller', async function rejectsMismatchedSubscription() {
    const { PUT } = await import('../route');

    mockMgmtClient.getEntitlements.mockResolvedValue({
      id: 'sub-123',
      customerId: 'someone-else'
    });

    const request = createRequest({ entitlementId: 'ent-abc' });
    const response = await PUT(request, { params: { subscriptionId: 'sub-123' } });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockVentureService.getCustomerProjects).not.toHaveBeenCalled();
    expect(mockMgmtClient.updateEntitlement).not.toHaveBeenCalled();
  });

  it('rejects updates when entitlement is not owned by caller', async function rejectsUnknownEntitlement() {
    const { PUT } = await import('../route');

    mockMgmtClient.getEntitlements.mockResolvedValue({
      id: 'sub-123',
      customerId: 'customer-123'
    });

    mockVentureService.getCustomerProjects.mockResolvedValue({
      projects: {
        edges: [
          {
            node: {
              billing: {
                id: 'ent-owned'
              }
            }
          }
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: null
        }
      }
    });

    const request = createRequest({ entitlementId: 'ent-not-owned' });
    const response = await PUT(request, { params: { subscriptionId: 'sub-123' } });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Entitlement does not belong to this customer');
    expect(mockMgmtClient.updateEntitlement).not.toHaveBeenCalled();
  });

  it('updates entitlement when ownership checks pass', async function updatesEntitlement() {
    const { PUT } = await import('../route');

    mockMgmtClient.getEntitlements.mockResolvedValue({
      id: 'sub-123',
      customerId: 'customer-123'
    });

    mockVentureService.getCustomerProjects.mockResolvedValue({
      projects: {
        edges: [
          {
            node: {
              billing: {
                id: 'ent-owned'
              }
            }
          }
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: null
        }
      }
    });

    mockMgmtClient.updateEntitlement.mockResolvedValue({
      id: 'sub-123',
      entitlementId: 'ent-owned'
    });

    const request = createRequest({ entitlementId: 'ent-owned' });
    const response = await PUT(request, { params: { subscriptionId: 'sub-123' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.subscriptionId).toBe('sub-123');
    expect(mockMgmtClient.updateEntitlement).toHaveBeenCalledWith('sub-123', { entitlementId: 'ent-owned' });
  });
});
