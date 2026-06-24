import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FgaTupleKey } from '@/lib/authz-fga/check';

const mockGrantCollaborator = vi.fn();
const mockRevokeCollaborator = vi.fn();
const mockListCollaborators = vi.fn();
const mockGetAuthzFgaConfig = vi.fn();
const mockGetAuthzFgaAccessToken = vi.fn();
const mockListObjects = vi.fn();
const mockListUsers = vi.fn();
const mockSetAppVentureMapping = vi.fn();

vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: class {
    grantCollaborator(...args: unknown[]): Promise<unknown> {
      return mockGrantCollaborator(...args);
    }
    revokeCollaborator(...args: unknown[]): Promise<unknown> {
      return mockRevokeCollaborator(...args);
    }
    listCollaborators(...args: unknown[]): Promise<unknown> {
      return mockListCollaborators(...args);
    }
  },
}));
vi.mock('@/lib/authz-fga/config', () => ({
  getAuthzFgaConfig: (...args: unknown[]) => mockGetAuthzFgaConfig(...args),
}));
vi.mock('@/lib/authz-fga/oauth-token', () => ({
  getAuthzFgaAccessToken: (...args: unknown[]) => mockGetAuthzFgaAccessToken(...args),
}));
vi.mock('@/lib/authz-fga/list-objects', () => ({
  listObjects: (...args: unknown[]) => mockListObjects(...args),
}));
vi.mock('@/lib/authz-fga/list-users', () => ({
  listUsers: (...args: unknown[]) => mockListUsers(...args),
}));
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/mgmt-airo/set-venture-mapping', () => ({
  setAppVentureMappingBestEffort: (...args: unknown[]) => mockSetAppVentureMapping(...args),
}));

import { reconcileCollaboratorsFromFga, syncCollaboratorsToMgmtAiro } from './collaborator-sync';

function write(customerId: string, relation = 'airo_app_build'): FgaTupleKey {
  return { user: `customer:${customerId}`, relation, object: 'venture:ven-1' };
}

/**
 * Drive listUsers per relation so the per-capability derivation is meaningful.
 * Each sensitive capability maps 1:1 to an FGA permission; the resolver stores
 * the EXACT set a member holds. `view` is the read-only floor (any other
 * relation, e.g. airo_app_view, with no elevated capability).
 */
function setFgaMembers(opts: {
  view?: string[];
  publish?: string[];
  secrets?: string[];
  domains?: string[];
  download?: string[];
}) {
  mockListUsers.mockImplementation((_cfg: unknown, _token: unknown, params: { relation: string }) => {
    switch (params.relation) {
      case 'airo_app_publish':
        return Promise.resolve(opts.publish ?? []);
      case 'airo_app_manage_secrets':
        return Promise.resolve(opts.secrets ?? []);
      case 'airo_app_manage_domains':
        return Promise.resolve(opts.domains ?? []);
      case 'airo_app_download':
        return Promise.resolve(opts.download ?? []);
      default:
        return Promise.resolve(opts.view ?? []);
    }
  });
}

const base = {
  jwt: 'owner-jwt',
  appId: 'app-1',
  subscriptionId: 'sub-1',
  teamVentureId: 'ven-1',
};

describe('syncCollaboratorsToMgmtAiro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGrantCollaborator.mockResolvedValue({ collaborator: {} });
    mockRevokeCollaborator.mockResolvedValue({ success: true });
    mockListCollaborators.mockResolvedValue({ collaborators: [] });
    mockGetAuthzFgaConfig.mockReturnValue({ baseUrl: 'https://fga', storeId: 's' });
    mockGetAuthzFgaAccessToken.mockResolvedValue('fga-token');
    mockListObjects.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([]);
  });

  it('grants once per unique invitee and reports success', async () => {
    const result = await syncCollaboratorsToMgmtAiro({
      ...base,
      // c1 has two relations (one customer), c2 has one — expect 2 grants total.
      writes: [write('c1', 'airo_app_build'), write('c1', 'airo_app_view'), write('c2')],
      deletes: [],
    });
    expect(mockGrantCollaborator).toHaveBeenCalledTimes(2);
    // No elevated tuples → both get the read-only `view` floor.
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'c1', role: 'view' });
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'c2', role: 'view' });
    expect(mockRevokeCollaborator).not.toHaveBeenCalled();
    expect(result).toEqual({ grantFailures: 0, granted: 2 });
    // The venture->app mapping is recorded so invitee-pull resolves this venture
    // even after the owner goes offline.
    expect(mockSetAppVentureMapping).toHaveBeenCalledWith({
      jwt: 'owner-jwt',
      appId: 'app-1',
      subscriptionId: 'sub-1',
      ventureId: 'ven-1',
    });
  });

  it('does NOT write the mapping when there is nothing to sync', async () => {
    await syncCollaboratorsToMgmtAiro({ ...base, writes: [], deletes: [] });
    expect(mockSetAppVentureMapping).not.toHaveBeenCalled();
  });

  it('derives the exact capability set from venture FGA permissions', async () => {
    setFgaMembers({
      publish: ['boss', 'mgr'],
      secrets: ['boss'],
      domains: ['boss'],
      download: ['boss', 'mgr'],
    });
    await syncCollaboratorsToMgmtAiro({
      ...base,
      writes: [write('boss'), write('mgr'), write('emp')],
      deletes: [],
    });
    // Tokens are emitted in a fixed order: publish, secrets, domains, download.
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'boss', role: 'publish,secrets,domains,download' });
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'mgr', role: 'publish,download' });
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'emp', role: 'view' });
  });

  it('honors a CUSTOM capability combination (domains + download, no publish/secrets)', async () => {
    setFgaMembers({ domains: ['cust'], download: ['cust'] });
    await syncCollaboratorsToMgmtAiro({ ...base, writes: [write('cust')], deletes: [] });
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'cust', role: 'domains,download' });
  });

  it('fails the grants (for retry) when capability derivation fails instead of writing a default', async () => {
    mockListUsers.mockRejectedValue(new Error('fga down'));
    const result = await syncCollaboratorsToMgmtAiro({ ...base, writes: [write('c1'), write('c2')], deletes: [] });
    expect(mockGrantCollaborator).not.toHaveBeenCalled();
    expect(result).toEqual({ grantFailures: 2, granted: 0 });
  });

  it('counts grant failures without throwing', async () => {
    mockGrantCollaborator.mockRejectedValue(new Error('mgmt-airo 502'));
    const result = await syncCollaboratorsToMgmtAiro({ ...base, writes: [write('c1')], deletes: [] });
    expect(result).toEqual({ grantFailures: 1, granted: 0 });
  });

  it('reports all grants as failed when the subscription id is missing (no client call)', async () => {
    const result = await syncCollaboratorsToMgmtAiro({
      ...base,
      subscriptionId: undefined,
      writes: [write('c1'), write('c2')],
      deletes: [],
    });
    expect(mockGrantCollaborator).not.toHaveBeenCalled();
    expect(result).toEqual({ grantFailures: 2, granted: 0 });
  });

  it('revokes a removed collaborator who no longer holds view access', async () => {
    mockListObjects.mockResolvedValue([]); // no remaining ventures
    await syncCollaboratorsToMgmtAiro({ ...base, writes: [], deletes: [write('c9')] });
    expect(mockRevokeCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', 'c9');
  });

  it('does NOT revoke on a role downgrade where the member retains view access', async () => {
    mockListObjects.mockResolvedValue(['ven-1']); // still has view on this venture
    await syncCollaboratorsToMgmtAiro({ ...base, writes: [], deletes: [write('c9', 'airo_app_publish')] });
    expect(mockRevokeCollaborator).not.toHaveBeenCalled();
  });

  it('does NOT revoke a customer who is also in writes (role change, not removal)', async () => {
    const result = await syncCollaboratorsToMgmtAiro({
      ...base,
      writes: [write('c9', 'airo_app_build')],
      deletes: [write('c9', 'airo_app_publish')],
    });
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'c9', role: 'view' });
    expect(mockRevokeCollaborator).not.toHaveBeenCalled();
    expect(result.granted).toBe(1);
  });
});

describe('reconcileCollaboratorsFromFga', () => {
  const rbase = {
    jwt: 'owner-jwt',
    appId: 'app-1',
    subscriptionId: 'sub-1',
    teamVentureId: 'ven-1',
    ownerCustomerId: 'owner-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGrantCollaborator.mockResolvedValue({ collaborator: {} });
    mockRevokeCollaborator.mockResolvedValue({ success: true });
    mockListCollaborators.mockResolvedValue({ collaborators: [] });
    mockGetAuthzFgaConfig.mockReturnValue({ baseUrl: 'https://fga', storeId: 's' });
    mockGetAuthzFgaAccessToken.mockResolvedValue('fga-token');
    mockListUsers.mockResolvedValue([]);
  });

  it('grants a row for every venture member except the owner', async () => {
    setFgaMembers({ view: ['c1', 'c2', 'owner-1'] });
    const result = await reconcileCollaboratorsFromFga(rbase);
    expect(mockGrantCollaborator).toHaveBeenCalledTimes(2);
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'c1', role: 'view' });
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'c2', role: 'view' });
    expect(result).toEqual({ members: 2, granted: 2, grantFailures: 0, revoked: 0, revokeFailures: 0, grantErrors: [], revokeErrors: [] });
    // The owner-side reconcile is the real invite bridge, so it also records the
    // venture->app mapping for invitee-pull.
    expect(mockSetAppVentureMapping).toHaveBeenCalledWith({
      jwt: 'owner-jwt',
      appId: 'app-1',
      subscriptionId: 'sub-1',
      ventureId: 'ven-1',
    });
  });

  it('writes the FGA-derived capability set on each reconciled member', async () => {
    setFgaMembers({
      view: ['boss', 'mgr', 'emp', 'owner-1'],
      publish: ['boss', 'mgr'],
      secrets: ['boss'],
      domains: ['boss'],
      download: ['boss', 'mgr'],
    });
    await reconcileCollaboratorsFromFga(rbase);
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'boss', role: 'publish,secrets,domains,download' });
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'mgr', role: 'publish,download' });
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'emp', role: 'view' });
  });

  it('excludes the owner case-insensitively and dedupes', async () => {
    setFgaMembers({ view: ['OWNER-1', 'c1', 'c1'] });
    const result = await reconcileCollaboratorsFromFga(rbase);
    expect(mockGrantCollaborator).toHaveBeenCalledTimes(1);
    expect(mockGrantCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', { collaboratorCustomerId: 'c1', role: 'view' });
    expect(result.members).toBe(1);
  });

  it('revokes a row for a customer no longer in the venture (owner removed them)', async () => {
    setFgaMembers({ view: ['c1'] }); // c2 was removed in the Team panel
    mockListCollaborators.mockResolvedValue({
      collaborators: [
        { customerId: 'c1', subscriptionId: 'sub-1', appId: 'app-1', role: 'editor' },
        { customerId: 'c2', subscriptionId: 'sub-1', appId: 'app-1', role: 'editor' },
      ],
    });
    const result = await reconcileCollaboratorsFromFga(rbase);
    expect(mockRevokeCollaborator).toHaveBeenCalledTimes(1);
    expect(mockRevokeCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', 'c2');
    expect(result).toEqual({ members: 1, granted: 1, grantFailures: 0, revoked: 1, revokeFailures: 0, grantErrors: [], revokeErrors: [] });
  });

  it('never revokes the owner row and keeps current members', async () => {
    setFgaMembers({ view: ['c1'] });
    mockListCollaborators.mockResolvedValue({
      collaborators: [
        { customerId: 'c1', subscriptionId: 'sub-1', appId: 'app-1', role: 'editor' },
        { customerId: 'OWNER-1', subscriptionId: 'sub-1', appId: 'app-1', role: 'owner' },
      ],
    });
    await reconcileCollaboratorsFromFga(rbase);
    expect(mockRevokeCollaborator).not.toHaveBeenCalled();
  });

  it('revokes all rows when every member was removed', async () => {
    setFgaMembers({ view: ['owner-1'] }); // only the owner remains in FGA
    mockListCollaborators.mockResolvedValue({
      collaborators: [{ customerId: 'c1', subscriptionId: 'sub-1', appId: 'app-1', role: 'editor' }],
    });
    const result = await reconcileCollaboratorsFromFga(rbase);
    expect(mockGrantCollaborator).not.toHaveBeenCalled();
    expect(mockRevokeCollaborator).toHaveBeenCalledWith('sub-1', 'app-1', 'c1');
    expect(result.revoked).toBe(1);
  });

  it('skips revoke when the collaborator-list read fails (never strips on bad data)', async () => {
    setFgaMembers({ view: ['c1'] });
    mockListCollaborators.mockRejectedValue(new Error('list failed'));
    const result = await reconcileCollaboratorsFromFga(rbase);
    expect(mockRevokeCollaborator).not.toHaveBeenCalled();
    expect(result).toEqual({ members: 1, granted: 1, grantFailures: 0, revoked: 0, revokeFailures: 0, grantErrors: [], revokeErrors: [] });
  });

  it('counts grant failures without throwing', async () => {
    setFgaMembers({ view: ['c1'] });
    mockGrantCollaborator.mockRejectedValue(new Error('mgmt-airo 502'));
    const result = await reconcileCollaboratorsFromFga(rbase);
    expect(result).toEqual({ members: 1, granted: 0, grantFailures: 1, revoked: 0, revokeFailures: 0, grantErrors: ['c1: mgmt-airo 502'], revokeErrors: [] });
  });

  it('no-ops (no grants) when there are no members', async () => {
    setFgaMembers({ view: ['owner-1'] }); // only the owner
    const result = await reconcileCollaboratorsFromFga(rbase);
    expect(mockGrantCollaborator).not.toHaveBeenCalled();
    expect(result).toEqual({ members: 0, granted: 0, grantFailures: 0, revoked: 0, revokeFailures: 0, grantErrors: [], revokeErrors: [] });
  });

  it('returns empty without calling FGA when subscription or venture is missing', async () => {
    const result = await reconcileCollaboratorsFromFga({ ...rbase, teamVentureId: undefined });
    expect(mockListUsers).not.toHaveBeenCalled();
    expect(mockGrantCollaborator).not.toHaveBeenCalled();
    expect(result).toEqual({ members: 0, granted: 0, grantFailures: 0, revoked: 0, revokeFailures: 0 });
  });

  it('returns empty when the FGA list-users read fails (no grants/revokes)', async () => {
    mockListUsers.mockRejectedValue(new Error('fga down'));
    const result = await reconcileCollaboratorsFromFga(rbase);
    expect(mockGrantCollaborator).not.toHaveBeenCalled();
    expect(mockRevokeCollaborator).not.toHaveBeenCalled();
    expect(result).toEqual({ members: 0, granted: 0, grantFailures: 0, revoked: 0, revokeFailures: 0 });
  });
});
