/**
 * Tests for POST /api/secrets/[appId]/sync — focused on the aab-multi-user FGA
 * manage-secrets gate. Sync mutates publish-variant secrets (level-3), so the
 * gate firing (and short-circuiting before syncSecrets) must be asserted.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockSyncSecrets,
  mockGetSecrets,
  mockUpdateSecrets,
  mockAgentFetch,
  mockEnforce,
  mockResolveMultiUserFlag,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockSyncSecrets: vi.fn(),
  mockGetSecrets: vi.fn(),
  mockUpdateSecrets: vi.fn(),
  mockAgentFetch: vi.fn(),
  mockEnforce: vi.fn(),
  mockResolveMultiUserFlag: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(() => ({
    getSite: mockGetSite,
    getSecrets: mockGetSecrets,
    updateSecrets: mockUpdateSecrets,
    syncSecrets: mockSyncSecrets,
  })),
}));
vi.mock('@/lib/agent-fetch', () => ({ agentFetch: mockAgentFetch }));
vi.mock('@/lib/agents-base-url', () => ({ resolveAgentsBaseUrl: () => 'https://agents.test' }));
vi.mock('@/lib/authz-fga/enforce-venture-relation', () => ({
  enforceAabMultiUserVentureRelation: mockEnforce,
}));
vi.mock('@/lib/authz-fga/multi-user-flag', () => ({
  resolveMultiUserFlag: mockResolveMultiUserFlag,
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (request: NextRequest, ...args: any[]) =>
    handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: { customerId: 'cust-1' } }, ...args),
  customerHasAccount: () => true,
  createCustomerAuthError: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}));

import { POST } from '../route';

const APP_ID = 'app-secrets-sync-1';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

function postReq(): NextRequest {
  return new NextRequest(`https://airo.test/api/secrets/${APP_ID}/sync`, {
    method: 'POST',
    body: JSON.stringify({ source: 'preview', destination: 'publish' }),
  });
}
const params = { params: Promise.resolve({ appId: APP_ID }) };

describe('POST /api/secrets/[appId]/sync — FGA manage-secrets gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMultiUserFlag.mockResolvedValue(true);
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      agent_url: 'https://agents.test',
      team_venture_id: 'v1',
      owner_customer_id: 'owner-9',
    });
    mockAgentFetch.mockResolvedValue(jsonResponse({ vars: {} }));
    mockGetSecrets.mockResolvedValue({ appId: APP_ID, secrets: [], count: 0 });
    mockUpdateSecrets.mockResolvedValue({
      success: true,
      message: 'Secrets updated successfully',
      operations: { added: 0, updated: 0, deleted: 0 },
    });
    mockSyncSecrets.mockResolvedValue({
      success: true,
      message: 'Secrets synced successfully',
      operations: { added: 0, updated: 0, deleted: 0 },
    });
  });

  it('returns the deny response and does NOT sync when the FGA gate denies', async () => {
    mockEnforce.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    );

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(403);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockAgentFetch).not.toHaveBeenCalled();
    expect(mockSyncSecrets).not.toHaveBeenCalled();
  });

  it('proceeds to sync secrets when the FGA gate allows (null)', async () => {
    mockEnforce.mockResolvedValue(null);

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockAgentFetch).toHaveBeenCalledWith(`https://agents.test/apps/${APP_ID}/publish-env`, {
      siteId: APP_ID,
    });
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
  });

  it('continues to sync when the agents publish-env route is unavailable', async () => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockGetSecrets).not.toHaveBeenCalled();
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'api.secrets.sync.publish-env.unavailable',
      expect.objectContaining({ appId: APP_ID, status: 404 })
    );
  });

  it('continues to sync when agents publish-env fetch fails with a non-ok status', async () => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockResolvedValue(textResponse('temporary agents failure', 503));

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockGetSecrets).not.toHaveBeenCalled();
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'api.secrets.sync.publish-env.fetch_failed',
      expect.objectContaining({ appId: APP_ID, status: 503 })
    );
  });

  it('continues to sync when agents publish-env request throws', async () => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockRejectedValue(new Error('ECONNRESET'));

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockGetSecrets).not.toHaveBeenCalled();
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'api.secrets.sync.publish-env.request_failed',
      expect.objectContaining({ appId: APP_ID, error: 'ECONNRESET' })
    );
  });

  it('continues to sync when agents publish-env response is not JSON', async () => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockResolvedValue(textResponse('not json'));

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockGetSecrets).not.toHaveBeenCalled();
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'api.secrets.sync.publish-env.parse_failed',
      expect.objectContaining({ appId: APP_ID })
    );
  });

  it.each([
    ['vars not an object', { vars: [] }],
    ['invalid env key', { vars: { lowercase_key: 'value' } }],
    ['non-string env value', { vars: { GODADDY_STORE_ID: 123 } }],
    ['update policy not an object', { vars: {}, updateIfCurrentValueIn: [] }],
    ['non-array update policy', { vars: {}, updateIfCurrentValueIn: { GODADDY_STORE_ID: 'store-old' } }],
  ])('continues to sync when agents publish-env response is invalid: %s', async (_label, body) => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockResolvedValue(jsonResponse(body));

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockGetSecrets).not.toHaveBeenCalled();
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'api.secrets.sync.publish-env.parse_failed',
      expect.objectContaining({ appId: APP_ID })
    );
  });

  it('adds missing agent publish env vars to preview before syncing to publish', async () => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockResolvedValue(jsonResponse({
      vars: {
        GODADDY_STORE_ID: 'store-1',
        VITE_GODADDY_STORE_ID: 'store-1',
      },
    }));
    mockGetSecrets.mockResolvedValue({ appId: APP_ID, secrets: [], count: 0 });

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockUpdateSecrets).toHaveBeenCalledWith(APP_ID, 'preview', {
      additions: [
        { name: 'GODADDY_STORE_ID', value: 'store-1' },
        { name: 'VITE_GODADDY_STORE_ID', value: 'store-1' },
      ],
      updates: [],
    }, 'test-jwt');
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
  });

  it('updates stale preview values only when they match allowed managed values', async () => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockResolvedValue(jsonResponse({
      vars: {
        GODADDY_STORE_ID: 'store-new',
      },
      updateIfCurrentValueIn: {
        GODADDY_STORE_ID: ['store-old'],
      },
    }));
    mockGetSecrets.mockResolvedValue({
      appId: APP_ID,
      secrets: [
        {
          name: 'GODADDY_STORE_ID',
          systemManaged: false,
          variants: ['preview'],
          value: 'store-old',
        },
      ],
      count: 1,
    });

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockUpdateSecrets).toHaveBeenCalledWith(APP_ID, 'preview', {
      additions: [],
      updates: [{ name: 'GODADDY_STORE_ID', value: 'store-new' }],
    }, 'test-jwt');
  });

  it('does not shadow a shared secret even when it matches an allowed old value', async () => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockResolvedValue(jsonResponse({
      vars: {
        GODADDY_STORE_ID: 'store-new',
      },
      updateIfCurrentValueIn: {
        GODADDY_STORE_ID: ['store-old'],
      },
    }));
    mockGetSecrets.mockResolvedValue({
      appId: APP_ID,
      secrets: [
        {
          name: 'GODADDY_STORE_ID',
          systemManaged: false,
          variants: ['preview', 'publish'],
          value: 'store-old',
        },
      ],
      count: 1,
    });

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
  });

  it('does not replace a system-managed preview secret even when it matches an allowed old value', async () => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockResolvedValue(jsonResponse({
      vars: {
        GODADDY_STORE_ID: 'store-new',
      },
      updateIfCurrentValueIn: {
        GODADDY_STORE_ID: ['store-old'],
      },
    }));
    mockGetSecrets.mockResolvedValue({
      appId: APP_ID,
      secrets: [
        {
          name: 'GODADDY_STORE_ID',
          systemManaged: true,
          variants: ['preview'],
          value: 'store-old',
        },
      ],
      count: 1,
    });

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
  });

  it('does not clobber a user-modified preview secret', async () => {
    mockEnforce.mockResolvedValue(null);
    mockAgentFetch.mockResolvedValue(jsonResponse({
      vars: {
        GODADDY_STORE_ID: 'store-new',
      },
      updateIfCurrentValueIn: {
        GODADDY_STORE_ID: ['store-old'],
      },
    }));
    mockGetSecrets.mockResolvedValue({
      appId: APP_ID,
      secrets: [
        {
          name: 'GODADDY_STORE_ID',
          systemManaged: false,
          variants: ['preview'],
          value: 'manual-store',
        },
      ],
      count: 1,
    });

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
  });
});
