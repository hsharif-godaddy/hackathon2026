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
  withCustomerAuth: (handler: any) => handler,
}));
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GET /api/subscription-cache', function describeRoute() {
  let mockClient: any;
  let GET: any;

  beforeEach(async function setup() {
    vi.clearAllMocks();

    mockClient = {
      checkCustomer: vi.fn().mockResolvedValue({ customerId: 'cust-1', exists: true }),
      getSubscriptions: vi.fn().mockResolvedValue([]),
    };

    const { AiroMgmtClient } = await import('@/lib/mgmt-airo');
    vi.mocked(AiroMgmtClient as any).mockImplementation(function () { return mockClient; });

    const routeModule = await import('./route');
    GET = routeModule.GET;
  });

  const createAuthContext = (jwt?: string) => ({
    jwt,
    user: { customerId: 'cust-1', email: 'test@example.com' },
  });

  it('should log at warn level for 401 auth errors', async function authWarn401() {
    const request = new NextRequest('http://localhost/api/subscription-cache');
    const authContext = createAuthContext('jwt-token');
    const { logger } = await import('@/lib/request-context');

    const { AiroHttpError } = await import('@/lib/mgmt-airo');
    mockClient.getSubscriptions.mockRejectedValue(
      new AiroHttpError(401, 'Unauthorized', 'Unauthorized')
    );

    const response = await GET(request, authContext);

    expect(response.status).toBe(401);
    expect(logger.warn).toHaveBeenCalledWith('subscription-cache.api.error', expect.objectContaining({ message: 'Failed to fetch subscription cache data' }));
    expect(logger.error).not.toHaveBeenCalledWith('subscription-cache.api.error', expect.anything());
  });

  it('should log at warn level for 403 auth errors', async function authWarn403() {
    const request = new NextRequest('http://localhost/api/subscription-cache');
    const authContext = createAuthContext('jwt-token');
    const { logger } = await import('@/lib/request-context');

    const { AiroHttpError } = await import('@/lib/mgmt-airo');
    mockClient.getSubscriptions.mockRejectedValue(
      new AiroHttpError(403, 'Forbidden', 'Forbidden')
    );

    const response = await GET(request, authContext);

    expect(response.status).toBe(403);
    expect(logger.warn).toHaveBeenCalledWith('subscription-cache.api.error', expect.objectContaining({ message: 'Failed to fetch subscription cache data' }));
    expect(logger.error).not.toHaveBeenCalledWith('subscription-cache.api.error', expect.anything());
  });

  it('should propagate AiroHttpError status instead of always returning 500', async function statusPropagation() {
    const request = new NextRequest('http://localhost/api/subscription-cache');
    const authContext = createAuthContext('jwt-token');

    const { AiroHttpError } = await import('@/lib/mgmt-airo');
    mockClient.getSubscriptions.mockRejectedValue(
      new AiroHttpError(404, 'Not Found', 'Not found')
    );

    const response = await GET(request, authContext);

    expect(response.status).toBe(404);
  });

  it('should return 500 for non-AiroHttpError errors', async function genericError() {
    const request = new NextRequest('http://localhost/api/subscription-cache');
    const authContext = createAuthContext('jwt-token');
    const { logger } = await import('@/lib/request-context');

    mockClient.getSubscriptions.mockRejectedValue(new Error('Network failure'));

    const response = await GET(request, authContext);

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('subscription-cache.api.error', expect.objectContaining({ message: 'Failed to fetch subscription cache data' }));
  });
});
