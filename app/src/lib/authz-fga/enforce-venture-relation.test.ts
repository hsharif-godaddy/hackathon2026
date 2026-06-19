import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enforceAabMultiUserVentureRelation } from '@/lib/authz-fga/enforce-venture-relation';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';

vi.mock('@/lib/authz-fga/list-objects', () => ({
  listObjects: vi.fn(),
}));

vi.mock('@/lib/authz-fga/config', () => ({
  getAuthzFgaConfig: vi.fn(),
  isAuthzFgaLocalMock: vi.fn(() => false),
}));

vi.mock('@/lib/authz-fga/oauth-token', () => ({
  getAuthzFgaAccessToken: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn(),
}));

import { getAuthzFgaConfig } from '@/lib/authz-fga/config';
import { listObjects } from '@/lib/authz-fga/list-objects';
import { getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token';
import type { SiteInfo } from '@/lib/control-plane/types';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

describe('authz-fga/enforce-venture-relation', function enforceVentureRelationTests() {
  const baseSite = {
    team_venture_id: 'v1',
    owner_customer_id: 'owner-1',
  };

  beforeEach(function resetMocks() {
    vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);
    vi.mocked(getAuthzFgaConfig).mockReturnValue({
      baseUrl: 'https://fga.example.test',
      storeId: 'store-1',
      oauthTokenUrl: 'https://oauth.example.test',
      clientId: 'c',
      clientSecret: 's',
    });
    vi.mocked(getAuthzFgaAccessToken).mockResolvedValue('tok');
    // Default: listObjects returns the venture (allowed)
    vi.mocked(listObjects).mockResolvedValue(['v1']);
  });

  afterEach(function cleanup() {
    vi.clearAllMocks();
  });

  it('returns null when aab-multi-user switchboard is off', async function switchboardOff() {
    vi.mocked(checkSwitchboardFlag).mockResolvedValue(false);
    const req = new NextRequest('https://example.com/api/test');
    const res = await enforceAabMultiUserVentureRelation({
      request: req,
      siteId: 's1',
      customerId: 'u1',
      siteInfo: baseSite as SiteInfo,
      relation: AUTHZ_FGA_RELATIONS.canPublish,
      forbiddenMessage: 'no',
    });
    expect(res).toBeNull();
    expect(getAuthzFgaConfig).not.toHaveBeenCalled();
  });

  it('returns null for owner customer without calling FGA', async function ownerBypass() {
    const req = new NextRequest('https://example.com/api/test');
    const res = await enforceAabMultiUserVentureRelation({
      request: req,
      siteId: 's1',
      customerId: 'owner-1',
      siteInfo: baseSite as SiteInfo,
      relation: AUTHZ_FGA_RELATIONS.canPublish,
      forbiddenMessage: 'no',
    });
    expect(res).toBeNull();
    expect(listObjects).not.toHaveBeenCalled();
  });

  it('returns 403 when FGA denies (venture not in listObjects result)', async function fgaDeny() {
    vi.mocked(listObjects).mockResolvedValue([]); // venture not accessible
    const req = new NextRequest('https://example.com/api/test');
    const res = await enforceAabMultiUserVentureRelation({
      request: req,
      siteId: 's1',
      customerId: 'editor-1',
      siteInfo: baseSite as SiteInfo,
      relation: AUTHZ_FGA_RELATIONS.canManageSecrets,
      forbiddenMessage: 'Denied.',
    });
    expect(res?.status).toBe(403);
    const body = await res!.json();
    expect(body.message).toBe('Denied.');
  });

  it('returns null when FGA allows (venture in listObjects result)', async function fgaAllow() {
    vi.mocked(listObjects).mockResolvedValue(['v1']); // venture accessible
    const req = new NextRequest('https://example.com/api/test');
    const res = await enforceAabMultiUserVentureRelation({
      request: req,
      siteId: 's1',
      customerId: 'editor-1',
      siteInfo: baseSite as SiteInfo,
      relation: AUTHZ_FGA_RELATIONS.canBuild,
      forbiddenMessage: 'Denied.',
    });
    expect(res).toBeNull();
  });

  // Security: when owner_customer_id is absent we must NOT fail open. The gate
  // falls through to the FGA check instead of granting the relation.
  it('returns 403 when owner_customer_id is missing and FGA denies (fail closed)', async function noOwnerFailClosed() {
    vi.mocked(listObjects).mockResolvedValue([]); // caller has no relation on the venture
    const req = new NextRequest('https://example.com/api/test');
    const res = await enforceAabMultiUserVentureRelation({
      request: req,
      siteId: 's1',
      customerId: 'editor-1',
      siteInfo: { team_venture_id: 'v1' } as SiteInfo, // no owner_customer_id
      relation: AUTHZ_FGA_RELATIONS.canPublish,
      forbiddenMessage: 'Denied.',
    });
    expect(res?.status).toBe(403);
    expect(listObjects).toHaveBeenCalled();
  });

  it('returns null when owner_customer_id is missing but FGA grants (legit owner tuple)', async function noOwnerButFgaAllows() {
    vi.mocked(listObjects).mockResolvedValue(['v1']); // owner tuple resolves the relation
    const req = new NextRequest('https://example.com/api/test');
    const res = await enforceAabMultiUserVentureRelation({
      request: req,
      siteId: 's1',
      customerId: 'owner-1',
      siteInfo: { team_venture_id: 'v1' } as SiteInfo, // no owner_customer_id
      relation: AUTHZ_FGA_RELATIONS.canPublish,
      forbiddenMessage: 'Denied.',
    });
    expect(res).toBeNull();
  });

  // Security: a non-owner with no team_venture_id must fail CLOSED (there's no
  // venture to verify the relation against). Owners short-circuit earlier via
  // owner_customer_id, so this only ever denies non-owners.
  it('returns 403 (no FGA call) when a non-owner has no team_venture_id', async function noVentureFailClosed() {
    vi.mocked(listObjects).mockResolvedValue(['v1']);
    const req = new NextRequest('https://example.com/api/test');
    const res = await enforceAabMultiUserVentureRelation({
      request: req,
      siteId: 's1',
      customerId: 'editor-1',
      siteInfo: { owner_customer_id: 'owner-1' } as SiteInfo, // non-owner, no team_venture_id
      relation: AUTHZ_FGA_RELATIONS.canPublish,
      forbiddenMessage: 'Denied.',
    });
    expect(res?.status).toBe(403);
    expect(listObjects).not.toHaveBeenCalled();
  });
});
