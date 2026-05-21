import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openCrmCaseMock = vi.fn();
const addCrmCaseNoteMock = vi.fn();
const isCertConfiguredMock = vi.fn();
const checkSwitchboardFlagMock = vi.fn();
const invokeInvestigatorMock = vi.fn();
const readActiveStateMock = vi.fn();
const isInvestigationActiveMock = vi.fn();

vi.mock('@/lib/crm', () => ({
  openCrmCase: (...args: any[]) => openCrmCaseMock(...args),
  addCrmCaseNote: (...args: any[]) => addCrmCaseNoteMock(...args),
  airoCertTokenService: {
    isConfigured: () => isCertConfiguredMock(),
  },
}));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: (...args: any[]) => checkSwitchboardFlagMock(...args),
}));

vi.mock('@/lib/investigate/invoke', () => ({
  invokeInvestigator: (...args: any[]) => invokeInvestigatorMock(...args),
}));

vi.mock('@/lib/investigate/active-state', () => ({
  readActiveState: (...args: any[]) => readActiveStateMock(...args),
  isInvestigationActive: (...args: any[]) => isInvestigationActiveMock(...args),
}));

// Per-test auth override seam (review S-3). The previous setup hard-coded
// the mock user inside the `vi.mock` factory, which closes over the
// initial value for the lifetime of the module — making per-test
// override impossible without `vi.resetModules`, which conflicts with
// the module-level `vi.mock` calls that every other test in this file
// relies on. Reading from a `let` binding inside the factory closure
// is safe with vitest (the closure captures the binding, not the value),
// so each test can mutate `currentAuthUser` in `beforeEach` to inject
// e2s impersonation, TLA shopperIds, missing customerId, etc.
let currentAuthUser: { customerId: string; shopperId: string; authType: string } = {
  customerId: 'cust-1',
  shopperId: 'shop-1',
  authType: 'idp',
};

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (req: NextRequest) => {
    return handler(req, { user: currentAuthUser });
  },
}));

vi.mock('@airo/shared/auth', () => ({
  isEmployeeAuthType: (t: string) => t === 'e2s',
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const buildReq = (body: unknown): NextRequest =>
  new NextRequest('http://localhost/api/feedback/submit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('POST /api/feedback/submit', () => {
  beforeEach(() => {
    openCrmCaseMock.mockReset();
    addCrmCaseNoteMock.mockReset().mockResolvedValue(undefined);
    isCertConfiguredMock.mockReset().mockReturnValue(true);
    checkSwitchboardFlagMock.mockReset().mockResolvedValue(true);
    invokeInvestigatorMock.mockReset().mockResolvedValue(undefined);
    // Default: no in-flight investigation. Reuse-path tests override.
    readActiveStateMock.mockReset().mockResolvedValue(null);
    isInvestigationActiveMock.mockReset().mockReturnValue(false);
    // Reset auth to default; per-test setters mutate before each call.
    currentAuthUser = { customerId: 'cust-1', shopperId: 'shop-1', authType: 'idp' };
  });

  it('happy path: opens case, invokes investigator, returns caseId+caseNumber', async () => {
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C1', caseNumber: '999' });
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'broken',
      followUp: true,
      topics: ['ui'],
      appId: 'app-1',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, caseId: 'C1', caseNumber: '999' });
    expect(invokeInvestigatorMock).toHaveBeenCalledTimes(1);
    const payload = invokeInvestigatorMock.mock.calls[0][0];
    expect(payload.crmCaseId).toBe('C1');
    expect(payload.category).toBe('issue');
  });

  it('fresh-invoke happy path: posts kickoff note with the right URL', async () => {
    // Lambda's terminal `maybeAddCrmCaseNote` only fires on
    // status==='completed'; if Lambda is killed/timed-out/crashed the
    // original CRM case ends up with zero AI context. The kickoff note
    // is the documented mitigation — covered explicitly here so a
    // regression that drops the call doesn't slip through (review S-4).
    process.env.DEBUG_CONSOLE_BASE_URL = 'https://console.airo-builder.test-godaddy.com';
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C-fresh', caseNumber: '888' });
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'app-fresh',
    }));

    expect(res.status).toBe(200);
    expect(invokeInvestigatorMock).toHaveBeenCalledTimes(1);
    expect(addCrmCaseNoteMock).toHaveBeenCalledTimes(1);
    const noteArgs = addCrmCaseNoteMock.mock.calls[0][0];
    expect(noteArgs.caseId).toBe('C-fresh');
    expect(noteArgs.note).toContain('AI investigation kicked off');
    // Single base64url ctx param — no `&` for CMAPI to HTML-encode.
    // Decoded shape: { c: customerId, a: appId, t: 'investigate' }.
    const ctxMatch = noteArgs.note.match(/[?&]ctx=([A-Za-z0-9_-]+)/);
    expect(ctxMatch).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(ctxMatch![1], 'base64url').toString('utf-8'));
    expect(decoded).toEqual({ c: 'cust-1', a: 'app-fresh', t: 'investigate' });
    // Must NOT contain `&` separator anywhere — that's the whole point.
    expect(noteArgs.note).not.toMatch(/&customerId|&appId|&tab/);
  });

  it('fresh-invoke: kickoff note POST failure does NOT fail the response', async () => {
    process.env.DEBUG_CONSOLE_BASE_URL = 'https://console.airo-builder.test-godaddy.com';
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C-fresh-2', caseNumber: '888' });
    addCrmCaseNoteMock.mockRejectedValueOnce(new Error('CMAPI 500'));
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'app-fresh-2',
    }));

    // Fire-and-forget: kickoff note is best-effort. A failed POST must
    // not propagate as a 5xx — the customer's submit already succeeded.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.caseId).toBe('C-fresh-2');
  });

  it('fresh-invoke: skips kickoff note when caseId is null (CRM failed)', async () => {
    process.env.DEBUG_CONSOLE_BASE_URL = 'https://console.airo-builder.test-godaddy.com';
    openCrmCaseMock.mockRejectedValueOnce(new Error('CRM down'));
    const { POST } = await import('../route');

    await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'app-no-case',
    }));

    // No CRM case → no caseId → nothing to attach a note to.
    expect(addCrmCaseNoteMock).not.toHaveBeenCalled();
  });

  it('fresh-invoke: skips kickoff note when DEBUG_CONSOLE_BASE_URL is unset', async () => {
    delete process.env.DEBUG_CONSOLE_BASE_URL;
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C-no-url', caseNumber: '888' });
    const { POST } = await import('../route');

    await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'app-no-url',
    }));

    // No URL builder → silent skip (case is still filed; only the
    // cross-link is missing). Symmetric with the reuse-path skip.
    expect(addCrmCaseNoteMock).not.toHaveBeenCalled();
  });

  it('CRM failure: still invokes investigator without crmCaseId, returns success+null', async () => {
    openCrmCaseMock.mockRejectedValueOnce(new Error('crm 503'));
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'support',
      description: 'help',
      followUp: false,
      topics: [],
      appId: 'app-1',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.caseId).toBeNull();
    expect(body.warnings.crmFailed).toBe(true);
    expect(invokeInvestigatorMock).toHaveBeenCalledTimes(1);
    const payload = invokeInvestigatorMock.mock.calls[0][0];
    expect(payload.crmCaseId).toBeUndefined();
  });

  it('investigator failure: still returns success with caseId', async () => {
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C2', caseNumber: '111' });
    invokeInvestigatorMock.mockRejectedValueOnce(new Error('lambda 500'));
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'a',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.caseId).toBe('C2');
    expect(body.warnings.investigateFailed).toBe(true);
  });

  it('both fail: returns 502', async () => {
    openCrmCaseMock.mockRejectedValueOnce(new Error('crm down'));
    invokeInvestigatorMock.mockRejectedValueOnce(new Error('lambda down'));
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'a',
    }));

    expect(res.status).toBe(502);
  });

  it('flag off: 403 feature-disabled', async () => {
    checkSwitchboardFlagMock.mockResolvedValueOnce(false);
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'a',
    }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('feature-disabled');
  });

  it('NPS rating >= 5: 400 rating-out-of-range', async () => {
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'feedback',
      comment: 'good',
      rating: 6,
      topics: [],
      customerConsent: true,
      appId: 'a',
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('rating-out-of-range');
  });

  it('NPS non-integer rating: 400 rating-not-integer', async () => {
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'feedback',
      comment: 'good',
      rating: 2.5,
      topics: [],
      customerConsent: true,
      appId: 'a',
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('rating-not-integer');
  });

  it('reuse path: skips Lambda, links new CRM case to in-flight investigation', async () => {
    process.env.DEBUG_CONSOLE_BASE_URL = 'https://console.airo-builder.test-godaddy.com';
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C-NEW', caseNumber: '777' });
    readActiveStateMock.mockResolvedValueOnce({
      investigationId: 'inv-running-123',
      status: 'running',
      startedAt: Date.now() - 30_000,
      lastHeartbeatAt: Date.now() - 5_000,
      crmCaseId: 'C-ORIGINAL',
    });
    isInvestigationActiveMock.mockReturnValueOnce(true);

    const { POST } = await import('../route');
    const res = await POST(buildReq({
      category: 'issue',
      description: 'duplicate submit',
      followUp: false,
      topics: [],
      appId: 'app-1',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.caseId).toBe('C-NEW');
    expect(body.investigationId).toBe('inv-running-123');
    expect(body.warnings.reusedExisting).toBe(true);
    // Lambda must NOT have fired on the reuse path.
    expect(invokeInvestigatorMock).not.toHaveBeenCalled();
    // The new case picks up a note pointing to the in-flight run.
    expect(addCrmCaseNoteMock).toHaveBeenCalledTimes(1);
    const noteArgs = addCrmCaseNoteMock.mock.calls[0][0];
    expect(noteArgs.caseId).toBe('C-NEW');
    expect(noteArgs.note).toContain('inv-running-123');
    // Single base64url ctx param — see kickoff-note test for rationale.
    const ctxMatch = noteArgs.note.match(/[?&]ctx=([A-Za-z0-9_-]+)/);
    expect(ctxMatch).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(ctxMatch![1], 'base64url').toString('utf-8'));
    expect(decoded).toEqual({ c: 'cust-1', a: 'app-1', t: 'investigate' });
  });

  it('reuse path: still succeeds when CRM note POST fails (best-effort)', async () => {
    process.env.DEBUG_CONSOLE_BASE_URL = 'https://console.airo-builder.test-godaddy.com';
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C-NEW', caseNumber: '777' });
    readActiveStateMock.mockResolvedValueOnce({
      investigationId: 'inv-running-456',
      status: 'running',
      startedAt: Date.now() - 30_000,
    });
    isInvestigationActiveMock.mockReturnValueOnce(true);
    addCrmCaseNoteMock.mockRejectedValueOnce(new Error('CMAPI 500'));

    const { POST } = await import('../route');
    const res = await POST(buildReq({
      category: 'issue',
      description: 'd',
      followUp: false,
      topics: [],
      appId: 'app-1',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings.reusedExisting).toBe(true);
    expect(body.caseId).toBe('C-NEW');
  });

  it('reuse path: silently skips note when DEBUG_CONSOLE_BASE_URL unset', async () => {
    delete process.env.DEBUG_CONSOLE_BASE_URL;
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C-NEW', caseNumber: '777' });
    readActiveStateMock.mockResolvedValueOnce({
      investigationId: 'inv-no-link',
      status: 'running',
      startedAt: Date.now() - 30_000,
    });
    isInvestigationActiveMock.mockReturnValueOnce(true);

    const { POST } = await import('../route');
    const res = await POST(buildReq({
      category: 'issue',
      description: 'd',
      followUp: false,
      topics: [],
      appId: 'app-1',
    }));

    expect(res.status).toBe(200);
    expect(addCrmCaseNoteMock).not.toHaveBeenCalled();
  });

  it('cert not configured: 403 cert-not-configured', async () => {
    isCertConfiguredMock.mockReturnValueOnce(false);
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'a',
    }));

    expect(res.status).toBe(403);
    const body = await res.json();
    // Distinct from `feature-disabled` (flag-off) so ops can tell the two
    // failure modes apart in the route's response body.
    expect(body.error).toBe('cert-not-configured');
  });

  it('e2s impersonation: 403 impersonation-not-allowed', async () => {
    // The previous version of this suite skipped this case because the
    // auth mock was closed over a constant. Now that `currentAuthUser`
    // is a `let` read on every call, we can inject the impersonation
    // shape inline and assert the gate fires before any downstream work.
    currentAuthUser = { ...currentAuthUser, authType: 'e2s' };
    const { POST } = await import('../route');
    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'a',
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('impersonation-not-allowed');
    // Gate must short-circuit before CRM/Lambda are touched.
    expect(openCrmCaseMock).not.toHaveBeenCalled();
    expect(invokeInvestigatorMock).not.toHaveBeenCalled();
  });

  it('TLA (3-char shopperId): 403 internal-user-not-allowed', async () => {
    currentAuthUser = { ...currentAuthUser, shopperId: 'abc' };
    const { POST } = await import('../route');
    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'a',
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('internal-user-not-allowed');
    expect(openCrmCaseMock).not.toHaveBeenCalled();
    expect(invokeInvestigatorMock).not.toHaveBeenCalled();
  });
});
