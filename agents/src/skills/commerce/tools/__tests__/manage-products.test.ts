import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateSkuGroup = vi.fn();
const mockUpdateSkuGroup = vi.fn();
const mockDeleteSkuGroup = vi.fn();
const mockUpdateSku = vi.fn();
const mockGetSkuGroup = vi.fn();
const mockAddAttributeValuesToSku = vi.fn();
const mockGetCatalogManagementUrl = vi.fn().mockReturnValue('https://manage.godaddy.com/catalog');
const mockGetStoreManagementUrl = vi.fn().mockReturnValue('https://manage.godaddy.com/home/store?storeId=store-1');
const mockGetOrdersManagementUrl = vi.fn().mockReturnValue('https://manage.godaddy.com/orders');
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    createSkuGroup: mockCreateSkuGroup,
    updateSkuGroup: mockUpdateSkuGroup,
    deleteSkuGroup: mockDeleteSkuGroup,
    updateSku: mockUpdateSku,
    getSkuGroup: mockGetSkuGroup,
    addAttributeValuesToSku: mockAddAttributeValuesToSku,
    getCatalogManagementUrl: mockGetCatalogManagementUrl,
    getStoreManagementUrl: mockGetStoreManagementUrl,
    getOrdersManagementUrl: mockGetOrdersManagementUrl,
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
        product: expect.objectContaining({
          label: 'T-Shirt',
          type: 'PHYSICAL',
          status: 'ACTIVE',
          skus: [expect.objectContaining({ label: 'Default', status: 'ACTIVE' })],
        }),
      },
      'token-abc',
    );
  });

  it('should preserve explicit manual skus when skuGenerationMode is manual', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockCreateSkuGroup.mockResolvedValue({
      success: true,
      data: { createSkuGroup: { id: 'grp-manual' } },
    });

    await manageProductsTool.execute(
      {
        action: 'createProduct',
        storeId: 'store-1',
        label: 'Coffee Beans',
        type: 'PHYSICAL',
        skuGenerationMode: 'manual',
        skus: [
          { label: 'Coffee Beans 250g', name: 'coffee-beans-250g', code: 'CB-250' },
          { label: 'Coffee Beans 1kg', name: 'coffee-beans-1kg', code: 'CB-1KG' },
        ],
      },
      context,
    );

    expect(mockCreateSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        product: {
          label: 'Coffee Beans',
          type: 'PHYSICAL',
          status: 'ACTIVE',
          skus: [
            { label: 'Coffee Beans 250g', name: 'coffee-beans-250g', code: 'CB-250', status: 'ACTIVE' },
            { label: 'Coffee Beans 1kg', name: 'coffee-beans-1kg', code: 'CB-1KG', status: 'ACTIVE' },
          ],
        },
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
        product: {
          label: 'Mug',
          type: 'PHYSICAL',
          description: 'A nice mug',
          status: 'ACTIVE',
          skus: [{ label: 'Mug', name: 'mug-default', status: 'ACTIVE' }],
        },
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
        product: {
          label: 'Hat',
          type: 'PHYSICAL',
          status: 'ACTIVE',
          skus: [{ label: 'Red Hat', name: 'red-hat', status: 'ACTIVE' }],
        },
      },
      'token-abc',
    );
  });

  it('should create a single default SKU when skuGenerationMode is singleDefault', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockCreateSkuGroup.mockResolvedValue({
      success: true,
      data: { createSkuGroup: { id: 'grp-default' } },
    });

    await manageProductsTool.execute(
      {
        action: 'createProduct',
        storeId: 'store-1',
        label: 'Latte',
        type: 'PHYSICAL',
        skuGenerationMode: 'singleDefault',
        defaultSku: {
          label: 'Latte Default',
          prices: [{ value: { currencyCode: 'USD', value: 550 } }],
        },
      },
      context,
    );

    expect(mockCreateSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        product: expect.objectContaining({
          label: 'Latte',
          type: 'PHYSICAL',
          status: 'ACTIVE',
          skus: [
            expect.objectContaining({
              label: 'Latte Default',
              name: 'latte-default',
              status: 'ACTIVE',
              prices: [{ value: { currencyCode: 'USD', value: 550 } }],
            }),
          ],
        }),
      },
      'token-abc',
    );
  });

  it('should reject explicit skus when skuGenerationMode is singleDefault', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });

    await expect(
      manageProductsTool.execute(
        {
          action: 'createProduct',
          storeId: 'store-1',
          label: 'Latte',
          type: 'PHYSICAL',
          skuGenerationMode: 'singleDefault',
          skus: [{ label: 'Manual Latte SKU' }],
          defaultSku: {
            label: 'Latte Default',
          },
        },
        context,
      ),
    ).rejects.toThrow('skus cannot be provided when skuGenerationMode is "singleDefault"');

    expect(mockCreateSkuGroup).not.toHaveBeenCalled();
  });

  it('should reject explicit skus when skuGenerationMode is fromAttributes', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });

    await expect(
      manageProductsTool.execute(
        {
          action: 'createProduct',
          storeId: 'store-1',
          label: 'Hoodie',
          type: 'PHYSICAL',
          skuGenerationMode: 'fromAttributes',
          skus: [{ label: 'Manual Hoodie SKU' }],
          attributes: [
            { label: 'Color', values: [{ label: 'Red' }] },
            { label: 'Size', values: [{ label: 'Small' }] },
          ],
        },
        context,
      ),
    ).rejects.toThrow('skus cannot be provided when skuGenerationMode is "fromAttributes"');

    expect(mockCreateSkuGroup).not.toHaveBeenCalled();
  });

  it('should generate SKUs from attributes and associate attribute values', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });

    mockCreateSkuGroup.mockResolvedValue({
      success: true,
      data: { createSkuGroup: { id: 'grp-variants' } },
    });

    mockGetSkuGroup.mockResolvedValue({
      success: true,
      data: {
        skuGroup: {
          id: 'grp-variants',
          skus: {
            edges: [
              { node: { id: 'sku-1', name: 'hoodie-red-small' } },
              { node: { id: 'sku-2', name: 'hoodie-red-medium' } },
            ],
          },
          attributes: {
            edges: [
              {
                node: {
                  name: 'color',
                  values: { edges: [{ node: { id: 'av-color-red', name: 'red' } }] },
                },
              },
              {
                node: {
                  name: 'size',
                  values: {
                    edges: [
                      { node: { id: 'av-size-small', name: 'small' } },
                      { node: { id: 'av-size-medium', name: 'medium' } },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    });

    mockAddAttributeValuesToSku.mockResolvedValue({
      success: true,
      data: { addAttributeValuesToSku: { id: 'sku-1' } },
    });

    const result = await manageProductsTool.execute(
      {
        action: 'createProduct',
        storeId: 'store-1',
        label: 'Hoodie',
        type: 'PHYSICAL',
        skuGenerationMode: 'fromAttributes',
        attributes: [
          { label: 'Color', values: [{ label: 'Red' }] },
          { label: 'Size', values: [{ label: 'Small' }, { label: 'Medium' }] },
        ],
      },
      context,
    );

    expect(mockCreateSkuGroup).toHaveBeenCalled();
    expect(mockGetSkuGroup).toHaveBeenCalledWith(
      { storeId: 'store-1', skuGroupId: 'grp-variants' },
      'token-abc',
    );
    expect(mockAddAttributeValuesToSku).toHaveBeenCalledTimes(2);
    expect(mockAddAttributeValuesToSku).toHaveBeenNthCalledWith(
      1,
      {
        storeId: 'store-1',
        skuId: 'sku-1',
        attributeValueIds: ['av-color-red', 'av-size-small'],
      },
      'token-abc',
    );
    expect(mockAddAttributeValuesToSku).toHaveBeenNthCalledWith(
      2,
      {
        storeId: 'store-1',
        skuId: 'sku-2',
        attributeValueIds: ['av-color-red', 'av-size-medium'],
      },
      'token-abc',
    );
    expect(result.data.skuGenerationMode).toBe('fromAttributes');
    expect(result.data.generatedSkuCount).toBe(2);
  });

  it('should count sku association failures per SKU (not per error message)', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });

    mockCreateSkuGroup.mockResolvedValue({
      success: true,
      data: { createSkuGroup: { id: 'grp-variants' } },
    });

    // One generated SKU, but both expected attribute values are missing in fetched skuGroup.
    // This should emit multiple error messages but only 1 failed association.
    mockGetSkuGroup.mockResolvedValue({
      success: true,
      data: {
        skuGroup: {
          id: 'grp-variants',
          skus: {
            edges: [{ node: { id: 'sku-1', name: 'hoodie-red-small' } }],
          },
          attributes: {
            edges: [
              { node: { name: 'color', values: { edges: [] } } },
              { node: { name: 'size', values: { edges: [] } } },
            ],
          },
        },
      },
    });

    const result = await manageProductsTool.execute(
      {
        action: 'createProduct',
        storeId: 'store-1',
        label: 'Hoodie',
        type: 'PHYSICAL',
        skuGenerationMode: 'fromAttributes',
        attributes: [
          { label: 'Color', values: [{ label: 'Red' }] },
          { label: 'Size', values: [{ label: 'Small' }] },
        ],
      },
      context,
    );

    expect(result.data.skuAssociation.attempted).toBe(1);
    expect(result.data.skuAssociation.failed).toBe(1);
    expect(result.data.skuAssociation.errors).toHaveLength(2);
    expect(mockAddAttributeValuesToSku).not.toHaveBeenCalled();
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

  it('should preserve non-success auth wrapper responses', async () => {
    mockWithCommerceAuth.mockResolvedValue({
      success: false,
      error: 'transient auth gateway failure',
    } as any);

    const result = await manageProductsTool.execute(
      { action: 'createProduct', storeId: 'store-1', label: 'Test', type: 'PHYSICAL' },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('transient auth gateway failure');
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
