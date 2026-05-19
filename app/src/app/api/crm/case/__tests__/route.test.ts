import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockAuthContext: {
  jwt: string;
  user: {
    customerId: string;
    shopperId: string;
    authType: string;
  };
} = {
  jwt: 'test-jwt',
  user: {
    customerId: 'cust-jwt',
    shopperId: 'shop-jwt',
    authType: 'basic',
  },
};

const mockIsEmployeeAuthType = vi.fn();
const mockCheckSwitchboardFlag = vi.fn();
const mockOpenCrmCase = vi.fn();
const mockIsCertConfigured = vi.fn();

vi.mock('@airo/shared/auth', () => ({
  isEmployeeAuthType: mockIsEmployeeAuthType,
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (request: NextRequest, ...rest: any[]) =>
    handler(request, mockAuthContext, ...rest),
}));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: (...args: unknown[]) => mockCheckSwitchboardFlag(...args),
}));

vi.mock('@/lib/crm', () => ({
  openCrmCase: (...args: unknown[]) => mockOpenCrmCase(...args),
  airoCertTokenService: { isConfigured: () => mockIsCertConfigured() },
}));

function createRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/crm/case'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function callRoute(body: unknown) {
  const { POST } = await import('../route');
  return POST(createRequest(body));
}

describe('/api/crm/case POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEmployeeAuthType.mockReturnValue(false);
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    mockIsCertConfigured.mockReturnValue(true);
    mockAuthContext.user = { customerId: 'cust-jwt', shopperId: 'shop-jwt', authType: 'basic' };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 and caseId on happy path', async () => {
    mockOpenCrmCase.mockResolvedValue({ caseId: 'case-1', caseNumber: '000001' });
    const res = await callRoute({ description: 'broken', appId: 'app-1' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, caseId: 'case-1', caseNumber: '000001' });
    expect(mockOpenCrmCase).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cust-jwt',
      shopperId: 'shop-jwt',
      description: 'broken',
      appId: 'app-1',
    }));
  });

  it('returns 403 when authType is e2s (impersonation)', async () => {
    mockIsEmployeeAuthType.mockReturnValue(true);
    const res = await callRoute({ description: 'x' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('impersonation-not-allowed');
    expect(mockOpenCrmCase).not.toHaveBeenCalled();
  });

  it('returns 403 for TLA (3-char shopperId)', async () => {
    mockAuthContext.user = { customerId: 'c', shopperId: 'abc', authType: 'basic' };
    const res = await callRoute({ description: 'x' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('internal-user-not-allowed');
    expect(mockOpenCrmCase).not.toHaveBeenCalled();
  });

  it('returns 403 when Switchboard flag is off', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    const res = await callRoute({ description: 'x' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('feature-disabled');
    expect(mockOpenCrmCase).not.toHaveBeenCalled();
  });

  it('fails closed when Switchboard lookup throws', async () => {
    mockCheckSwitchboardFlag.mockRejectedValue(new Error('switchboard down'));
    const res = await callRoute({ description: 'x' });
    expect(res.status).toBe(403);
    expect(mockOpenCrmCase).not.toHaveBeenCalled();
  });

  it('returns 403 feature-disabled when AIRO cert env vars are not set', async () => {
    mockIsCertConfigured.mockReturnValue(false);
    const res = await callRoute({ description: 'x' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('feature-disabled');
    expect(mockOpenCrmCase).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    const { POST } = await import('../route');
    const req = new NextRequest(new URL('http://localhost:3000/api/crm/case'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid-json');
  });

  it('returns 400 when description is missing', async () => {
    const res = await callRoute({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('description-required');
  });

  it('returns 400 when description is whitespace only', async () => {
    const res = await callRoute({ description: '   ' });
    expect(res.status).toBe(400);
  });

  it('ignores customerId in body and uses JWT customerId', async () => {
    mockOpenCrmCase.mockResolvedValue({ caseId: 'c' });
    await callRoute({ description: 'x', customerId: 'attacker-cid', shopperId: 'attacker-sid' });
    const passed = mockOpenCrmCase.mock.calls[0]?.[0];
    expect(passed.customerId).toBe('cust-jwt');
    expect(passed.shopperId).toBe('shop-jwt');
  });

  it('returns 502 when openCrmCase throws', async () => {
    mockOpenCrmCase.mockRejectedValue(new Error('CRM down'));
    const res = await callRoute({ description: 'x' });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('crm-case-failed');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'feedback.crm.case.submit.failed',
      expect.objectContaining({ error: 'CRM down' }),
    );
  });

  it('does not forward followUp from the request body to openCrmCase', async () => {
    // Stale browser tabs may still POST followUp; the BFF must drop it so
    // it never reaches the CRM payload.
    mockOpenCrmCase.mockResolvedValue({ caseId: 'c' });
    await callRoute({ description: 'x', followUp: true });
    const passed = mockOpenCrmCase.mock.calls[0]?.[0];
    expect(passed.followUp).toBeUndefined();
  });
});
