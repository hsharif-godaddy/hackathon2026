import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BudgetInsufficientCreditsError, BudgetNoCapacityError } from '@airo/ai-lib/budget';

const { mockGetClient, mockDeduct, mockMemGet, mockMemSet } = vi.hoisted(() => ({
  mockGetClient: vi.fn(),
  mockDeduct: vi.fn(),
  mockMemGet: vi.fn(),
  mockMemSet: vi.fn(),
}));

vi.mock('../../../services/budget-service-instance.js', () => ({
  getBudgetServiceClient: mockGetClient,
}));

vi.mock('../../../database/repositories/MemoryRepository.js', () => ({
  MemoryRepository: class {
    get = mockMemGet;
    set = mockMemSet;
  },
}));

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { chargeForComplianceDoc } from '../charge.js';
import { DocumentType } from '../../../services/ComplianceService.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockDeduct.mockReset();
  mockMemGet.mockResolvedValue({ success: true, exists: false });
  mockMemSet.mockResolvedValue({ success: true });
});

describe('chargeForComplianceDoc', () => {
  it('skips (ok) when no budget client is configured (e.g. local stack)', async () => {
    mockGetClient.mockReturnValue(null);
    const res = await chargeForComplianceDoc({ bmsBudgetId: 'b1', appId: 'app1', documentType: DocumentType.PrivacyPolicy });
    expect(res).toEqual({ ok: true });
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it('skips (ok) when budgeting is configured but bmsBudgetId is missing', async () => {
    mockGetClient.mockReturnValue({ deductCredits: mockDeduct });
    const res = await chargeForComplianceDoc({ bmsBudgetId: undefined, appId: 'app1', documentType: DocumentType.PrivacyPolicy });
    expect(res).toEqual({ ok: true });
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it('charges 1 credit with a deterministic idempotency key on success', async () => {
    mockDeduct.mockResolvedValue({});
    mockGetClient.mockReturnValue({ deductCredits: mockDeduct });
    const res = await chargeForComplianceDoc({ bmsBudgetId: 'b1', appId: 'app1', documentType: DocumentType.TermsOfUse });
    expect(res).toEqual({ ok: true });
    expect(mockDeduct).toHaveBeenCalledWith('b1', {
      credits: '1',
      idempotencyKey: 'compliance-doc:app1:terms-of-use',
      reason: 'compliance-doc:terms-of-use',
      metadata: { appId: 'app1', documentType: 'terms-of-use', kind: 'compliance-doc' },
    });
  });

  it('sets the charged memory marker after a successful charge', async () => {
    mockDeduct.mockResolvedValue({});
    mockGetClient.mockReturnValue({ deductCredits: mockDeduct });
    await chargeForComplianceDoc({ bmsBudgetId: 'b1', appId: 'app1', documentType: DocumentType.PrivacyPolicy });
    expect(mockMemSet).toHaveBeenCalledWith('app1', 'compliance.document.privacy-policy.charged', true);
  });

  it('short-circuits (no BMS call) when the charged memory marker is already present', async () => {
    mockMemGet.mockResolvedValue({ success: true, exists: true, value: true });
    mockGetClient.mockReturnValue({ deductCredits: mockDeduct });
    const res = await chargeForComplianceDoc({ bmsBudgetId: 'b1', appId: 'app1', documentType: DocumentType.TermsOfUse });
    expect(res).toEqual({ ok: true });
    expect(mockDeduct).not.toHaveBeenCalled();
    expect(mockMemSet).not.toHaveBeenCalled();
  });

  it('still charges when the marker read fails (marker is best-effort, not authoritative)', async () => {
    mockMemGet.mockResolvedValue({ success: false, exists: false, error: 'db down' });
    mockDeduct.mockResolvedValue({});
    mockGetClient.mockReturnValue({ deductCredits: mockDeduct });
    const res = await chargeForComplianceDoc({ bmsBudgetId: 'b1', appId: 'app1', documentType: DocumentType.PrivacyPolicy });
    expect(res).toEqual({ ok: true });
    expect(mockDeduct).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when the marker write fails after a successful charge', async () => {
    mockMemSet.mockResolvedValue({ success: false, error: 'db down' });
    mockDeduct.mockResolvedValue({});
    mockGetClient.mockReturnValue({ deductCredits: mockDeduct });
    const res = await chargeForComplianceDoc({ bmsBudgetId: 'b1', appId: 'app1', documentType: DocumentType.PrivacyPolicy });
    expect(res).toEqual({ ok: true });
  });

  it('blocks (not ok) with a user-facing message on insufficient credits', async () => {
    mockDeduct.mockRejectedValue(new BudgetInsufficientCreditsError('1.000000', '0.000000'));
    mockGetClient.mockReturnValue({ deductCredits: mockDeduct });
    const res = await chargeForComplianceDoc({ bmsBudgetId: 'b1', appId: 'app1', documentType: DocumentType.PrivacyPolicy });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not enough credits/i);
  });

  it('blocks (not ok) on no budget capacity', async () => {
    mockDeduct.mockRejectedValue(new BudgetNoCapacityError('no capacity'));
    mockGetClient.mockReturnValue({ deductCredits: mockDeduct });
    const res = await chargeForComplianceDoc({ bmsBudgetId: 'b1', appId: 'app1', documentType: DocumentType.PrivacyPolicy });
    expect(res.ok).toBe(false);
  });

  it('does not set the charged marker when the charge fails', async () => {
    mockDeduct.mockRejectedValue(new Error('boom'));
    mockGetClient.mockReturnValue({ deductCredits: mockDeduct });
    const res = await chargeForComplianceDoc({ bmsBudgetId: 'b1', appId: 'app1', documentType: DocumentType.PrivacyPolicy });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/could not process/i);
    expect(mockMemSet).not.toHaveBeenCalled();
  });
});
