import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSkuGroups = vi.fn();
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    getSkuGroups: mockGetSkuGroups,
    getStoreManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/store/store-1'),
    getOrdersManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/orders'),
    getCatalogManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/catalog'),
  })),
}));

vi.mock('../auth.js', () => ({
  withCommerceAuth: mockWithCommerceAuth,
}));

const { fetchCatalogTool } = await import('../index.js');

describe('commerce__fetch_catalog', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
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
});
