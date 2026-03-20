import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdateSkuPrice = vi.fn();
const mockCreateSkuPrice = vi.fn();
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    updateSkuPrice: mockUpdateSkuPrice,
    createSkuPrice: mockCreateSkuPrice,
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

const { managePricingTool } = await import('../index.js');

describe('commerce__manage_pricing', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct tool definition shape', () => {
    expect(managePricingTool.name).toBe('manage_pricing');
    expect(managePricingTool.description).toBeTruthy();
    expect(managePricingTool.execute).toBeTypeOf('function');
  });

  it('should update a price with flat params', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockUpdateSkuPrice.mockResolvedValue({
      success: true,
      data: { updateSkuPrice: { id: 'price-1', value: { value: 2000, currencyCode: 'USD' } } },
    });

    const result = await managePricingTool.execute(
      {

        storeId: 'store-1',
        skuId: 'sku-1',
        priceId: 'price-1',
        currencyCode: 'USD',
        value: 2000,
      },
      context,
    );

    expect(result.data.price.id).toBe('price-1');
    expect(mockUpdateSkuPrice).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        priceId: 'price-1',
        input: { value: { currencyCode: 'USD', value: 2000 } },
      },
      'token-abc',
    );
  });

  it('should include compareAtValue when provided', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockUpdateSkuPrice.mockResolvedValue({
      success: true,
      data: { updateSkuPrice: { id: 'price-1' } },
    });

    await managePricingTool.execute(
      {

        storeId: 'store-1',
        skuId: 'sku-1',
        priceId: 'price-1',
        currencyCode: 'USD',
        value: 1500,
        compareAtValue: 2000,
      },
      context,
    );

    expect(mockUpdateSkuPrice).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        priceId: 'price-1',
        input: {
          value: { currencyCode: 'USD', value: 1500 },
          compareAtValue: { currencyCode: 'USD', value: 2000 },
        },
      },
      'token-abc',
    );
  });

  it('should create a price when priceId is "new"', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockCreateSkuPrice.mockResolvedValue({
      success: true,
      data: { createSkuPrice: { id: 'price-new', value: { value: 650, currencyCode: 'USD' } } },
    });

    const result = await managePricingTool.execute(
      {
        storeId: 'store-1',
        skuId: 'sku-1',
        priceId: 'new',
        currencyCode: 'USD',
        value: 650,
      },
      context,
    );

    expect(result.data.price.id).toBe('price-new');
    expect(mockCreateSkuPrice).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        skuId: 'sku-1',
        input: { value: { currencyCode: 'USD', value: 650 } },
      },
      'token-abc',
    );
    expect(mockUpdateSkuPrice).not.toHaveBeenCalled();
  });

  it('should create a price when priceId is omitted', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockCreateSkuPrice.mockResolvedValue({
      success: true,
      data: { createSkuPrice: { id: 'price-new-2', value: { value: 700, currencyCode: 'USD' } } },
    });

    await managePricingTool.execute(
      {
        storeId: 'store-1',
        skuId: 'sku-1',
        currencyCode: 'USD',
        value: 700,
      },
      context,
    );

    expect(mockCreateSkuPrice).toHaveBeenCalled();
    expect(mockUpdateSkuPrice).not.toHaveBeenCalled();
  });

  it('should return needsAuth when not authenticated', async () => {
    mockWithCommerceAuth.mockResolvedValue({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com',
      scopes: ['commerce.product:write'],
    });

    const result = await managePricingTool.execute(
      { action: 'updatePrice', storeId: 'store-1', skuId: 'sku-1', priceId: 'price-1', currencyCode: 'USD', value: 1000 },
      context,
    );

    expect(result.needsAuth).toBe(true);
  });

  it('should fail if appId is missing', async () => {
    const result = await managePricingTool.execute(
      { action: 'updatePrice', storeId: 'store-1', skuId: 'sku-1', priceId: 'price-1', currencyCode: 'USD', value: 1000 },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });
});
