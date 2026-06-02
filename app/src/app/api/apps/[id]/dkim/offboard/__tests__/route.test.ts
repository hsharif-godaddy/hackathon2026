import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockDeactivate,
  mockLogger,
  mockCheckSwitchboardFlag,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockDeactivate: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockCheckSwitchboardFlag: vi.fn(),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
}));
vi.mock('@/lib/dkim/dkim-service', () => ({
  DkimService: vi.fn(function () { return { deactivate: mockDeactivate }; }),
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}));

const capturedAuthOptions = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customer-auth')>('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn(function (handler: any, options?: unknown) {
      capturedAuthOptions.set('POST', options);
      return (req: NextRequest, ...args: any[]) =>
        handler(req, { isAuthenticated: true, jwt: 'test-jwt', user: { shopperId: 'sh1', customerId: 'c1' } }, ...args);
    }),
  };
});

import { POST } from '../route';

const APP_ID = 'app1234567';
const SITE = { subscription_id: 'sub-1', system_id: 'sys-1' };
const params = Promise.resolve({ id: APP_ID });

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`https://airo.test/api/apps/${APP_ID}/dkim/offboard`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/apps/[id]/dkim/offboard', () => {
  beforeEach(() => {
    mockGetSite.mockReset();
    mockDeactivate.mockReset();
    mockCheckSwitchboardFlag.mockReset();
    mockCheckSwitchboardFlag.mockResolvedValue(true);
  });

  it('uses auth level 3', () => {
    expect(capturedAuthOptions.get('POST')).toEqual({ level: 3 });
  });

  it('returns 400 when domain missing', async () => {
    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(400);
  });

  it('short-circuits with skipped + feature_flag_off WITHOUT calling getSite', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);

    const res = await POST(makeRequest({ domain: 'example.com' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ result: 'skipped', reason: 'feature_flag_off' });

    expect(mockGetSite).not.toHaveBeenCalled();
    expect(mockDeactivate).not.toHaveBeenCalled();
  });

  it('returns 404 when site not found', async () => {
    mockGetSite.mockResolvedValue(null);
    const res = await POST(makeRequest({ domain: 'example.com' }), { params });
    expect(res.status).toBe(404);
  });

  it('returns 200 with deactivated result', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockDeactivate.mockResolvedValue({ result: 'deactivated', executionArn: 'arn:456' });
    const res = await POST(makeRequest({ domain: 'example.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('deactivated');
    // Verify the request is threaded into DkimService.deactivate so
    // switchboard's per-shopper criteria fire correctly.
    expect(mockDeactivate).toHaveBeenCalledWith(
      expect.objectContaining({ appId: APP_ID, domain: 'example.com', shopperId: 'sh1' }),
      expect.any(NextRequest),
    );
  });

  it('returns 200 even when service returns failed (fail-open)', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockDeactivate.mockResolvedValue({ result: 'failed', error: 'timeout' });
    const res = await POST(makeRequest({ domain: 'example.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('failed');
  });
});
