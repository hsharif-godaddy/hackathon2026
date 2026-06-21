import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureAppTeamVenture } from '@/lib/authz-fga/ensure-app-venture';

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn(),
}));

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

import { getAuthzFgaConfig } from '@/lib/authz-fga/config';
import { getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token';
import { writeFgaTuples } from '@/lib/authz-fga/write';
import type { SiteInfo } from '@/lib/control-plane/types';
import { V2ControlPlaneAdapter } from '@/lib/control-plane/v2-control-plane-adapter';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { extractShopperId } from '@/lib/utils/jwt-utils';
import { VentureService } from '@/lib/venture-service';

describe('authz-fga/ensure-app-venture', function ensureAppVentureTests() {
  const baseSite: Partial<SiteInfo> = {
    owner_customer_id: 'owner-1',
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

    vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);
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

  it('returns existing venture ID when already set', async function alreadySet() {
    const req = new NextRequest('https://example.com/api/test');
    const result = await ensureAppTeamVenture({
      request: req,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: { ...baseSite, team_venture_id: 'existing-v' } as SiteInfo,
    });
    expect(result).toBe('existing-v');
    expect(checkSwitchboardFlag).not.toHaveBeenCalled();
  });

  it('returns null when aab-multi-user flag is off', async function flagOff() {
    vi.mocked(checkSwitchboardFlag).mockResolvedValue(false);
    const req = new NextRequest('https://example.com/api/test');
    const result = await ensureAppTeamVenture({
      request: req,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: baseSite as SiteInfo,
    });
    expect(result).toBeNull();
    expect(VentureService).not.toHaveBeenCalled();
  });

  it('returns null for non-owner customer', async function nonOwner() {
    const req = new NextRequest('https://example.com/api/test');
    const result = await ensureAppTeamVenture({
      request: req,
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
    const req = new NextRequest('https://example.com/api/test');
    const result = await ensureAppTeamVenture({
      request: req,
      siteId: 's1',
      customerId: 'owner-1',
      jwt: 'tok',
      siteInfo: baseSite as SiteInfo,
    });
    expect(result).toBeNull();
    expect(VentureService).not.toHaveBeenCalled();
  });

  it('creates venture and writes back to control plane for owner', async function creates() {
    const req = new NextRequest('https://example.com/api/test');
    const result = await ensureAppTeamVenture({
      request: req,
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

    const req = new NextRequest('https://example.com/api/test');
    const result = await ensureAppTeamVenture({
      request: req,
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

    const req = new NextRequest('https://example.com/api/test');
    const result = await ensureAppTeamVenture({
      request: req,
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

    const req = new NextRequest('https://example.com/api/test');
    const result = await ensureAppTeamVenture({
      request: req,
      siteId: 's1',
      customerId: 'any-user',
      jwt: 'tok',
      siteInfo: {} as SiteInfo,
    });
    expect(result).toBeNull();
    expect(mockCreateVenture).not.toHaveBeenCalled();
  });
});
