import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockGetStoreSummary = vi.fn();
const mockOnboardApplication = vi.fn();
const mockEnableCatalogV2 = vi.fn();
const mockEnableGoDaddyPaymentsApplication = vi.fn();
const mockCreateLocation = vi.fn();
const mockGetLocations = vi.fn();
const mockGetStoreManagementUrl = vi.fn().mockReturnValue('https://manage.godaddy.com/store-1');
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    getStoreSummary: mockGetStoreSummary,
    onboardApplication: mockOnboardApplication,
    enableCatalogV2: mockEnableCatalogV2,
    enableGoDaddyPaymentsApplication: mockEnableGoDaddyPaymentsApplication,
    createLocation: mockCreateLocation,
    getLocations: mockGetLocations,
    getStoreManagementUrl: mockGetStoreManagementUrl,
  })),
}));

vi.mock('../auth.js', () => ({
  withCommerceAuth: mockWithCommerceAuth,
}));

const { setupStoreTool } = await import('../index.js');

describe('commerce__setup_store', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct tool definition shape', () => {
    expect(setupStoreTool.name).toBe('setup_store');
    expect(setupStoreTool.description).toBeTruthy();
    expect(setupStoreTool.parameters).toBeDefined();
    expect(setupStoreTool.execute).toBeTypeOf('function');
  });

  it('should return existing store with locationId when one is found', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue({ storeId: 'store-existing', channelId: 'ch-1' });
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-existing' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.data.storeId).toBe('store-existing');
    expect(result.data.locationId).toBe('loc-existing');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockGetLocations).toHaveBeenCalledWith({ storeId: 'store-existing' }, 'token-abc');
  });

  it('should create default location for existing store with no locations', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue({ storeId: 'store-existing', channelId: 'ch-1' });
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [], totalCount: 0 } },
    });
    mockCreateLocation.mockResolvedValue({
      success: true,
      data: { createLocation: { id: 'loc-new-default' } },
    });

    const result = await setupStoreTool.execute({}, context);

    expect(result.data.storeId).toBe('store-existing');
    expect(result.data.locationId).toBe('loc-new-default');
    expect(mockCreateLocation).toHaveBeenCalledWith(
      {
        storeId: 'store-existing',
        location: {
          label: 'Default',
          name: 'default',
          status: 'ACTIVE',
          address: { addressLine1: 'Default', countryCode: 'US' },
        },
      },
      'token-abc',
    );
  });

  it('should create new store when none exists', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue({ storeId: undefined });
    mockOnboardApplication.mockResolvedValue({
      metadata: { storeId: 'store-new', channelId: 'ch-new' },
    });
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockCreateLocation.mockResolvedValue({
      success: true,
      data: { createLocation: { id: 'loc-default' } },
    });

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.data.storeId).toBe('store-new');
    expect(result.data.locationId).toBe('loc-default');
    expect(mockOnboardApplication).toHaveBeenCalled();
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-new' }, 'token-abc');
    expect(mockEnableGoDaddyPaymentsApplication).toHaveBeenCalledWith({ storeId: 'store-new' }, 'token-abc');
    expect(mockCreateLocation).toHaveBeenCalledWith(
      {
        storeId: 'store-new',
        location: {
          label: 'Default',
          name: 'default',
          status: 'ACTIVE',
          address: { addressLine1: 'Default', countryCode: 'US' },
        },
      },
      'token-abc',
    );
  });

  it('should return partial success if Catalog V2 fails', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue({ storeId: undefined });
    mockOnboardApplication.mockResolvedValue({
      metadata: { storeId: 'store-new', channelId: 'ch-new' },
    });
    mockEnableCatalogV2.mockRejectedValue(new Error('Catalog V2 failed'));
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockCreateLocation.mockResolvedValue({
      success: true,
      data: { createLocation: { id: 'loc-default' } },
    });

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.data.storeId).toBe('store-new');
    expect(result.data.errors).toContain('catalog_v2_enablement_failed');
  });

  it('should return partial success if default location creation fails', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue({ storeId: undefined });
    mockOnboardApplication.mockResolvedValue({
      metadata: { storeId: 'store-new', channelId: 'ch-new' },
    });
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockCreateLocation.mockRejectedValue(new Error('Location creation failed'));

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.data.storeId).toBe('store-new');
    expect(result.data.locationId).toBeUndefined();
    expect(result.data.errors).toContain('default_location_failed');
  });

  it('should return needsAuth when not authenticated', async () => {
    mockWithCommerceAuth.mockResolvedValue({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com',
      scopes: ['commerce.store:read'],
    });

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.needsAuth).toBe(true);
  });

  it('should fail if appId is missing from context', async () => {
    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });
});
