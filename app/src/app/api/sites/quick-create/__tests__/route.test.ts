import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiroHttpError } from '@/lib/mgmt-airo/types';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const mockFetchHivemindCohorts = vi.fn().mockResolvedValue(undefined);
const mockGetBmsLaunchAACohort = vi.fn().mockReturnValue(undefined);

vi.mock('@/lib/budget-service-experiment', () => ({
  fetchHivemindCohorts: (...args: unknown[]) => mockFetchHivemindCohorts(...args),
  getBmsLaunchAACohort: (...args: unknown[]) => mockGetBmsLaunchAACohort(...args),
}));

const mockCreateSite = vi.fn();

const authState: { authType: string | undefined } = { authType: undefined };

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: any) => {
      return handler(request, {
        jwt: 'test-jwt',
        user: { accountId: 'acc-1', customerId: 'cust-1', email: 'test@test.com', shopperId: 'shopper-1', authType: authState.authType }
      });
    };
  },
  customerHasAccount: vi.fn(function () { return true; }),
  createCustomerAuthError: vi.fn(),
  setSpanAppId: vi.fn(),
  setSpanJobId: vi.fn(),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: () => ({ createSite: mockCreateSite })
}));

const mockResolveMarketId = vi.fn().mockResolvedValue({
  marketId: 'en-US',
  visitorMarket: 'en-US',
  source: 'visitor-market',
});
vi.mock('@/lib/market/resolve-market', () => ({
  resolveMarketId: (...args: unknown[]) => mockResolveMarketId(...args),
}));

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/sites/quick-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/sites/quick-create BMS experiment cohort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSite.mockResolvedValue({
      success: true, siteId: 'app-1', name: 'Test', status: 'active',
      type: 'job', account_id: 'acc-1',
    });
  });

  it('passes bmsLaunchAACohort to createSite for homepage source', async function homepageAACohort() {
    mockGetBmsLaunchAACohort.mockReturnValue('bms');

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', source: 'homepage' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ bmsLaunchAACohort: 'bms' })
    );
  });

  it('passes undefined bmsLaunchAACohort for non-homepage source', async function nonHomepageAACohort() {
    mockGetBmsLaunchAACohort.mockReturnValue('bms');

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ bmsLaunchAACohort: undefined })
    );
  });

  it('passes undefined bmsLaunchAACohort for unknown source', async function unknownSource() {
    mockGetBmsLaunchAACohort.mockReturnValue('bms');

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', source: 'forged-value' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ bmsLaunchAACohort: undefined })
    );
  });
});

describe('/api/sites/quick-create ITC validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSite.mockResolvedValue({
      success: true, siteId: 'app-1', name: 'Test', status: 'active',
      type: 'job', account_id: 'acc-1',
    });
  });

  it('passes valid ITC to createSite', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 'summer_2026' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ itc: 'summer_2026' })
    );
  });

  it('drops ITC exceeding 128 chars', async () => {
    const { POST } = await import('../route');
    const longItc = 'a'.repeat(129);
    await POST(makeRequest({ initialPrompt: 'test', itc: longItc }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('drops non-string ITC', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 12345 }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('drops empty string ITC', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: '' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('drops ITC with invalid characters', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: '../../etc/passwd' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('drops ITC with spaces', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 'campaign with spaces' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('omits ITC when not provided', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });
});

describe('/api/sites/quick-create fqdn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSite.mockResolvedValue({
      success: true, siteId: 'app-1', name: 'Test', status: 'active',
      type: 'job', account_id: 'acc-1',
    });
  });

  it('passes valid fqdn to createSite', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', fqdn: 'somedomain.com' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ fqdn: 'somedomain.com' })
    );
  });

  it('lowercases and trims fqdn', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', fqdn: '  Some-Domain.COM  ' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ fqdn: 'some-domain.com' })
    );
  });

  it('drops non-string fqdn', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', fqdn: 12345 }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ fqdn: expect.anything() })
    );
  });

  it('drops empty fqdn', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', fqdn: '   ' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ fqdn: expect.anything() })
    );
  });

  it('drops fqdn with invalid characters', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', fqdn: 'bad domain!.com' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ fqdn: expect.anything() })
    );
  });

  it('drops fqdn without TLD', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', fqdn: 'localhost' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ fqdn: expect.anything() })
    );
  });

  it('drops fqdn exceeding 253 chars', async () => {
    const { POST } = await import('../route');
    const longFqdn = `${'a'.repeat(250)}.com`;
    await POST(makeRequest({ initialPrompt: 'test', fqdn: longFqdn }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ fqdn: expect.anything() })
    );
  });

  it('omits fqdn when not provided', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ fqdn: expect.anything() })
    );
  });
});

describe('/api/sites/quick-create datacenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSite.mockResolvedValue({
      success: true, siteId: 'app-1', name: 'Test', status: 'active',
      type: 'job', account_id: 'acc-1',
    });
  });

  it('passes datacenter to createSite when provided', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', datacenter: 'sxb1' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ datacenter: 'sxb1' })
    );
  });

  it('trims datacenter before createSite', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', datacenter: '  p3  ' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ datacenter: 'p3' })
    );
  });

  it('omits datacenter when empty or whitespace-only', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', datacenter: '' }));
    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ datacenter: expect.anything() })
    );

    vi.clearAllMocks();
    mockCreateSite.mockResolvedValue({
      success: true, siteId: 'app-1', name: 'Test', status: 'active',
      type: 'job', account_id: 'acc-1',
    });
    await POST(makeRequest({ initialPrompt: 'test', datacenter: '   ' }));
    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ datacenter: expect.anything() })
    );
  });

  it('omits datacenter when not a string', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', datacenter: 123 }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ datacenter: expect.anything() })
    );
  });
});

describe('/api/sites/quick-create market resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSite.mockResolvedValue({
      success: true, siteId: 'app-1', name: 'Test', status: 'active',
      type: 'job', account_id: 'acc-1',
    });
  });

  it('passes resolved marketId to createSite and forwards request to the helper', async () => {
    mockResolveMarketId.mockResolvedValueOnce({
      marketId: 'en-IN',
      visitorMarket: 'en-IN',
      source: 'visitor-market',
    });

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test' }));

    expect(mockResolveMarketId).toHaveBeenCalledWith(expect.anything());
    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ marketId: 'en-IN' })
    );
  });

  it('uses visitor-market resolution', async () => {
    mockResolveMarketId.mockResolvedValueOnce({
      marketId: 'de-DE',
      visitorMarket: 'de-DE',
      source: 'visitor-market',
    });

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ marketId: 'de-DE' })
    );
  });

  it('uses fallback en-US when helper returns the fallback source', async () => {
    mockResolveMarketId.mockResolvedValueOnce({
      marketId: 'en-US',
      visitorMarket: undefined,
      source: 'fallback',
    });

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ marketId: 'en-US' })
    );
  });
});

describe('/api/sites/quick-create downstream error propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates downstream 401 AiroHttpError as 401 with authReason:2', async () => {
    mockCreateSite.mockRejectedValue(new AiroHttpError(401, 'Unauthorized', {}));

    const { POST } = await import('../route');
    const response = await POST(makeRequest({ initialPrompt: 'test' }));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'Unauthorized', authReason: 2 });
  });

  it('returns 500 for downstream 403 (does not match 401 branch)', async () => {
    mockCreateSite.mockRejectedValue(new AiroHttpError(403, 'Forbidden', {}));

    const { POST } = await import('../route');
    const response = await POST(makeRequest({ initialPrompt: 'test' }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to create site record');
    expect(body).not.toHaveProperty('authReason');
  });

  it('returns 422 with errorCode APP_LIMIT_EXCEEDED for quota violation', async () => {
    const rawMessage = 'API request failed: 400 Bad Request - {"error":"APP_LIMIT_EXCEEDED","message":"Maximum 100 apps allowed per system for this product"}';
    mockCreateSite.mockResolvedValue({ success: false, error: rawMessage });

    const { POST } = await import('../route');
    const response = await POST(makeRequest({ initialPrompt: 'test' }));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.errorCode).toBe('APP_LIMIT_EXCEEDED');
    expect(body.error).toBe('Failed to create site record');
  });

  it('returns 500 for non-AiroHttpError with status:401 field (no spurious SSO trigger)', async () => {
    const fakeError = Object.assign(new Error('boom'), { status: 401 });
    mockCreateSite.mockRejectedValue(fakeError);

    const { POST } = await import('../route');
    const response = await POST(makeRequest({ initialPrompt: 'test' }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to create site record');
    expect(body).not.toHaveProperty('authReason');
  });
});

describe('/api/sites/quick-create care purchase ITC override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.authType = undefined;
    mockCreateSite.mockResolvedValue({
      success: true, siteId: 'app-1', name: 'Test', status: 'active',
      type: 'job', account_id: 'acc-1',
    });
  });

  it('overrides frontend ITC with aab_care_purchase for e2s sessions', async () => {
    authState.authType = 'e2s';

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 'summer_2026' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ itc: 'aab_care_purchase' })
    );
  });

  it('overrides frontend ITC with aab_care_purchase for e2s2s sessions', async () => {
    authState.authType = 'e2s2s';

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 'summer_2026' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ itc: 'aab_care_purchase' })
    );
  });

  it('sends aab_care_purchase for e2s sessions even when no ITC is provided', async () => {
    authState.authType = 'e2s';

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ itc: 'aab_care_purchase' })
    );
  });

  it('preserves the frontend ITC for basic (non-employee) sessions', async () => {
    authState.authType = 'basic';

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 'summer_2026' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ itc: 'summer_2026' })
    );
  });

  it('does not override ITC for s2s delegation sessions', async () => {
    authState.authType = 's2s';

    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 'summer_2026' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ itc: 'summer_2026' })
    );
  });
});
