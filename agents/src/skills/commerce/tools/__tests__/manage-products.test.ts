import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateSkuGroup = vi.fn();
const mockUpdateSkuGroup = vi.fn();
const mockDeleteSkuGroup = vi.fn();
const mockUpdateSku = vi.fn();
const mockGetCatalogManagementUrl = vi.fn().mockReturnValue('https://manage.godaddy.com/catalog');
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    createSkuGroup: mockCreateSkuGroup,
    updateSkuGroup: mockUpdateSkuGroup,
    deleteSkuGroup: mockDeleteSkuGroup,
    updateSku: mockUpdateSku,
    getCatalogManagementUrl: mockGetCatalogManagementUrl,
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

const { manageProductsTool } = await import('../index.js');

describe('commerce__manage_products', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct tool definition shape', () => {
    expect(manageProductsTool.name).toBe('manage_products');
    expect(manageProductsTool.description).toBeTruthy();
    expect(manageProductsTool.execute).toBeTypeOf('function');
  });

  it('should create a product with flat params', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockCreateSkuGroup.mockResolvedValue({
      success: true,
      data: { createSkuGroup: { id: 'grp-new', label: 'T-Shirt', status: 'ACTIVE' } },
    });

    const result = await manageProductsTool.execute(
      {
        action: 'createProduct',
        storeId: 'store-1',
        label: 'T-Shirt',
        type: 'PHYSICAL',
        skus: [{ label: 'Default' }],
      },
      context,
    );

    expect(result.data.skuGroup.id).toBe('grp-new');
    expect(mockCreateSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        product: { label: 'T-Shirt', type: 'PHYSICAL', skus: [{ label: 'Default' }] },
      },
      'token-abc',
    );
  });

  it('should create a product with description and status', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockCreateSkuGroup.mockResolvedValue({
      success: true,
      data: { createSkuGroup: { id: 'grp-new', label: 'Mug' } },
    });

    await manageProductsTool.execute(
      {
        action: 'createProduct',
        storeId: 'store-1',
        label: 'Mug',
        type: 'PHYSICAL',
        description: 'A nice mug',
        status: 'ACTIVE',
      },
      context,
    );

    expect(mockCreateSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        product: { label: 'Mug', type: 'PHYSICAL', description: 'A nice mug', status: 'ACTIVE' },
      },
      'token-abc',
    );
  });

  it('should auto-slugify SKU names on create', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockCreateSkuGroup.mockResolvedValue({
      success: true,
      data: { createSkuGroup: { id: 'grp-new' } },
    });

    await manageProductsTool.execute(
      {
        action: 'createProduct',
        storeId: 'store-1',
        label: 'Hat',
        type: 'PHYSICAL',
        skus: [{ label: 'Red Hat', name: 'Red Hat' }],
      },
      context,
    );

    expect(mockCreateSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        product: { label: 'Hat', type: 'PHYSICAL', skus: [{ label: 'Red Hat', name: 'red-hat' }] },
      },
      'token-abc',
    );
  });

  it('should update a product with flat params', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockUpdateSkuGroup.mockResolvedValue({
      success: true,
      data: { updateSkuGroup: { id: 'grp-1', label: 'Updated Shirt' } },
    });

    const result = await manageProductsTool.execute(
      {
        action: 'updateProduct',
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        label: 'Updated Shirt',
      },
      context,
    );

    expect(result.data.skuGroup.id).toBe('grp-1');
    expect(mockUpdateSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        product: { label: 'Updated Shirt' },
      },
      'token-abc',
    );
  });

  it('should delete a product', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockDeleteSkuGroup.mockResolvedValue({
      success: true,
      data: { deleteSkuGroupById: { id: 'grp-1' } },
    });

    const result = await manageProductsTool.execute(
      { action: 'deleteProduct', storeId: 'store-1', skuGroupId: 'grp-1' },
      context,
    );

    expect(result.data.deleted).toBe(true);
  });

  it('should throw descriptive error when deleteProduct gets null response', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockDeleteSkuGroup.mockResolvedValue({
      success: true,
      data: { deleteSkuGroupById: null },
    });

    await expect(
      manageProductsTool.execute(
        { action: 'deleteProduct', storeId: 'store-1', skuGroupId: 'grp-nonexistent' },
        context,
      ),
    ).rejects.toThrow('Product not found or already deleted');
  });

  it('should update a SKU with flat params', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockUpdateSku.mockResolvedValue({
      success: true,
      data: { updateSku: { id: 'sku-1', label: 'Updated SKU' } },
    });

    const result = await manageProductsTool.execute(
      {
        action: 'updateSku',
        storeId: 'store-1',
        skuId: 'sku-1',
        skuLabel: 'Updated SKU',
        skuName: 'Updated SKU Name',
        skuCode: 'SKU-001',
        status: 'ACTIVE',
      },
      context,
    );

    expect(result.data.sku.id).toBe('sku-1');
    expect(mockUpdateSku).toHaveBeenCalledWith(
      { storeId: 'store-1', skuId: 'sku-1', product: { label: 'Updated SKU', name: 'updated-sku-name', code: 'SKU-001', status: 'ACTIVE' } },
      'token-abc',
    );
  });

  it('should return needsAuth when not authenticated', async () => {
    mockWithCommerceAuth.mockResolvedValue({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com',
      scopes: ['commerce.product:write'],
    });

    const result = await manageProductsTool.execute(
      { action: 'createProduct', storeId: 'store-1', label: 'Test', type: 'PHYSICAL' },
      context,
    );

    expect(result.needsAuth).toBe(true);
  });

  it('should fail if appId is missing', async () => {
    const result = await manageProductsTool.execute(
      { action: 'createProduct', storeId: 'store-1', label: 'Test', type: 'PHYSICAL' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });
});
