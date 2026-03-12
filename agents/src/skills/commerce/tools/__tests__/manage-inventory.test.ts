import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetLocations = vi.fn();
const mockCreateLocation = vi.fn();
const mockAdjustInventory = vi.fn();
const mockStockInventory = vi.fn();
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    getLocations: mockGetLocations,
    createLocation: mockCreateLocation,
    adjustInventory: mockAdjustInventory,
    stockInventory: mockStockInventory,
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

const { manageInventoryTool } = await import('../index.js');

describe('commerce__manage_inventory', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct tool definition shape', () => {
    expect(manageInventoryTool.name).toBe('manage_inventory');
    expect(manageInventoryTool.description).toBeTruthy();
    expect(manageInventoryTool.execute).toBeTypeOf('function');
  });

  it('should get locations', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetLocations.mockResolvedValue({
      success: true,
      data: {
        locations: {
          edges: [{ node: { id: 'loc-1', label: 'Warehouse' } }],
          pageInfo: { hasNextPage: false, endCursor: null },
          totalCount: 1,
        },
      },
    });

    const result = await manageInventoryTool.execute(
      { action: 'getLocations', storeId: 'store-1' },
      context,
    );

    expect(result.data.locations).toHaveLength(1);
    expect(result.data.locations[0].id).toBe('loc-1');
    expect(result.data.totalCount).toBe(1);
    // No hasMore/endCursor — tool doesn't accept pagination params
    expect(result.data.hasMore).toBeUndefined();
    expect(mockGetLocations).toHaveBeenCalledWith(
      { storeId: 'store-1' },
      'token-abc',
    );
  });

  it('should create a location with flat address params', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockCreateLocation.mockResolvedValue({
      success: true,
      data: { createLocation: { id: 'loc-new', label: 'Main Warehouse' } },
    });

    const result = await manageInventoryTool.execute(
      {
        action: 'createLocation',
        storeId: 'store-1',
        locationLabel: 'Main Warehouse',
        addressLine1: '123 Main St',
        countryCode: 'US',
      },
      context,
    );

    expect(result.data.location.id).toBe('loc-new');
    expect(mockCreateLocation).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        location: {
          label: 'Main Warehouse',
          status: 'ACTIVE',
          address: { addressLine1: '123 Main St', countryCode: 'US' },
        },
      },
      'token-abc',
    );
  });

  it('should slugify location name', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockCreateLocation.mockResolvedValue({
      success: true,
      data: { createLocation: { id: 'loc-new', label: 'My Store' } },
    });

    await manageInventoryTool.execute(
      {
        action: 'createLocation',
        storeId: 'store-1',
        locationLabel: 'My Store',
        locationName: 'My Store Location',
        countryCode: 'US',
      },
      context,
    );

    expect(mockCreateLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        location: expect.objectContaining({
          name: 'my-store-location',
        }),
      }),
      'token-abc',
    );
  });

  it('should adjust inventory', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockAdjustInventory.mockResolvedValue({
      success: true,
      data: { adjustInventory: [{ id: 'inv-1', delta: 5 }] },
    });

    const result = await manageInventoryTool.execute(
      {
        action: 'adjustInventory',
        storeId: 'store-1',
        skuId: 'sku-1',
        locationId: 'loc-1',
        delta: 5,
      },
      context,
    );

    expect(result.data.adjustments).toHaveLength(1);
    expect(mockAdjustInventory).toHaveBeenCalledWith(
      { storeId: 'store-1', skuId: 'sku-1', locationId: 'loc-1', delta: 5 },
      'token-abc',
    );
  });

  it('should stock inventory', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockStockInventory.mockResolvedValue({
      success: true,
      data: { stockInventory: { id: 'stock-1', delta: 10 } },
    });

    const result = await manageInventoryTool.execute(
      {
        action: 'stockInventory',
        storeId: 'store-1',
        skuId: 'sku-1',
        locationId: 'loc-1',
        quantity: 10,
      },
      context,
    );

    expect(result.data.stock.id).toBe('stock-1');
    expect(mockStockInventory).toHaveBeenCalledWith(
      { storeId: 'store-1', skuId: 'sku-1', locationId: 'loc-1', quantity: 10 },
      'token-abc',
    );
  });

  it('should return needsAuth when not authenticated', async () => {
    mockWithCommerceAuth.mockResolvedValue({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com',
      scopes: ['commerce.inventory:write'],
    });

    const result = await manageInventoryTool.execute(
      { action: 'getLocations', storeId: 'store-1' },
      context,
    );

    expect(result.needsAuth).toBe(true);
  });

  it('should fail if appId is missing', async () => {
    const result = await manageInventoryTool.execute(
      { action: 'getLocations', storeId: 'store-1' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });
});
