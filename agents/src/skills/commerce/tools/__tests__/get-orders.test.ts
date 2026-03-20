import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrders = vi.fn();
const mockGetOrder = vi.fn();
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    getOrders: mockGetOrders,
    getOrder: mockGetOrder,
    getStoreManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/store/store-1'),
    getOrdersManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/orders'),
    getCatalogManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/catalog'),
  })),
}));

vi.mock('../auth.js', () => ({
  withCommerceAuth: mockWithCommerceAuth,
}));

vi.mock('../../../../utils/nomad-config.js', () => ({
  getNomadAllocConfig: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: { findById: vi.fn() },
}));

const { getOrdersTool } = await import('../index.js');

describe('commerce__get_orders', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct tool definition shape', () => {
    expect(getOrdersTool.name).toBe('get_orders');
    expect(getOrdersTool.description).toBeTruthy();
    expect(getOrdersTool.execute).toBeTypeOf('function');
  });

  it('should fetch orders with default pagination', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetOrders.mockResolvedValue({
      success: true,
      data: {
        orders: [
          { id: 'order-1', status: 'COMPLETED', total: { value: 5000, currencyCode: 'USD' } },
          { id: 'order-2', status: 'PENDING', total: { value: 2500, currencyCode: 'USD' } },
        ],
      },
    });

    const result = await getOrdersTool.execute(
      { storeId: 'store-1' },
      context,
    );

    expect(result.data.orders).toHaveLength(2);
    expect(mockGetOrders).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-1', pageSize: 20 }),
      'token-abc',
    );
  });

  it('should pass custom pageSize', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetOrders.mockResolvedValue({
      success: true,
      data: { orders: [] },
    });

    await getOrdersTool.execute(
      { storeId: 'store-1', pageSize: 5 },
      context,
    );

    expect(mockGetOrders).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 5 }),
      'token-abc',
    );
  });

  it('should fetch a single order by orderId', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetOrder.mockResolvedValue({
      success: true,
      data: { id: 'order-1', status: 'COMPLETED', total: { value: 5000, currencyCode: 'USD' } },
    });

    const result = await getOrdersTool.execute(
      { storeId: 'store-1', orderId: 'order-1' },
      context,
    );

    expect(result.data.order.id).toBe('order-1');
    expect(mockGetOrder).toHaveBeenCalledWith(
      { storeId: 'store-1', orderId: 'order-1' },
      'token-abc',
    );
    expect(mockGetOrders).not.toHaveBeenCalled();
  });

  it('should return needsAuth when not authenticated', async () => {
    mockWithCommerceAuth.mockResolvedValue({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com',
      scopes: ['commerce.order:read'],
    });

    const result = await getOrdersTool.execute(
      { storeId: 'store-1' },
      context,
    );

    expect(result.needsAuth).toBe(true);
  });

  it('should fail if appId is missing', async () => {
    const result = await getOrdersTool.execute(
      { storeId: 'store-1' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });
});
