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

function createMultiBusinessStoreSummaryResponse(
  businesses: Array<{
    businessId: string;
    legalName?: string;
    stores: Array<{ storeId: string; displayName?: string }>;
  }>,
) {
  return {
    businesses: businesses.map((biz) => ({
      businessId: biz.businessId,
      legalName: biz.legalName ?? biz.businessId,
      stores: biz.stores.map((store) => ({
        storeId: store.storeId,
        displayName: store.displayName ?? store.storeId,
      })),
    })),
  };
}

// Mock dependencies
const mockGetStoreSummary = vi.fn();
const mockOnboardApplication = vi.fn();
const mockEnableCatalogV2 = vi.fn();
const mockEnableGoDaddyPaymentsApplication = vi.fn();
const mockCreateLocation = vi.fn();
const mockGetLocations = vi.fn();
const mockGetStoreManagementUrl = vi.fn().mockReturnValue('https://manage.godaddy.com/store-1');
const mockGetOrdersManagementUrl = vi.fn().mockReturnValue('https://manage.godaddy.com/orders');
const mockGetCatalogManagementUrl = vi.fn().mockReturnValue('https://manage.godaddy.com/catalog');
const mockAddStoreToExistingBusiness = vi.fn();
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    getStoreSummary: mockGetStoreSummary,
    onboardApplication: mockOnboardApplication,
    addStoreToExistingBusiness: mockAddStoreToExistingBusiness,
    enableCatalogV2: mockEnableCatalogV2,
    enableGoDaddyPaymentsApplication: mockEnableGoDaddyPaymentsApplication,
    createLocation: mockCreateLocation,
    getLocations: mockGetLocations,
    getStoreManagementUrl: mockGetStoreManagementUrl,
    getOrdersManagementUrl: mockGetOrdersManagementUrl,
    getCatalogManagementUrl: mockGetCatalogManagementUrl,
  })),
}));

vi.mock('../auth.js', () => ({
  withCommerceAuth: mockWithCommerceAuth,
}));

const { setupStoreTool, _resetProvisioningLockForTesting } = await import('../index.js');

describe('commerce__setup_store', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetProvisioningLockForTesting();
  });

  it('should have correct tool definition shape', () => {
    expect(setupStoreTool.name).toBe('setup_store');
    expect(setupStoreTool.description).toBeTruthy();
    expect(setupStoreTool.parameters).toBeDefined();
    expect(setupStoreTool.execute).toBeTypeOf('function');
  });

  it('should auto-proceed with existing store when only one store exists and no preference is provided', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-existing', displayName: 'Acme Goods' },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-existing' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute({}, context);

    expect(result.data.storeChoiceRequired).toBeUndefined();
    expect(result.data.storeId).toBe('store-existing');
    expect(result.data.locationId).toBe('loc-existing');
    expect(result.data.created).toBe(false);
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-existing' }, 'token-abc');
    expect(mockEnableGoDaddyPaymentsApplication).toHaveBeenCalledWith({ storeId: 'store-existing' }, 'token-abc');
  });

  it('should return existing store with locationId when the user explicitly chooses existing', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-existing', displayName: 'Acme Goods' },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-existing' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute(
      { storePreference: 'existing' },
      context,
    );

    expect(result.data.storeId).toBe('store-existing');
    expect(result.data.locationId).toBe('loc-existing');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-existing' }, 'token-abc');
    expect(mockEnableGoDaddyPaymentsApplication).toHaveBeenCalledWith({ storeId: 'store-existing' }, 'token-abc');
    expect(mockGetLocations).toHaveBeenCalledWith({ storeId: 'store-existing' }, 'token-abc');
  });

  it('should create default location for an explicitly chosen existing store with no locations', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-existing', displayName: 'Acme Goods' },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [], totalCount: 0 } },
    });
    mockCreateLocation.mockResolvedValue({
      success: true,
      data: { createLocation: { id: 'loc-new-default' } },
    });

    const result = await setupStoreTool.execute({ storePreference: 'existing' }, context);

    expect(result.data.storeId).toBe('store-existing');
    expect(result.data.locationId).toBe('loc-new-default');
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-existing' }, 'token-abc');
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

  it('should create an additional store via ADD_STORE when explicitly requested and one already exists', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-existing', displayName: 'Acme Goods', businessId: 'biz-1' },
    ]));
    mockAddStoreToExistingBusiness.mockResolvedValue({
      metadata: { storeId: 'store-new', channelId: 'ch-new' },
    });
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({ success: true, data: { locations: { edges: [{ node: { id: 'loc-default' } }] } } });

    const result = await setupStoreTool.execute(
      { storePreference: 'new', storeName: 'Acme Gifts' },
      context,
    );

    // ADD_STORE now returns storeChoiceRequired so the user picks which store to manage
    expect(result.data.created).toBe(true);
    expect(result.data.addedToExistingBusiness).toBe(true);
    expect(result.data.storeChoiceRequired).toBe(true);
    expect(result.data.existingStores).toEqual(expect.arrayContaining([
      expect.objectContaining({ storeId: 'store-existing' }),
      expect.objectContaining({ storeId: 'store-new', storeName: 'Acme Gifts' }),
    ]));
    expect(result.data.paymentsAutoEnabled).toBe(true);
    expect(mockAddStoreToExistingBusiness).toHaveBeenCalledWith(
      { appId: 'app-123', businessId: 'biz-1', storeName: 'Acme Gifts' },
      'token-abc',
    );
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-new' }, 'token-abc');
    expect(mockEnableGoDaddyPaymentsApplication).toHaveBeenCalledWith({ storeId: 'store-new' }, 'token-abc');
  });

  it('should return noExistingStoreFound when existing is requested but no store is available', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());

    const result = await setupStoreTool.execute(
      { storePreference: 'existing', storeName: 'Acme Goods' },
      context,
    );

    expect(result.data.noExistingStoreFound).toBe(true);
    expect(result.data.storeName).toBe('Acme Goods');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should ignore a name-like storeId and auto-proceed with the single discovered store', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-existing', displayName: 'Acme Goods' },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-existing' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute(
      { storeId: 'Acme Goods' },
      context,
    );

    expect(result.data.storeChoiceRequired).toBeUndefined();
    expect(result.data.storeId).toBe('store-existing');
    expect(result.data.created).toBe(false);
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-existing' }, 'token-abc');
  });

  it('should return an error when the provided explicit storeId is not in the customer summary', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-existing', displayName: 'Acme Goods' },
    ]));

    const result = await setupStoreTool.execute(
      { storeId: 'store-from-user' },
      context,
    );

    expect(result.error).toContain('provided Commerce store was not found');
    expect(mockEnableCatalogV2).not.toHaveBeenCalled();
    expect(mockEnableGoDaddyPaymentsApplication).not.toHaveBeenCalled();
    expect(mockGetLocations).not.toHaveBeenCalled();
  });

  it('should create new store when none exists', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());
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
      { storePreference: 'new', firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.data.storeId).toBe('store-new');
    expect(result.data.locationId).toBe('loc-default');
    expect(mockOnboardApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@test.com',
        includePaymentsProduct: true,
      }),
      'token-abc',
    );
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

  it('should link a provided storeId directly without requiring owner identity', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-from-user', displayName: 'Linked Store' },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-existing' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute(
      { storeId: 'store-from-user' },
      context,
    );

    expect(result.data.storeId).toBe('store-from-user');
    expect(result.data.locationId).toBe('loc-existing');
    expect(result.data.channelId).toBeUndefined();
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-from-user' }, 'token-abc');
    expect(mockEnableGoDaddyPaymentsApplication).toHaveBeenCalledWith({ storeId: 'store-from-user' }, 'token-abc');
    expect(mockGetLocations).toHaveBeenCalledWith({ storeId: 'store-from-user' }, 'token-abc');
  });

  it('should treat an uppercase UUID storeId as an explicit store ID', async () => {
    const explicitStoreId = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';

    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-existing', displayName: 'First Store' },
      { storeId: explicitStoreId, displayName: 'Explicit Store' },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-explicit' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute(
      { storeId: explicitStoreId },
      context,
    );

    expect(result.data.storeId).toBe(explicitStoreId);
    expect(result.data.locationId).toBe('loc-explicit');
    expect(result.data.storeChoiceRequired).toBeUndefined();
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: explicitStoreId }, 'token-abc');
    expect(mockEnableGoDaddyPaymentsApplication).toHaveBeenCalledWith({ storeId: explicitStoreId }, 'token-abc');
    expect(mockGetLocations).toHaveBeenCalledWith({ storeId: explicitStoreId }, 'token-abc');
  });

  it('should extract storeId from a Commerce store URL and reuse that store directly', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-from-url', displayName: 'Store From Url' },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-existing' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute(
      { storeUrl: 'https://spa.commerce.godaddy.com/home/store?storeId=store-from-url' },
      context,
    );

    expect(result.data.storeId).toBe('store-from-url');
    expect(result.data.channelId).toBeUndefined();
    expect(result.data.locationId).toBe('loc-existing');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-from-url' }, 'token-abc');
  });

  it('should skip automatic payments setup when onboarding names contain non-ascii characters', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());
    mockOnboardApplication.mockResolvedValue({
      metadata: { storeId: 'store-new', channelId: 'ch-new' },
    });
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockCreateLocation.mockResolvedValue({
      success: true,
      data: { createLocation: { id: 'loc-default' } },
    });

    const result = await setupStoreTool.execute(
      {
        firstName: 'M\\u00F3nica'.replace('\\u00F3', '\u00F3'),
        lastName: 'Morales',
        email: 'vision_clear@outlook.com',
        storeName: 'Visi\\u00F3n Clear'.replace('\\u00F3', '\u00F3'),
      },
      context,
    );

    expect(mockOnboardApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Mónica',
        lastName: 'Morales',
        email: 'vision_clear@outlook.com',
        storeName: 'Visión Clear',
        includePaymentsProduct: false,
      }),
      'token-abc',
    );
    expect(mockEnableGoDaddyPaymentsApplication).not.toHaveBeenCalled();
    expect(result.data.paymentsAutoEnabled).toBe(false);
    expect(result.data.paymentsManualSetupRequired).toBe(true);
    expect(result.data.paymentsSetupReason).toBe('non_ascii_onboarding_name');
    expect(result.data.warnings).toContain('payments_manual_setup_required');
  });

  it('should recover an existing store after a duplicate onboarding conflict', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary
      .mockResolvedValueOnce(createStoreSummaryResponse())
      .mockResolvedValueOnce(createStoreSummaryResponse([
        { storeId: 'store-existing', displayName: 'Acme Goods' },
      ]));
    mockOnboardApplication.mockRejectedValue(
      new Error('Commerce onboarding API error (409): {"name":"Conflict","details":[{"description":"Duplicated request was detected"}]}'),
    );
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-existing' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com', storeName: 'Acme Goods' },
      context,
    );

    expect(result.data.storeId).toBe('store-existing');
    expect(result.data.channelId).toBeUndefined();
    expect(result.data.created).toBe(false);
    expect(result.data.recoveredFromDuplicateConflict).toBe(true);
    expect(result.data.locationId).toBe('loc-existing');
    expect(mockOnboardApplication).toHaveBeenCalledTimes(1);
    expect(mockGetStoreSummary).toHaveBeenCalledTimes(2);
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-existing' }, 'token-abc');
  });

  it('should return storeProvisioningInProgress when duplicate onboarding cannot yet be recovered', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());
    mockOnboardApplication.mockRejectedValue(
      new Error('Commerce onboarding API error (409): {"name":"Conflict","details":[{"description":"Duplicated request was detected"}]}'),
    );

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com', storeName: 'Acme Goods' },
      context,
    );

    expect(result.data.storeProvisioningInProgress).toBe(true);
    expect(result.data.retryAfterSeconds).toBeUndefined();
    expect(result.data.message).toContain('do NOT call this tool again');
    expect(result.data.storeName).toBe('Acme Goods');
    expect(mockGetStoreSummary).toHaveBeenCalledTimes(2);
    expect(mockEnableGoDaddyPaymentsApplication).not.toHaveBeenCalled();
  });

  it('should return error after both ADD_STORE attempts fail and store never appears in summary', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    const noNewStoreSummary = createStoreSummaryResponse([
      { storeId: 'store-existing', displayName: 'Acme Goods' },
    ]);
    // initial + 2 recovery checks all return no new store
    mockGetStoreSummary
      .mockResolvedValueOnce(noNewStoreSummary)
      .mockResolvedValueOnce(noNewStoreSummary)
      .mockResolvedValueOnce(noNewStoreSummary);
    mockAddStoreToExistingBusiness.mockRejectedValue(
      new Error('Commerce onboarding API error (409): {"name":"Conflict","details":[{"description":"Duplicated request was detected"}]}'),
    );

    const result = await setupStoreTool.execute(
      { storePreference: 'new', storeName: 'Acme Goods 2' },
      context,
    );

    expect(result.error).toContain('Acme Goods 2');
    expect(result.error).toContain('GoDaddy rejected both attempts');
    expect(mockGetStoreSummary).toHaveBeenCalledTimes(3);
    expect(mockAddStoreToExistingBusiness).toHaveBeenCalledTimes(2);
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockEnableCatalogV2).not.toHaveBeenCalled();
  });

  it('should coalesce concurrent setup_store calls for the same app', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockCreateLocation.mockResolvedValue({
      success: true,
      data: { createLocation: { id: 'loc-default' } },
    });

    let resolveOnboard:
      | ((value: { metadata: { storeId: string; channelId: string } }) => void)
      | undefined;
    const onboardPromise = new Promise<{ metadata: { storeId: string; channelId: string } }>((resolve) => {
      resolveOnboard = resolve;
    });
    mockOnboardApplication.mockReturnValue(onboardPromise);

    const firstCall = setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );
    const secondCall = setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    resolveOnboard?.({ metadata: { storeId: 'store-new', channelId: 'ch-new' } });

    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);

    expect(mockWithCommerceAuth).toHaveBeenCalledTimes(1);
    expect(mockOnboardApplication).toHaveBeenCalledTimes(1);
    expect(firstResult.data.storeId).toBe('store-new');
    expect(secondResult.data.storeId).toBe('store-new');
  });

  it('should not coalesce different setup_store requests for the same app', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-existing', displayName: 'Acme Goods', businessId: 'biz-1' },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-existing' } }], totalCount: 1 } },
    });

    // storePreference: "new" + existing stores → ADD_STORE path
    let resolveAddStore:
      | ((value: { metadata: { storeId: string; channelId: string } }) => void)
      | undefined;
    const addStorePromise = new Promise<{ metadata: { storeId: string; channelId: string } }>((resolve) => {
      resolveAddStore = resolve;
    });
    mockAddStoreToExistingBusiness.mockReturnValue(addStorePromise);

    const createNewCall = setupStoreTool.execute(
      { storePreference: 'new', storeName: 'Acme Goods 2' },
      context,
    );
    const reuseExistingCall = setupStoreTool.execute(
      { storePreference: 'existing' },
      context,
    );

    const reuseExistingOutcome = await Promise.race([
      reuseExistingCall.then((result) => ({ kind: 'resolved' as const, result })),
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 50)),
    ]);

    expect(mockWithCommerceAuth).toHaveBeenCalledTimes(2);
    expect(reuseExistingOutcome.kind).toBe('resolved');
    if (reuseExistingOutcome.kind === 'resolved') {
      expect(reuseExistingOutcome.result.data.storeId).toBe('store-existing');
      expect(reuseExistingOutcome.result.data.created).toBe(false);
    }

    resolveAddStore?.({ metadata: { storeId: 'store-new', channelId: 'ch-new' } });

    const createNewResult = await createNewCall;
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockAddStoreToExistingBusiness).toHaveBeenCalledTimes(1);
    // ADD_STORE returns storeChoiceRequired instead of a bare storeId
    expect(createNewResult.data.created).toBe(true);
    expect(createNewResult.data.storeChoiceRequired).toBe(true);
    expect(createNewResult.data.existingStores).toEqual(expect.arrayContaining([
      expect.objectContaining({ storeId: 'store-new' }),
    ]));
  });

  it('should return needsOwnerIdentity for suspicious owner identity derived from storeName', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());

    const result = await setupStoreTool.execute(
      {
        storeName: 'The Loft Studio',
        firstName: 'Loft',
        lastName: 'Studio',
        email: 'noreply@airoapp.ai',
      },
      context,
    );

    expect(result.data.needsOwnerIdentity).toBe(true);
    expect(result.data.missingFields).toEqual([]);
    expect(result.data.message).toContain('provide a real firstName, lastName, and email');
    expect(result.data.storeName).toBe('The Loft Studio');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should return needsOwnerIdentity when no explicit owner identity is available', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());

    const result = await setupStoreTool.execute(
      { storeName: 'The Rolling Kitchen' },
      context,
    );

    expect(result.data.needsOwnerIdentity).toBe(true);
    expect(result.data.missingFields).toEqual(['firstName', 'lastName', 'email']);
    expect(result.data.message).toBe('Ask the user for firstName, lastName, email before retrying commerce__setup_store.');
    expect(result.data.storeName).toBe('The Rolling Kitchen');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should return needsOwnerIdentity when owner identity is only partially provided', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());
    const result = await setupStoreTool.execute(
      { firstName: 'Dev' },
      context,
    );

    expect(result.data.needsOwnerIdentity).toBe(true);
    expect(result.data.missingFields).toEqual(['lastName', 'email']);
    expect(result.data.message).toBe('Ask the user for lastName, email before retrying commerce__setup_store.');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should return needsOwnerIdentity for a generic mailbox identity derived from the store name', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());
    const result = await setupStoreTool.execute({
      storeName: 'The Loft Studio',
      firstName: 'Loft',
      lastName: 'Studio',
      email: 'info@theloftstudio.com',
    }, context);

    expect(result.data.needsOwnerIdentity).toBe(true);
    expect(result.data.missingFields).toEqual([]);
    expect(result.data.message).toContain('provide a real firstName, lastName, and email');
    expect(result.data.storeName).toBe('The Loft Studio');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should return partial success if Catalog V2 fails', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());
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
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse());
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

  it('should treat GODADDY_SSO_NO_MATCH from getStoreSummary as no existing store and proceed to onboard', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    // Mirrors the real safeJsonParse error shape for a customer who has never
    // had a Commerce store: HTTP 401 + a GODADDY_SSO_NO_MATCH body. Note that
    // safeJsonParse truncates bodies to 200 chars and appends an ellipsis; the
    // body below is short enough to pass through un-truncated, but the
    // detector must tolerate either form.
    mockGetStoreSummary.mockRejectedValue(
      new Error(
        'Commerce API error (getStoreSummary): 401 Unauthorized - {"code":"GODADDY_SSO_NO_MATCH","httpStatus":401,"message":"Unknown GoDaddy user.","developerMessage":"Unknown GoDaddy user.","requestId":"05400ce1-0035-4d90-a7a6-732c0fefc91f"}',
      ),
    );
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

    expect(mockOnboardApplication).toHaveBeenCalled();
    expect(result.data.storeId).toBe('store-new');
    expect(result.data.created).toBe(true);
  });

  it('should return needsOwnerIdentity when getStoreSummary says unknown user and creation fields are missing', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockRejectedValue(
      new Error('Commerce API error (getStoreSummary): 401 Unauthorized - {"code":"GODADDY_SSO_NO_MATCH","message":"Unknown GoDaddy user."}'),
    );

    const result = await setupStoreTool.execute({}, context);

    expect(result.data.needsOwnerIdentity).toBe(true);
    expect(result.data.missingFields).toEqual(['firstName', 'lastName', 'email']);
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should return noExistingStoreFound when storePreference is "existing" and getStoreSummary says unknown user', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockRejectedValue(
      new Error('Commerce API error (getStoreSummary): 401 Unauthorized - {"code":"GODADDY_SSO_NO_MATCH","message":"Unknown GoDaddy user."}'),
    );

    const result = await setupStoreTool.execute(
      { storePreference: 'existing' },
      context,
    );

    expect(result.data.noExistingStoreFound).toBe(true);
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should surface unrelated getStoreSummary errors rather than onboarding over them', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      try {
        const result = await fn('token-abc', 'customer-1');
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
    mockGetStoreSummary.mockRejectedValue(
      new Error('Commerce API error (getStoreSummary): 500 Internal Server Error - boom'),
    );

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.error).toContain('500');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should fail if appId is missing from context', async () => {
    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });

  // ============================================================================
  // Multi-store: storeChoiceRequired returns existingStores array
  // ============================================================================

  it('should auto-proceed with the single store when only one store exists (no storeChoiceRequired)', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-1', displayName: 'Acme Goods', businessId: 'biz-1' },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-1' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute({}, context);

    expect(result.data.storeChoiceRequired).toBeUndefined();
    expect(result.data.storeId).toBe('store-1');
    expect(result.data.locationId).toBe('loc-1');
    expect(result.data.created).toBe(false);
  });

  it('should include all stores in storeChoiceRequired when multiple stores exist', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-1', displayName: 'Acme Goods', businessId: 'biz-1' },
      { storeId: 'store-2', displayName: 'Acme Gifts' },
    ]));

    const result = await setupStoreTool.execute({}, context);

    expect(result.data.storeChoiceRequired).toBe(true);
    expect(result.data.existingStores).toHaveLength(2);
    expect(result.data.existingStores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ storeId: 'store-1', storeName: 'Acme Goods' }),
        expect.objectContaining({ storeId: 'store-2', storeName: 'Acme Gifts' }),
      ]),
    );
    expect(result.data.message).toContain('2 existing');
  });

  // ============================================================================
  // Multi-store: ADD_STORE path (storePreference: "new" with existing stores)
  // ============================================================================

  it('should return needsStoreName when storePreference is "new", stores exist, and no storeName is provided', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-1', displayName: 'Acme Goods', businessId: 'biz-1' },
    ]));

    const result = await setupStoreTool.execute({ storePreference: 'new' }, context);

    expect(result.data.needsStoreName).toBe(true);
    expect(result.data.existingStores).toEqual([{ storeId: 'store-1', storeName: 'Acme Goods', businessId: 'biz-1' }]);
    expect(mockAddStoreToExistingBusiness).not.toHaveBeenCalled();
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should create additional store via ADD_STORE when storePreference is "new" and stores exist', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-1', displayName: 'Acme Goods', businessId: 'biz-1' },
    ]));
    mockAddStoreToExistingBusiness.mockResolvedValue({
      metadata: { storeId: 'store-2', channelId: 'channel-2' },
    });
    mockEnableCatalogV2.mockResolvedValue({ success: true });
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue({ success: true });
    mockGetLocations.mockResolvedValue({ success: true, data: { locations: { edges: [{ node: { id: 'loc-2' } }] } } });

    const result = await setupStoreTool.execute(
      { storePreference: 'new', storeName: 'Acme Gifts' },
      context,
    );

    expect(mockAddStoreToExistingBusiness).toHaveBeenCalledWith(
      { appId: 'app-123', businessId: 'biz-1', storeName: 'Acme Gifts' },
      'token-abc',
    );
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    // ADD_STORE returns storeChoiceRequired so the user picks which store to manage
    expect(result.data.storeChoiceRequired).toBe(true);
    expect(result.data.created).toBe(true);
    expect(result.data.addedToExistingBusiness).toBe(true);
    expect(result.data.paymentsAutoEnabled).toBe(true);
    expect(result.data.existingStores).toEqual(expect.arrayContaining([
      expect.objectContaining({ storeId: 'store-2', storeName: 'Acme Gifts' }),
    ]));
  });

  it('should not require owner identity (firstName/lastName/email) for ADD_STORE path', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-1', displayName: 'Acme Goods', businessId: 'biz-1' },
    ]));
    mockAddStoreToExistingBusiness.mockResolvedValue({
      metadata: { storeId: 'store-2', channelId: 'channel-2' },
    });
    mockEnableCatalogV2.mockResolvedValue({ success: true });
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue({ success: true });
    mockGetLocations.mockResolvedValue({ success: true, data: { locations: { edges: [] } } });
    mockCreateLocation.mockResolvedValue({ success: true, data: { createLocation: { id: 'loc-2' } } });

    const result = await setupStoreTool.execute(
      { storePreference: 'new', storeName: 'Acme Gifts' },
      context,
    );

    expect(result.data.needsOwnerIdentity).toBeUndefined();
    // ADD_STORE returns storeChoiceRequired instead of a bare storeId
    expect(result.data.storeChoiceRequired).toBe(true);
    expect(result.data.existingStores).toEqual(expect.arrayContaining([
      expect.objectContaining({ storeId: 'store-2' }),
    ]));
    expect(mockAddStoreToExistingBusiness).toHaveBeenCalled();
  });

  it('should return error when no businessId is available on existing stores for ADD_STORE', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    // Force a summary response where businessId is absent
    mockGetStoreSummary.mockResolvedValue({
      businesses: [{ stores: [{ storeId: 'store-1', displayName: 'Acme Goods' }] }],
    });

    const result = await setupStoreTool.execute(
      { storePreference: 'new', storeName: 'Acme Gifts' },
      context,
    );

    expect(result.error).toContain('businessId');
    expect(mockAddStoreToExistingBusiness).not.toHaveBeenCalled();
  });

  it('should return error when ADD_STORE 409 persists and store never appears after retry', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    // Initial summary + 2 recovery checks all return no new store
    mockGetStoreSummary.mockResolvedValue(createStoreSummaryResponse([
      { storeId: 'store-1', displayName: 'Acme Goods', businessId: 'biz-1' },
    ]));
    // Both ADD_STORE attempts return 409
    mockAddStoreToExistingBusiness.mockRejectedValue(
      new Error('commerce onboarding api error (409): duplicated request was detected'),
    );

    const result = await setupStoreTool.execute(
      { storePreference: 'new', storeName: 'Acme Gifts' },
      context,
    );

    expect(result.error).toContain('Acme Gifts');
    expect(result.error).toContain('GoDaddy rejected both attempts');
    expect(mockAddStoreToExistingBusiness).toHaveBeenCalledTimes(2);
  });

  // ============================================================================
  // Multi-business: businessChoiceRequired decision matrix
  // ============================================================================

  it('should return businessChoiceRequired when stores span 2+ businesses and no businessId is provided', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createMultiBusinessStoreSummaryResponse([
      { businessId: 'biz-1', legalName: 'Acme Corp', stores: [{ storeId: 'store-1', displayName: 'Acme Goods' }] },
      { businessId: 'biz-2', legalName: 'Beta LLC', stores: [{ storeId: 'store-2', displayName: 'Beta Store' }] },
    ]));

    const result = await setupStoreTool.execute({}, context);

    expect(result.data.businessChoiceRequired).toBe(true);
    expect(result.data.businesses).toHaveLength(2);
    expect(result.data.businesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ businessId: 'biz-1', businessName: 'Acme Corp' }),
        expect.objectContaining({ businessId: 'biz-2', businessName: 'Beta LLC' }),
      ]),
    );
    expect(result.data.message).toContain('2 GoDaddy businesses');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
    expect(mockAddStoreToExistingBusiness).not.toHaveBeenCalled();
  });

  it('should auto-proceed with the scoped store when businessId yields exactly one store', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createMultiBusinessStoreSummaryResponse([
      { businessId: 'biz-1', legalName: 'Acme Corp', stores: [{ storeId: 'store-1', displayName: 'Acme Goods' }] },
      { businessId: 'biz-2', legalName: 'Beta LLC', stores: [{ storeId: 'store-2', displayName: 'Beta Store' }] },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-1' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute({ businessId: 'biz-1' }, context);

    expect(result.data.storeChoiceRequired).toBeUndefined();
    expect(result.data.storeId).toBe('store-1');
    expect(result.data.locationId).toBe('loc-1');
    expect(result.data.created).toBe(false);
    expect(result.data.businessChoiceRequired).toBeUndefined();
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should use the store from the scoped business when businessId + storePreference "existing" are provided', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createMultiBusinessStoreSummaryResponse([
      { businessId: 'biz-1', legalName: 'Acme Corp', stores: [{ storeId: 'store-1', displayName: 'Acme Goods' }] },
      { businessId: 'biz-2', legalName: 'Beta LLC', stores: [{ storeId: 'store-2', displayName: 'Beta Store' }] },
    ]));
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-2' } }], totalCount: 1 } },
    });

    const result = await setupStoreTool.execute({ businessId: 'biz-2', storePreference: 'existing' }, context);

    expect(result.data.storeId).toBe('store-2');
    expect(result.data.created).toBe(false);
    expect(result.data.businessChoiceRequired).toBeUndefined();
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should use the provided businessId for ADD_STORE when multiple businesses exist', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue(createMultiBusinessStoreSummaryResponse([
      { businessId: 'biz-1', legalName: 'Acme Corp', stores: [{ storeId: 'store-1', displayName: 'Acme Goods' }] },
      { businessId: 'biz-2', legalName: 'Beta LLC', stores: [{ storeId: 'store-2', displayName: 'Beta Store' }] },
    ]));
    mockAddStoreToExistingBusiness.mockResolvedValue({
      metadata: { storeId: 'store-3', channelId: 'ch-3' },
    });
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockGetLocations.mockResolvedValue({
      success: true,
      data: { locations: { edges: [{ node: { id: 'loc-3' } }] } },
    });

    const result = await setupStoreTool.execute(
      { businessId: 'biz-1', storePreference: 'new', storeName: 'Acme Premium' },
      context,
    );

    expect(mockAddStoreToExistingBusiness).toHaveBeenCalledWith(
      { appId: 'app-123', businessId: 'biz-1', storeName: 'Acme Premium' },
      'token-abc',
    );
    // ADD_STORE returns storeChoiceRequired so the user picks which store to manage
    expect(result.data.storeChoiceRequired).toBe(true);
    expect(result.data.created).toBe(true);
    expect(result.data.addedToExistingBusiness).toBe(true);
    expect(result.data.existingStores).toEqual(expect.arrayContaining([
      expect.objectContaining({ storeId: 'store-3', storeName: 'Acme Premium' }),
    ]));
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should recover from ADD_STORE 409 when new store appears in summary on first recovery check', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId: string, fn: (token: string, customerId: string) => Promise<unknown>) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary
      .mockResolvedValueOnce(createStoreSummaryResponse([
        { storeId: 'store-1', displayName: 'Acme Goods', businessId: 'biz-1' },
      ]))
      .mockResolvedValueOnce(createStoreSummaryResponse([
        { storeId: 'store-1', displayName: 'Acme Goods', businessId: 'biz-1' },
        { storeId: 'store-2', displayName: 'Acme Gifts', businessId: 'biz-1' },
      ]));
    mockAddStoreToExistingBusiness.mockRejectedValue(
      new Error('commerce onboarding api error (409): duplicated request was detected'),
    );
    mockEnableCatalogV2.mockResolvedValue({ success: true });
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue({ success: true });
    mockGetLocations.mockResolvedValue({ success: true, data: { locations: { edges: [{ node: { id: 'loc-2' } }] } } });

    const result = await setupStoreTool.execute(
      { storePreference: 'new', storeName: 'Acme Gifts' },
      context,
    );

    // 409 first recovery: store was found in summary, returns storeChoiceRequired so user picks
    expect(result.data.storeChoiceRequired).toBe(true);
    expect(result.data.created).toBe(true);
    expect(result.data.addedToExistingBusiness).toBe(true);
    expect(result.data.existingStores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ storeId: 'store-2', storeName: 'Acme Gifts' }),
      ]),
    );
    // Should not retry ADD_STORE since store was found in first recovery check
    expect(mockAddStoreToExistingBusiness).toHaveBeenCalledTimes(1);
  });
});
