/**
 * BFF `POST /api/apps/[id]/sso-config` route tests.
 *
 * Pins the contract between the form payload (`client_id`, `client_secret`)
 * and the airo-go customer-proxy `updateSecrets` call. Asserts: IDOR +
 * owner guards, server-authoritative ssoConfigId, sso_config_id mismatch,
 * dynamic pointer-name resolution (from SiteInfo), and fail-safe error
 * paths (404/400/502 mappings).
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUpdateSecrets, mockGetSite, mockLogger } = vi.hoisted(() => ({
  mockUpdateSecrets: vi.fn(),
  mockGetSite: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: () => ({ getSite: mockGetSite }),
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
  class FakeAiroMgmtClient {
    updateSecrets = mockUpdateSecrets;
  }
  return {
    ...actual,
    AiroMgmtClient: FakeAiroMgmtClient,
  };
});

vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customer-auth')>('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn((handler: any) => async (request: NextRequest, ...args: any[]) =>
      handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: { customerId: 'cust-1' } }, ...args),
    ),
  };
});

import { AiroHttpError } from '@/lib/mgmt-airo';
import { POST } from '../route';

const APP_ID = 'app-abc123';
const params = Promise.resolve({ id: APP_ID });

function makeReq(body?: string): NextRequest {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.body = body;
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(`https://airo.test/api/apps/${APP_ID}/sso-config`, init);
}

describe('POST /api/apps/[id]/sso-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: caller owns the app + server has a config bound + IDs needed
    // for the customer-proxy URL are present.
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      ssoConfigId: 'cfg-godaddy-shopper',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
      clientIdSecretName: 'GD_SSO_OAUTH_CLIENT_ID',
      clientSecretSecretName: 'GD_SSO_OAUTH_CLIENT_SECRET',
    });
    mockUpdateSecrets.mockResolvedValue({ message: 'secrets updated', appId: APP_ID });
  });

  it('returns 200 + {configured:true} on a valid payload, calling updateSecrets with auth:true pointer rows', async () => {
    const res = await POST(
      makeReq(JSON.stringify({
        client_id: '0oa1ab2cd3ef4',
        client_secret: 'super-secret',
      })),
      { params },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: true });

    expect(mockUpdateSecrets).toHaveBeenCalledTimes(1);
    expect(mockUpdateSecrets).toHaveBeenCalledWith('sub-1', 'sys-1', APP_ID, {
      operations: [
        {
          type: 'upsert',
          secret: {
            name: 'GD_SSO_OAUTH_CLIENT_ID',
            value: '0oa1ab2cd3ef4',
            variants: [],
            systemManaged: false,
            auth: true,
          },
        },
        {
          type: 'upsert',
          secret: {
            name: 'GD_SSO_OAUTH_CLIENT_SECRET',
            value: 'super-secret',
            variants: [],
            systemManaged: false,
            auth: true,
          },
        },
      ],
      workflowName: 'airo-app-secrets',
    });
  });

  it('uses per-config pointer names from SiteInfo (dynamic resolution)', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      ssoConfigId: 'cfg-custom-idp',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
      // Per-config admin override — different from the Phase-1 GD defaults.
      clientIdSecretName: 'CUSTOM_IDP_CLIENT_ID',
      clientSecretSecretName: 'CUSTOM_IDP_CLIENT_SECRET',
    });

    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'abc', client_secret: 'def' })),
      { params },
    );

    expect(res.status).toBe(200);
    const call = mockUpdateSecrets.mock.calls[0];
    expect(call[3].operations[0].secret.name).toBe('CUSTOM_IDP_CLIENT_ID');
    expect(call[3].operations[1].secret.name).toBe('CUSTOM_IDP_CLIENT_SECRET');
  });

  it('falls back to GD defaults when SiteInfo has no pointer names (older mhp-core / LCP)', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      ssoConfigId: 'cfg-godaddy-shopper',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
      // clientIdSecretName / clientSecretSecretName intentionally absent.
    });

    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'abc', client_secret: 'def' })),
      { params },
    );

    expect(res.status).toBe(200);
    const call = mockUpdateSecrets.mock.calls[0];
    expect(call[3].operations[0].secret.name).toBe('GD_SSO_OAUTH_CLIENT_ID');
    expect(call[3].operations[1].secret.name).toBe('GD_SSO_OAUTH_CLIENT_SECRET');
  });

  it('accepts payloads carrying matching sso_config_id (back-compat for UI)', async () => {
    const res = await POST(
      makeReq(JSON.stringify({
        client_id: '0oa1ab2cd3ef4',
        client_secret: 'super-secret',
        sso_config_id: 'cfg-godaddy-shopper',
      })),
      { params },
    );

    expect(res.status).toBe(200);
    expect(mockUpdateSecrets).toHaveBeenCalled();
  });

  it('returns 400 when sso_config_id payload does not match the server value', async () => {
    const res = await POST(
      makeReq(JSON.stringify({
        client_id: '0oa1ab2cd3ef4',
        client_secret: 'super-secret',
        sso_config_id: 'cfg-attacker-controlled',
      })),
      { params },
    );

    expect(res.status).toBe(400);
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    const warnCall = mockLogger.warn.mock.calls.find(
      ([event]: [string]) => event === 'sso-config.upsert-rejected.config-id-mismatch',
    );
    expect(warnCall).toBeDefined();
  });

  it('returns 409 when the app has no server-side ssoConfigId yet', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
      // ssoConfigId intentionally absent — admin hasn't bound a config.
    });

    const res = await POST(
      makeReq(JSON.stringify({
        client_id: '0oa1ab2cd3ef4',
        client_secret: 'super-secret',
      })),
      { params },
    );

    expect(res.status).toBe(409);
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
  });

  it('returns 409 when subscription_id or system_id is missing on the site', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      ssoConfigId: 'cfg-godaddy-shopper',
      // subscription_id / system_id absent
    });

    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'abc', client_secret: 'def' })),
      { params },
    );

    expect(res.status).toBe(409);
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller does not own the app (IDOR guard)', async () => {
    mockGetSite.mockResolvedValue(null);

    const res = await POST(
      makeReq(JSON.stringify({
        client_id: '0oa1ab2cd3ef4',
        client_secret: 'super-secret',
      })),
      { params },
    );

    expect(res.status).toBe(404);
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller is a collaborator (sharedWithMe)', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-owner-not-caller',
      sharedWithMe: true,
      ssoConfigId: 'cfg-godaddy-shopper',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
    });

    const res = await POST(
      makeReq(JSON.stringify({
        client_id: '0oa1ab2cd3ef4',
        client_secret: 'super-secret',
      })),
      { params },
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'App not found' });
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
    const warnCall = mockLogger.warn.mock.calls.find(
      ([event]: [string]) => event === 'sso-config.upsert-rejected.not-owner',
    );
    expect(warnCall).toBeDefined();
  });

  it('returns 400 when payload is missing client_id or client_secret', async () => {
    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'just-id' })),
      { params },
    );

    expect(res.status).toBe(400);
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await POST(makeReq('not-json'), { params });
    expect(res.status).toBe(400);
    expect(mockUpdateSecrets).not.toHaveBeenCalled();
  });

  it('maps airo-go 404 (EntityOwner / not-found) to BFF 404', async () => {
    mockUpdateSecrets.mockRejectedValue(new AiroHttpError(404, 'Not Found', 'app not found'));
    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'abc', client_secret: 'def' })),
      { params },
    );
    expect(res.status).toBe(404);
  });

  it('maps airo-go 400 (generic validator rejection) to BFF 400 sso_invalid_request', async () => {
    mockUpdateSecrets.mockRejectedValue(
      new AiroHttpError(400, 'Bad Request', { error: 'invalid auth-class write' }),
    );
    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'abc', client_secret: 'def' })),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('sso_invalid_request');
    expect(typeof body.message).toBe('string');
  });

  it('maps cache-row-not-seeded (ErrCustomerAuthNameNotPointer) to BFF 503 sso_cache_not_seeded', async () => {
    // mhp-core sentinel string from secrets_errors.go — see
    // ErrCustomerAuthNameNotPointer. Surfaced when the admin just bound an
    // SSO config but UpsertSSOConfigCacheTask hasn't propagated yet, OR
    // when the pointer name doesn't match the cache row's clientIdKey /
    // clientSecretKey. Retry-friendly state, not a permanent failure.
    mockUpdateSecrets.mockRejectedValue(
      new AiroHttpError(400, 'Bad Request', {
        message: "auth-class secret name is not registered as a credential pointer in the app's SSO cache row",
      }),
    );
    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'abc', client_secret: 'def' })),
      { params },
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('sso_cache_not_seeded');
    expect(body.message).toContain('still being provisioned');
  });

  it('maps systemManaged flag conflict (ErrCustomerAuthSystemManagedDisallowed) to BFF 400 sso_validator_flag_conflict', async () => {
    mockUpdateSecrets.mockRejectedValue(
      new AiroHttpError(400, 'Bad Request', {
        message: 'customer auth-class writes on pointer-named rows must have systemManaged=false',
      }),
    );
    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'abc', client_secret: 'def' })),
      { params },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('sso_validator_flag_conflict');
  });

  it('reads upstream message from v2 error envelope (error.message)', async () => {
    mockUpdateSecrets.mockRejectedValue(
      new AiroHttpError(400, 'Bad Request', {
        error: {
          code: 'CUSTOMER_AUTH_NAME_NOT_POINTER',
          message: "auth-class secret name is not registered as a credential pointer in the app's SSO cache row",
        },
      } as unknown as { message: string; statusCode?: number }),
    );
    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'abc', client_secret: 'def' })),
      { params },
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('sso_cache_not_seeded');
  });

  it('returns 502 on unexpected upstream failures', async () => {
    mockUpdateSecrets.mockRejectedValue(new Error('connection refused'));
    const res = await POST(
      makeReq(JSON.stringify({ client_id: 'abc', client_secret: 'def' })),
      { params },
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Failed to save SSO config');
  });
});
