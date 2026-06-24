import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExtractCustomerId, mockGetConfig, mockGetToken, mockListObjects, mockReconcile, mockAiroCtor } = vi.hoisted(() => ({
  mockExtractCustomerId: vi.fn(),
  mockGetConfig: vi.fn(),
  mockGetToken: vi.fn(),
  mockListObjects: vi.fn(),
  mockReconcile: vi.fn(),
  mockAiroCtor: vi.fn(),
}));

vi.mock('@/lib/utils/jwt-utils', () => ({ extractCustomerId: mockExtractCustomerId }));
vi.mock('@/lib/authz-fga/config', () => ({ getAuthzFgaConfig: mockGetConfig }));
vi.mock('@/lib/authz-fga/oauth-token', () => ({ getAuthzFgaAccessToken: mockGetToken }));
vi.mock('@/lib/authz-fga/list-objects', () => ({ listObjects: mockListObjects }));
vi.mock('@/lib/mgmt-airo', () => ({ AiroMgmtClient: mockAiroCtor }));
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { reconcileInviteeShared } from '@/lib/mgmt-airo/invitee-pull';

// The throttle map is module-private and persists across tests in this file, so
// each test uses a UNIQUE customer id to avoid cross-test throttle bleed.
describe('reconcileInviteeShared', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ baseUrl: 'https://fga', storeId: 's', oauthTokenUrl: 'o', clientId: 'c', clientSecret: 'x' });
    mockGetToken.mockResolvedValue('tok');
    mockListObjects.mockResolvedValue(['venture-1']);
    mockReconcile.mockResolvedValue({ granted: 1, skipped: 0 });
    // Re-establish the constructor impl each test (clearAllMocks wipes it).
    // Assign onto `this` — vitest's `new` on a vi.fn returns the fresh instance,
    // not an object the impl returns.
    mockAiroCtor.mockImplementation(function (this: { reconcileSharedFromVentures: typeof mockReconcile }) {
      this.reconcileSharedFromVentures = mockReconcile;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the caller ventures from FGA and reconciles them via mgmt-airo', async () => {
    mockExtractCustomerId.mockReturnValue('c-happy');
    await reconcileInviteeShared('jwt');
    expect(mockListObjects).toHaveBeenCalledWith(
      expect.anything(),
      'tok',
      expect.objectContaining({ user: 'customer:c-happy', type: 'venture' }),
    );
    expect(mockReconcile).toHaveBeenCalledWith(['venture-1']);
  });

  it('bounds the mgmt-airo client (1 retry, 3s timeout) since the call is awaited on list render', async () => {
    mockExtractCustomerId.mockReturnValue('c-bounded');
    await reconcileInviteeShared('jwt');
    expect(mockAiroCtor).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 1, timeoutMs: 3_000 }),
    );
  });

  it('throttles a second call within the window (no second reconcile)', async () => {
    mockExtractCustomerId.mockReturnValue('c-throttle');
    await reconcileInviteeShared('jwt');
    await reconcileInviteeShared('jwt');
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the jwt has no customer id', async () => {
    mockExtractCustomerId.mockReturnValue(null);
    await reconcileInviteeShared('jwt');
    expect(mockListObjects).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('no-ops (no mgmt call) when FGA is not configured', async () => {
    mockExtractCustomerId.mockReturnValue('c-noconfig');
    mockGetConfig.mockReturnValue(null);
    await reconcileInviteeShared('jwt');
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('does not call mgmt-airo when the caller has no ventures', async () => {
    mockExtractCustomerId.mockReturnValue('c-noventures');
    mockListObjects.mockResolvedValue([]);
    await reconcileInviteeShared('jwt');
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('never throws on upstream failure and applies a short cooldown (not every-load retry)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mockExtractCustomerId.mockReturnValue('c-fail');
    mockReconcile.mockRejectedValue(new Error('mgmt-airo down'));

    await expect(reconcileInviteeShared('jwt')).resolves.toBeUndefined();
    expect(mockReconcile).toHaveBeenCalledTimes(1);

    // Immediately after a failure, still throttled (cooldown not elapsed) — no hammer.
    vi.setSystemTime(1_000);
    await reconcileInviteeShared('jwt');
    expect(mockReconcile).toHaveBeenCalledTimes(1);

    // After the failure cooldown (5s) it retries.
    vi.setSystemTime(6_000);
    await reconcileInviteeShared('jwt');
    expect(mockReconcile).toHaveBeenCalledTimes(2);
  });
});
