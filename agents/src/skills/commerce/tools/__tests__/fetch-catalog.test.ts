import { describe, it, expect, vi, beforeEach } from 'vitest';

function createStoreSummaryResponse(
  stores: Array<{
    storeId: string;
    displayName?: string;
    businessId?: string;
    legalName?: string;
  }> = [],
) {
  if (stores.length === 0) {
    return { businesses: [] };
  }

  return {
    businesses: [
      {
        businessId: stores[0]?.businessId ?? 'business-1',
        legalName: stores[0]?.legalName ?? 'Acme Business',
        stores: stores.map((store) => ({
          storeId: store.storeId,
          displayName: store.displayName ?? store.storeId,
        })),
      },
    ],
  };
}

const mockGetSkuGroups = vi.fn();
const mockGetStoreSummary = vi.fn();
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    getSkuGroups: mockGetSkuGroups,
    getStoreSummary: mockGetStoreSummary,
    getStoreManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/store/store-1'),
    getOrdersManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/orders'),
    getCatalogManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/catalog'),
  })),
}));

vi.mock('../auth.js', () => ({
  withCommerceAuth: mockWithCommerceAuth,
}));

const { fetchCatalogTool, _confirmStoreForTesting, _resetProvisioningLockForTesting } = await import('../index.js');

describe('commerce__fetch_catalog', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetProvisioningLockForTesting();
    _confirmStoreForTesting('app-123', 'store-1');
  });

  it('should have correct tool definition shape', () => {
    expect(fetchCatalogTool.name).toBe('fetch_catalog');
    expect(fetchCatalogTool.description).toBeTruthy();
    expect(fetchCatalogTool.parameters).toBeDefined();
    expect(fetchCatalogTool.execute).toBeTypeOf('function');
  });

  it('should return products from a single page with pagination metadata', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [
            {
              node: {
                id: 'grp-1',
                label: 'T-Shirt',
                description: 'A nice shirt',
                type: 'PHYSICAL',
                status: 'ACTIVE',
                skus: {
                  edges: [{
                    node: {
                      id: 'sku-1',
                      label: 'Small T-Shirt',
                      code: 'TS-001',
                      name: 'Small',
                      status: 'ACTIVE',
                      prices: {
                        edges: [{ node: { id: 'price-1', value: { value: 1500, currencyCode: 'USD' } } }],
                      },
                    },
                  }],
                },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
          totalCount: 1,
        },
      },
    });

    const result = await fetchCatalogTool.execute(
      { storeId: 'store-1' },
      context,
    );

    expect(result.data.products).toHaveLength(1);
    const product = result.data.products[0];
    expect(product.id).toBe('grp-1');
    expect(product.status).toBe('ACTIVE');
    // priceRange should NOT be in the response (dropped for token efficiency)
    expect(product.priceRange).toBeUndefined();
    // SKU should include label, status, and explicit priceId
    const sku = product.skus[0];
    expect(sku.id).toBe('sku-1');
    expect(sku.label).toBe('Small T-Shirt');
    expect(sku.status).toBe('ACTIVE');
    expect(sku.prices[0]).toEqual({ priceId: 'price-1', currencyCode: 'USD', value: 1500 });
    expect(result.data.totalCount).toBe(1);
    expect(result.data.hasMore).toBe(false);
    expect(result.data.endCursor).toBeUndefined();
  });

  it('should return hasMore and endCursor when more pages exist', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });

    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [
            { node: { id: 'grp-1', label: 'Product 1', skus: { edges: [] } } },
          ],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
          totalCount: 50,
        },
      },
    });

    const result = await fetchCatalogTool.execute(
      { storeId: 'store-1' },
      context,
    );

    expect(result.data.products).toHaveLength(1);
    expect(result.data.totalCount).toBe(50);
    expect(result.data.hasMore).toBe(true);
    expect(result.data.endCursor).toBe('cursor-1');
    // Should only make one API call (no auto-pagination)
    expect(mockGetSkuGroups).toHaveBeenCalledTimes(1);
  });

  it('should pass after cursor for subsequent pages', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [
            { node: { id: 'grp-2', label: 'Product 2', skus: { edges: [] } } },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
          totalCount: 2,
        },
      },
    });

    await fetchCatalogTool.execute(
      { storeId: 'store-1', after: 'cursor-1' },
      context,
    );

    expect(mockGetSkuGroups).toHaveBeenCalledWith(
      expect.objectContaining({ after: 'cursor-1' }),
      'token-abc',
    );
  });

  it('should pass custom first parameter', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [],
          pageInfo: { hasNextPage: false },
          totalCount: 0,
        },
      },
    });

    await fetchCatalogTool.execute(
      { storeId: 'store-1', first: 10 },
      context,
    );

    expect(mockGetSkuGroups).toHaveBeenCalledWith(
      expect.objectContaining({ first: 10 }),
      'token-abc',
    );
  });

  it('should return empty array when no products', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [],
          pageInfo: { hasNextPage: false },
          totalCount: 0,
        },
      },
    });

    const result = await fetchCatalogTool.execute(
      { storeId: 'store-1' },
      context,
    );

    expect(result.data.products).toHaveLength(0);
    expect(result.data.totalCount).toBe(0);
    expect(result.data.hasMore).toBe(false);
  });

  it('should pass query filter to API', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [],
          pageInfo: { hasNextPage: false },
          totalCount: 0,
        },
      },
    });

    await fetchCatalogTool.execute(
      { storeId: 'store-1', query: 'shirt' },
      context,
    );

    expect(mockGetSkuGroups).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'shirt' }),
      'token-abc',
    );
  });

  it('should extract storeId from a Commerce Home store URL', async () => {
    _confirmStoreForTesting('app-123', 'store-from-url');
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [],
          pageInfo: { hasNextPage: false },
          totalCount: 0,
        },
      },
    });

    await fetchCatalogTool.execute(
      { storeUrl: 'https://spa.commerce.godaddy.com/home/store?storeId=store-from-url' },
      context,
    );

    expect(mockGetSkuGroups).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-from-url' }),
      'token-abc',
    );
    expect(mockGetStoreSummary).not.toHaveBeenCalled();
  });

  it('should resolve storeId from store summary when no explicit store reference is provided', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-summary', displayName: 'Summary Store' },
    ]));
    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [],
          pageInfo: { hasNextPage: false },
          totalCount: 0,
        },
      },
    });

    await fetchCatalogTool.execute(
      {} as any,
      context,
    );

    expect(mockGetStoreSummary).toHaveBeenCalledWith({ customerId: 'customer-1' }, 'token-abc');
    expect(mockGetSkuGroups).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-summary' }),
      'token-abc',
    );
  });

  it('should resolve a name-like storeId from store summary before fetching catalog', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-summary', displayName: 'The Hawkins Consulting Firm' },
    ]));
    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [],
          pageInfo: { hasNextPage: false },
          totalCount: 0,
        },
      },
    });

    await fetchCatalogTool.execute(
      { storeId: 'The Hawkins Consulting Firm' },
      context,
    );

    expect(mockGetStoreSummary).toHaveBeenCalledWith({ customerId: 'customer-1' }, 'token-abc');
    expect(mockGetSkuGroups).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-summary' }),
      'token-abc',
    );
  });

  it('should treat an uppercase UUID storeId as an explicit store ID', async () => {
    const explicitStoreId = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
    _confirmStoreForTesting('app-123', explicitStoreId);

    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetSkuGroups.mockResolvedValue({
      success: true,
      data: {
        skuGroups: {
          edges: [],
          pageInfo: { hasNextPage: false },
          totalCount: 0,
        },
      },
    });

    await fetchCatalogTool.execute(
      { storeId: explicitStoreId },
      context,
    );

    expect(mockGetStoreSummary).not.toHaveBeenCalled();
    expect(mockGetSkuGroups).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: explicitStoreId }),
      'token-abc',
    );
  });

  it('should return a clear error when no canonical storeId can be resolved', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());

    const result = await fetchCatalogTool.execute(
      { storeId: 'The Hawkins Consulting Firm' },
      context,
    );

    expect(result.error).toContain('could not resolve a Commerce store ID');
    expect(mockGetSkuGroups).not.toHaveBeenCalled();
  });

  it('should return needsAuth when not authenticated', async () => {
    mockWithCommerceAuth.mockResolvedValue({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com',
      scopes: ['commerce.store:read'],
    });

    const result = await fetchCatalogTool.execute(
      { storeId: 'store-1' },
      context,
    );

    expect(result.needsAuth).toBe(true);
  });

  it('should fail if appId is missing', async () => {
    const result = await fetchCatalogTool.execute(
      { storeId: 'store-1' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });

  it('should require setup_store when storeId is provided but store is not confirmed', async () => {
    // Reset confirmation (simulates ADD_STORE completing — addedToExistingBusiness skips confirmation)
    _resetProvisioningLockForTesting();

    const result = await fetchCatalogTool.execute(
      { storeId: 'store-1' },
      context,
    );

    expect(result.requiresSetupFirst).toBe(true);
    expect(mockGetSkuGroups).not.toHaveBeenCalled();
  });
});
