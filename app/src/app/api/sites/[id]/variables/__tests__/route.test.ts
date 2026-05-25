/**
 * Tests for PATCH /api/sites/[id]/variables — focused on the validateFqdn
 * gate and the surrounding update-variables write path.
 *
 * The fqdn validator (route.ts:32) is the only place where a write-time
 * type/length check on `app.variables.fqdn` happens. The adapter read side
 * (v2-control-plane-adapter.ts) trusts this gate, so a regression here lets
 * malformed values flow through to downstream consumers (publish, DPP, etc.)
 * and to mgmt-airo's persisted state.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockUpdateSiteVariables,
  mockAuthenticateCustomer,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockUpdateSiteVariables: vi.fn(),
  mockAuthenticateCustomer: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(() => ({
    getSite: mockGetSite,
    updateSiteVariables: mockUpdateSiteVariables,
  })),
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth:
    (handler: any) => async (request: NextRequest, ...args: any[]) =>
      handler(
        request,
        { isAuthenticated: true, jwt: 'test-jwt', user: { accountId: 'cust-1' } },
        ...args,
      ),
  authenticateCustomer: mockAuthenticateCustomer,
  customerHasAccount: vi.fn(() => true),
  createCustomerAuthError: vi.fn(),
}));

import { PATCH } from '../route';

const APP_ID = 'app-123';

function makePatch(body: unknown): NextRequest {
  return new NextRequest(`https://airo.test/api/sites/${APP_ID}/variables`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const params = Promise.resolve({ id: APP_ID });

describe('PATCH /api/sites/[id]/variables — fqdn validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSite.mockResolvedValue({ id: APP_ID });
    mockUpdateSiteVariables.mockImplementation(async (_id: string, vars: Record<string, unknown>) => ({
      id: APP_ID,
      ...vars,
    }));
    // Default: level-3 escalation succeeds. The fqdn-bearing tests rely on
    // this; non-fqdn tests never invoke it.
    mockAuthenticateCustomer.mockResolvedValue({
      isAuthenticated: true,
      jwt: 'test-jwt',
      user: { accountId: 'cust-1' },
    });
  });

  it('rejects non-string fqdn with 400 and does not call updateSiteVariables', async () => {
    const res = await PATCH(makePatch({ fqdn: 12345 }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('fqdn must be a string');
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });

  it('rejects empty-string fqdn with 400', async () => {
    const res = await PATCH(makePatch({ fqdn: '' }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('fqdn must not be empty');
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only fqdn with 400 (trim → empty)', async () => {
    // The trim happens before the empty check, so "   " is treated the same
    // as "". This pins that ordering — a refactor that checked length before
    // trim would let a whitespace-only value through.
    const res = await PATCH(makePatch({ fqdn: '   ' }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('fqdn must not be empty');
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });

  it('rejects fqdn whose trimmed length exceeds 253 chars with 400', async () => {
    // 254 chars of 'a' alone would also fail on the "at least two labels"
    // rule; build a value that ONLY trips the length cap so this test pins
    // the length boundary specifically.
    const oversize = 'a'.repeat(250) + '.com';
    const res = await PATCH(makePatch({ fqdn: oversize }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Domain name exceeds maximum length of 253 characters');
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });

  it('rejects fqdn with invalid characters (e.g. spaces or control chars)', async () => {
    // The shared validator's strict character class rejects anything outside
    // [a-z0-9.-], which is the contract quick-create has enforced for ages.
    // The previous trim-only validator would have let "studio sketch.com"
    // through to mgmt-airo.
    const res = await PATCH(makePatch({ fqdn: 'studio sketch.com' }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Domain name contains invalid characters');
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });

  it('rejects single-label fqdn (must have at least two labels)', async () => {
    const res = await PATCH(makePatch({ fqdn: 'localhost' }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Domain name must have at least two labels (e.g., example.com)');
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });

  it('accepts fqdn with surrounding whitespace and stores the normalized value', async () => {
    // The adapter read side compares trimmed length too (see
    // v2-control-plane-adapter.ts), so the persisted form must be trimmed —
    // otherwise a future read would silently drop the value.
    const res = await PATCH(makePatch({ fqdn: '  studiosketch.com  ' }), { params });
    expect(res.status).toBe(200);
    expect(mockUpdateSiteVariables).toHaveBeenCalledWith(
      APP_ID,
      { fqdn: 'studiosketch.com' },
      'test-jwt',
    );
  });

  it('lowercases mixed-case input before persisting (parity with quick-create)', async () => {
    // quick-create lowercases before validateDomainName; PATCH variables
    // must do the same so that a later "have we already provisioned this
    // hostname?" check in mgmt-airo can compare normalized strings.
    const res = await PATCH(makePatch({ fqdn: 'StudioSketch.COM' }), { params });
    expect(res.status).toBe(200);
    expect(mockUpdateSiteVariables).toHaveBeenCalledWith(
      APP_ID,
      { fqdn: 'studiosketch.com' },
      'test-jwt',
    );
  });

  it('drops disallowed keys silently while still validating fqdn', async () => {
    // The route's allow-list filter runs before validateFqdn, so a payload
    // mixing forbidden keys with a valid fqdn should succeed and the
    // forbidden keys must not reach the adapter. Use JSON.parse so that
    // `__proto__` is an own enumerable property of the parsed object —
    // an object literal `{ __proto__: ... }` would mutate the prototype
    // instead of creating a key, and JSON.stringify would drop it.
    const payload = JSON.parse(
      '{"fqdn":"studiosketch.com","title":"New title","rogueKey":"should be dropped","__proto__":{"polluted":true}}',
    );
    const res = await PATCH(makePatch(payload), { params });
    expect(res.status).toBe(200);
    expect(mockUpdateSiteVariables).toHaveBeenCalledTimes(1);
    const [, vars] = mockUpdateSiteVariables.mock.calls[0]!;
    expect(vars).toEqual({ fqdn: 'studiosketch.com', title: 'New title' });
    expect(vars).not.toHaveProperty('rogueKey');
    expect(vars).not.toHaveProperty('polluted');
    // Prototype must not be polluted by the forbidden __proto__ own key —
    // ALLOWED_VARIABLE_KEYS gates the for-key loop, so __proto__ is filtered
    // before it can land in variableUpdates.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('mixed payload: invalid fqdn rejects the entire request even if other keys are valid', async () => {
    // validateFqdn returns early with a 400; partial application would be
    // surprising to clients and harder to reason about.
    const res = await PATCH(
      makePatch({ fqdn: 12345, title: 'New title' }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });

  it('returns 400 when no allowed keys are present after filtering', async () => {
    const res = await PATCH(makePatch({ rogueKey: 'x' }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No valid variable keys provided');
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });

  it('returns 400 when request body is not an object', async () => {
    const res = await PATCH(
      new NextRequest(`https://airo.test/api/sites/${APP_ID}/variables`, {
        method: 'PATCH',
        body: JSON.stringify(['fqdn', 'studiosketch.com']),
        headers: { 'content-type': 'application/json' },
      }),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Request body must be an object');
  });

  it('returns 404 when site does not exist', async () => {
    mockGetSite.mockResolvedValueOnce(null);
    const res = await PATCH(makePatch({ fqdn: 'studiosketch.com' }), { params });
    expect(res.status).toBe(404);
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });

  it('escalates to level 3 only when fqdn is in the body', async () => {
    // Pin the auth-symmetry rule: fqdn writes match /api/sites/[id]/domains'
    // level-3 stance, but a metadata-only write (lastInteractionAt fires every
    // chat turn from completionSideEffects.updateSiteTimestamp) must not pay
    // the HBI cost.
    const fqdnRes = await PATCH(makePatch({ fqdn: 'studiosketch.com' }), { params });
    expect(fqdnRes.status).toBe(200);
    expect(mockAuthenticateCustomer).toHaveBeenCalledTimes(1);
    expect(mockAuthenticateCustomer).toHaveBeenCalledWith(expect.anything(), 3);

    mockAuthenticateCustomer.mockClear();
    const metaRes = await PATCH(makePatch({ lastInteractionAt: '2026-05-22T00:00:00Z' }), { params });
    expect(metaRes.status).toBe(200);
    expect(mockAuthenticateCustomer).not.toHaveBeenCalled();
  });

  it('returns 401 with authReason when level-3 escalation fails for fqdn writes', async () => {
    // gd-auth signals level-3 failure with authReason: 2 (HBI stale). The BFF
    // surfaces it on the response so AuthBoundary can trigger a re-auth prompt
    // instead of silently dropping the write.
    mockAuthenticateCustomer.mockResolvedValueOnce({
      isAuthenticated: false,
      user: null,
      error: 'HBI stale',
      authReason: 2,
    });
    const res = await PATCH(makePatch({ fqdn: 'studiosketch.com' }), { params });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('HBI stale');
    expect(body.authReason).toBe(2);
    expect(mockUpdateSiteVariables).not.toHaveBeenCalled();
  });
});
