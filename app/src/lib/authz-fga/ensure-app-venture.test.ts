import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureAppTeamVenture } from '@/lib/authz-fga/ensure-app-venture';

vi.mock('@/lib/utils/jwt-utils', () => ({
  extractShopperId: vi.fn(),
}));

vi.mock('@/lib/venture-service', () => ({
  // Regular function (not arrow): the source does `new VentureService()`, and
  // under vitest 4.x an arrow-fn mockImplementation throws "is not a constructor".
  VentureService: vi.fn().mockImplementation(function () {
    return { createProfileForShopper: vi.fn(), getOrCreateVentureForCustomer: vi.fn() };
  }),
}));

vi.mock('@/lib/control-plane/v2-control-plane-adapter', () => ({
  V2ControlPlaneAdapter: vi.fn().mockImplementation(function () {
    return { updateSiteVariables: vi.fn() };
  }),
}));

// FGA owner-tuple write path. Default-mocked so the existing tests no-op the
// tuple write (getAuthzFgaConfig → undefined ⇒ writeOwnerTupleBestEffort returns
// early), matching the real behavior when FGA env is unset under test.
vi.mock('@/lib/authz-fga/config', () => ({
  getAuthzFgaConfig: vi.fn(),
}));

vi.mock('@/lib/authz-fga/oauth-token', () => ({
  getAuthzFgaAccessToken: vi.fn(),
}));

vi.mock('@/lib/authz-fga/write', () => ({
  writeFgaTuples: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/mgmt-airo/set-venture-mapping', () => ({
  setAppVentureMappingBestEffort: vi.fn(),
}));

import { getAuthzFgaConfig } from '@/lib/authz-fga/config';
import { getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token';
import { writeFgaTuples } from '@/lib/authz-fga/write';
import type { SiteInfo } from '@/lib/control-plane/types';
import { V2ControlPlaneAdapter } from '@/lib/control-plane/v2-control-plane-adapter';
import { setAppVentureMappingBestEffort } from '@/lib/mgmt-airo/set-venture-mapping';
import { extractShopperId } from '@/lib/utils/jwt-utils';
import { VentureService } from '@/lib/venture-service';

describe('authz-fga/ensure-app-venture', function ensureAppVentureTests() {
  const baseSite: Partial<SiteInfo> = {
    owner_customer_id: 'owner-1',
    subscription_id: 'sub-1',
  };

  // Cache and stub the Product Graph cert env vars. ensureAppTeamVenture has
  // a `hasProductGraphCert()` guard that returns null if neither the inline
  // PEM (GRAPHQL_CLIENT_CERT/KEY) nor a path pair (GRAPHQL_CLIENT_CERT_PATH/
  // GRAPHQL_CLIENT_KEY_PATH) is set. The test asserts the venture-creation
  // happy path, so we set the path pair to non-empty stubs — the guard only
  // checks env presence, not file readability, and VentureService is mocked.
  const originalCertPath = process.env.GRAPHQL_CLIENT_CERT_PATH;
  const originalKeyPath = process.env.GRAPHQL_CLIENT_KEY_PATH;

  beforeEach(function setup() {
    process.env.GRAPHQL_CLIENT_CERT_PATH = '/tmp/test-cert.pem';
    process.env.GRAPHQL_CLIENT_KEY_PATH = '/tmp/test-key.pem';

    vi.mocked(extractShopperId).mockReturnValue('shopper-1');

    const mockCreateVenture = vi.fn().mockResolvedValue('venture-abc');
    vi.mocked(VentureService).mockImplementation(function () {
      return {
        createProfileForShopper: mockCreateVenture,
        getOrCreateVentureForCustomer: vi.fn(),
        getCustomerProjects: vi.fn(),
      } as unknown as VentureService;
    });

    const mockUpdateVars = vi.fn().mockResolvedValue({});
    vi.mocked(V2ControlPlaneAdapter).mockImplementation(function () {
      return { updateSiteVariables: mockUpdateVars } as unknown as V2ControlPlaneAdapter;
    });
  });

  afterEach(function cleanup() {
    vi.clearAllMocks();
    if (originalCertPath === undefined) {
      delete process.env.GRAPHQL_CLIENT_CERT_PATH;
    } else {
      process.env.GRAPHQL_CLIENT_CERT_PATH = originalCertPath;
    }
    if (originalKeyPath === undefined) {
      delete process.env.GRAPHQL_CLIENT_KEY_PATH;
    } else {
      process.env.GRAPHQL_CLIENT_KEY_PATH = originalKeyPath;
    }
  });

  it('returns existing venture ID and backfills the venture->app mapping for the owner', async function alreadySetOwner() {
    // An app whose venture already exists may be missing its mgmt-airo mapping
    // (created before this write existed). The owner opening the app re-asserts it
    // as a backstop so invitee-pull can resolve the venture even with the owner
    // later offline. No re-mint.
    const result = await ensureAppTeamVenture({
      multiUserEnabled: true,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: { ...baseSite, team_venture_id: 'existing-v' } as SiteInfo,
    });
    expect(result).toBe('existing-v');
    expect(VentureService).not.toHaveBeenCalled();
    expect(setAppVentureMappingBestEffort).toHaveBeenCalledWith({
      jwt: 'tok',
      appId: 's1',
      subscriptionId: 'sub-1',
      ventureId: 'existing-v',
    });
  });

  it('does NOT backfill the mapping for a non-owner opening an existing-venture app', async function alreadySetNonOwner() {
    // mgmt-airo's SetVenture is owner-only, so writing as a collaborator would just
    // 403. The early return stays cheap for non-owners (short-circuits at the
    // owner check before the flag is even considered).
    const result = await ensureAppTeamVenture({
      multiUserEnabled: true,
      siteId: 's1',
      customerId: 'collaborator-1',
      jwt: 'tok',
      siteInfo: { ...baseSite, team_venture_id: 'existing-v' } as SiteInfo,
    });
    expect(result).toBe('existing-v');
    expect(setAppVentureMappingBestEffort).not.toHaveBeenCalled();
  });

  it('does NOT backfill the mapping when aab-multi-user is off', async function alreadySetFlagOff() {
    const result = await ensureAppTeamVenture({
      multiUserEnabled: false,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: { ...baseSite, team_venture_id: 'existing-v' } as SiteInfo,
    });
    expect(result).toBe('existing-v');
    expect(setAppVentureMappingBestEffort).not.toHaveBeenCalled();
  });

  it('returns null when aab-multi-user flag is off', async function flagOff() {
    const result = await ensureAppTeamVenture({
      multiUserEnabled: false,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: baseSite as SiteInfo,
    });
    expect(result).toBeNull();
    expect(VentureService).not.toHaveBeenCalled();
  });

  it('returns null for non-owner customer', async function nonOwner() {
    const result = await ensureAppTeamVenture({
      multiUserEnabled: true,
      siteId: 's1',
      customerId: 'collaborator-1',
      jwt: 'tok',
      siteInfo: baseSite as SiteInfo,
    });
    expect(result).toBeNull();
    expect(VentureService).not.toHaveBeenCalled();
  });

  it('returns null when shopperId cannot be extracted', async function noShopper() {
    vi.mocked(extractShopperId).mockReturnValue(null);
    const result = await ensureAppTeamVenture({
      multiUserEnabled: true,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: baseSite as SiteInfo,
    });
    expect(result).toBeNull();
    expect(VentureService).not.toHaveBeenCalled();
  });

  it('creates venture and writes back to control plane for owner', async function creates() {
    const result = await ensureAppTeamVenture({
      multiUserEnabled: true,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: baseSite as SiteInfo,
    });
    expect(result).toBe('venture-abc');

    const ventureInstance = vi.mocked(VentureService).mock.results[0].value;
    expect(ventureInstance.createProfileForShopper).toHaveBeenCalledWith('shopper-1');

    const adapterInstance = vi.mocked(V2ControlPlaneAdapter).mock.results[0].value;
    expect(adapterInstance.updateSiteVariables).toHaveBeenCalledWith(
      's1',
      { aabTeamVentureId: 'venture-abc' },
      'tok',
    );

    // The venture->app mapping is recorded on creation so invitee-pull can resolve
    // the freshly minted venture without waiting for the owner to reopen the app.
    expect(setAppVentureMappingBestEffort).toHaveBeenCalledWith({
      jwt: 'tok',
      appId: 's1',
      subscriptionId: 'sub-1',
      ventureId: 'venture-abc',
    });
  });

  it('writes the owner FGA tuple before persisting the venture id (survives an updateSiteVariables failure)', async function tupleBeforePersist() {
    // The owner tuple is the authoritative ownership proof the FGA gate falls
    // back to once the owner_customer_id stamp is cleared. It must be written as
    // soon as the venture exists — even if persisting team_venture_id then fails
    // — so a persist hiccup can't leave the owner with no tuple and no stamp.
    vi.mocked(getAuthzFgaConfig).mockReturnValue({
      baseUrl: 'https://fga.test',
      storeId: 'store-1',
      oauthTokenUrl: 'https://oauth.test',
      clientId: 'c',
      clientSecret: 's',
    });
    vi.mocked(getAuthzFgaAccessToken).mockResolvedValue('fga-token');

    const mockUpdateVars = vi.fn().mockRejectedValue(new Error('control plane 5xx'));
    vi.mocked(V2ControlPlaneAdapter).mockImplementation(function () {
      return { updateSiteVariables: mockUpdateVars } as unknown as V2ControlPlaneAdapter;
    });

    const result = await ensureAppTeamVenture({
      multiUserEnabled: true,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: baseSite as SiteInfo,
    });

    // Persist failed, so no venture id is returned this pass...
    expect(result).toBeNull();
    // ...but the owner tuple was already written against the new venture, before
    // the failing persist — proving the reordering.
    expect(writeFgaTuples).toHaveBeenCalledWith(
      expect.anything(),
      'fga-token',
      {
        writes: [
          { user: 'customer:owner-1', relation: 'owner', object: 'venture:venture-abc' },
        ],
      },
    );
    expect(mockUpdateVars).toHaveBeenCalled();
  });

  it('returns null on Product Graph failure (non-fatal)', async function pgFailure() {
    const mockCreateVenture = vi.fn().mockRejectedValue(new Error('PG down'));
    vi.mocked(VentureService).mockImplementation(function () {
      return {
        createProfileForShopper: mockCreateVenture,
        getOrCreateVentureForCustomer: vi.fn(),
        getCustomerProjects: vi.fn(),
      } as unknown as VentureService;
    });

    const result = await ensureAppTeamVenture({
      multiUserEnabled: true,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: baseSite as SiteInfo,
    });
    expect(result).toBeNull();
  });

  it('returns null (fail closed) when owner_customer_id is not set on siteInfo', async function noOwnerField() {
    // Without a known owner we cannot verify ownership, so we must not mint a
    // venture (would create an orphan bound to the wrong customer on a race /
    // brand-new app). The next request, once getSite returns the owner, creates it.
    const mockCreateVenture = vi.fn();
    vi.mocked(VentureService).mockImplementation(function () {
      return {
        createProfileForShopper: mockCreateVenture,
        getOrCreateVentureForCustomer: vi.fn(),
        getCustomerProjects: vi.fn(),
      } as unknown as VentureService;
    });

    const result = await ensureAppTeamVenture({
      multiUserEnabled: true,
      siteId: 's1',
      customerId: 'any-user',
      jwt: 'tok',
      siteInfo: {} as SiteInfo,
    });
    expect(result).toBeNull();
    expect(mockCreateVenture).not.toHaveBeenCalled();
  });
});
