import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAddMediaObjectsToSkuGroup = vi.fn();
const mockRemoveMediaObjectsFromSkuGroup = vi.fn();
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    addMediaObjectsToSkuGroup: mockAddMediaObjectsToSkuGroup,
    removeMediaObjectsFromSkuGroup: mockRemoveMediaObjectsFromSkuGroup,
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

const { manageMediaTool } = await import('../index.js');

describe('commerce__manage_media', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct tool definition shape', () => {
    expect(manageMediaTool.name).toBe('manage_media');
    expect(manageMediaTool.description).toBeTruthy();
    expect(manageMediaTool.execute).toBeTypeOf('function');
  });

  it('should add media using mediaObjects array', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockAddMediaObjectsToSkuGroup.mockResolvedValue({
      success: true,
      data: { addMediaObjectsToSkuGroup: { id: 'grp-1', mediaObjects: { edges: [{ node: { id: 'media-1' } }] } } },
    });

    const result = await manageMediaTool.execute(
      {
        action: 'addMedia',
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaObjects: [{ url: 'https://example.com/img.jpg', type: 'IMAGE', label: 'Main image' }],
      },
      context,
    );

    expect(result.data.skuGroup.id).toBe('grp-1');
    expect(mockAddMediaObjectsToSkuGroup).toHaveBeenCalledWith(
      { storeId: 'store-1', skuGroupId: 'grp-1', mediaObjects: [{ url: 'https://example.com/img.jpg', type: 'IMAGE', label: 'Main image' }] },
      'token-abc',
    );
  });

  it('should add media using single mediaUrl shortcut', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockAddMediaObjectsToSkuGroup.mockResolvedValue({
      success: true,
      data: { addMediaObjectsToSkuGroup: { id: 'grp-1' } },
    });

    await manageMediaTool.execute(
      {
        action: 'addMedia',
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaUrl: 'https://example.com/photo.jpg',
        mediaType: 'IMAGE',
        mediaLabel: 'Product photo',
      },
      context,
    );

    expect(mockAddMediaObjectsToSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaObjects: [{ url: 'https://example.com/photo.jpg', type: 'IMAGE', label: 'Product photo' }],
      },
      'token-abc',
    );
  });

  it('should coerce JSON string mediaObjects', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockAddMediaObjectsToSkuGroup.mockResolvedValue({
      success: true,
      data: { addMediaObjectsToSkuGroup: { id: 'grp-1' } },
    });

    await manageMediaTool.execute(
      {
        action: 'addMedia',
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaObjects: JSON.stringify([{ url: 'https://example.com/img.jpg', type: 'IMAGE' }]),
      },
      context,
    );

    expect(mockAddMediaObjectsToSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaObjects: [{ url: 'https://example.com/img.jpg', type: 'IMAGE' }],
      },
      'token-abc',
    );
  });

  it('should normalize PHOTO type to IMAGE', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockAddMediaObjectsToSkuGroup.mockResolvedValue({
      success: true,
      data: { addMediaObjectsToSkuGroup: { id: 'grp-1' } },
    });

    await manageMediaTool.execute(
      {
        action: 'addMedia',
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaObjects: [{ url: 'https://example.com/img.jpg', type: 'PHOTO' }],
      },
      context,
    );

    expect(mockAddMediaObjectsToSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaObjects: [{ url: 'https://example.com/img.jpg', type: 'IMAGE' }],
      },
      'token-abc',
    );
  });

  it('should normalize PHOTO type to IMAGE with mediaUrl shortcut', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockAddMediaObjectsToSkuGroup.mockResolvedValue({
      success: true,
      data: { addMediaObjectsToSkuGroup: { id: 'grp-1' } },
    });

    await manageMediaTool.execute(
      {
        action: 'addMedia',
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaUrl: 'https://example.com/photo.jpg',
        mediaType: 'PHOTO',
      },
      context,
    );

    expect(mockAddMediaObjectsToSkuGroup).toHaveBeenCalledWith(
      {
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaObjects: [{ url: 'https://example.com/photo.jpg', type: 'IMAGE' }],
      },
      'token-abc',
    );
  });

  it('should remove media from a product', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockRemoveMediaObjectsFromSkuGroup.mockResolvedValue({
      success: true,
      data: { removeMediaObjectsFromSkuGroup: { id: 'grp-1', mediaObjects: { edges: [] } } },
    });

    const result = await manageMediaTool.execute(
      {
        action: 'removeMedia',
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaObjectIds: ['media-1', 'media-2'],
      },
      context,
    );

    expect(result.data.skuGroup.id).toBe('grp-1');
    expect(mockRemoveMediaObjectsFromSkuGroup).toHaveBeenCalledWith(
      { storeId: 'store-1', skuGroupId: 'grp-1', mediaObjectIds: ['media-1', 'media-2'] },
      'token-abc',
    );
  });

  it('should coerce JSON string mediaObjectIds', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockRemoveMediaObjectsFromSkuGroup.mockResolvedValue({
      success: true,
      data: { removeMediaObjectsFromSkuGroup: { id: 'grp-1' } },
    });

    await manageMediaTool.execute(
      {
        action: 'removeMedia',
        storeId: 'store-1',
        skuGroupId: 'grp-1',
        mediaObjectIds: JSON.stringify(['media-1']),
      },
      context,
    );

    expect(mockRemoveMediaObjectsFromSkuGroup).toHaveBeenCalledWith(
      { storeId: 'store-1', skuGroupId: 'grp-1', mediaObjectIds: ['media-1'] },
      'token-abc',
    );
  });

  it('should return needsAuth when not authenticated', async () => {
    mockWithCommerceAuth.mockResolvedValue({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com',
      scopes: ['commerce.product:write'],
    });

    const result = await manageMediaTool.execute(
      { action: 'addMedia', storeId: 'store-1', skuGroupId: 'grp-1', mediaUrl: 'https://example.com/img.jpg' },
      context,
    );

    expect(result.needsAuth).toBe(true);
  });

  it('should fail if appId is missing', async () => {
    const result = await manageMediaTool.execute(
      { action: 'addMedia', storeId: 'store-1', skuGroupId: 'grp-1', mediaUrl: 'https://example.com/img.jpg' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });
});
