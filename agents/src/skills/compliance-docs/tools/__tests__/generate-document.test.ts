import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockMemorySet, mockMemoryGet, mockCharge, mockChargeConfirmed } = vi.hoisted(() => ({
  mockMemorySet: vi.fn().mockResolvedValue({ success: true }),
  mockMemoryGet: vi.fn().mockResolvedValue({ success: true, exists: false }),
  mockCharge: vi.fn().mockResolvedValue({ ok: true }),
  mockChargeConfirmed: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../services/ComplianceService.js', () => ({
  DocumentType: {
    PrivacyPolicy: 'privacy-policy',
    TermsOfUse: 'terms-of-use',
  },
  complianceDocStatusMemoryKey: (documentType: string) => `compliance.document.${documentType}.generated`,
  complianceDocChargedMemoryKey: (documentType: string) => `compliance.document.${documentType}.charged`,
  complianceService: {
    generateDocument: vi.fn(),
  },
}));

vi.mock('../../charge.js', () => ({
  chargeForComplianceDoc: mockCharge,
  isComplianceChargeConfirmed: mockChargeConfirmed,
}));

vi.mock('../../pricing.js', () => ({
  getComplianceDocPricing: () => ({ cost: 1, showCost: true }),
}));

vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: {
    findById: vi.fn(),
  },
}));

vi.mock('../../../../database/repositories/MemoryRepository.js', () => ({
  MemoryRepository: class {
    set = mockMemorySet;
    get = mockMemoryGet;
  },
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

const { mockReadAppFqdn } = vi.hoisted(() => ({
  mockReadAppFqdn: vi.fn(),
}));

vi.mock('../../../../lib/app-fqdn.js', () => ({
  readAppFqdn: mockReadAppFqdn,
}));

import { generatePrivacyPolicyTool, generateTermsOfUseTool, getPurchasedDomainTool, requestChargeConfirmationTool } from '../index.js';
import { complianceService } from '../../../../services/ComplianceService.js';
import { appRepository } from '../../../../database/repositories/index.js';
import { writeFile } from 'fs/promises';

const mockGenerateDocument = vi.mocked(complianceService.generateDocument);
const mockFindById = vi.mocked(appRepository.findById);
const mockWriteFile = vi.mocked(writeFile);

describe('generate_privacy_policy tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCharge.mockResolvedValue({ ok: true });
    mockChargeConfirmed.mockResolvedValue(true);
    mockMemoryGet.mockResolvedValue({ success: true, exists: false });
  });

  it('blocks generation and does not charge when the charge is not confirmed', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockChargeConfirmed.mockResolvedValue(false);

    const result = await generatePrivacyPolicyTool.execute(
      {
        businessName: 'Test Biz',
        email: 'test@example.com',
        children: false,
      },
      { metadata: { appId: 'app-123', bmsBudgetId: 'budget-xyz' } },
    );

    expect(result).toMatchObject({ error: expect.stringContaining('request_charge_confirmation') });
    expect(mockCharge).not.toHaveBeenCalled();
    expect(mockGenerateDocument).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('returns error when no customerId can be resolved', async () => {
    mockFindById.mockReturnValue(null);

    const result = await generatePrivacyPolicyTool.execute(
      {
        businessName: 'Test Biz',
        email: 'test@example.com',
        children: false,
      },
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toEqual({ error: 'Unable to determine customer identity for document generation' });
  });

  it('returns error when no appPath can be resolved', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc' } as any);

    const result = await generatePrivacyPolicyTool.execute(
      {
        businessName: 'Test Biz',
        email: 'test@example.com',
        children: false,
      },
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toEqual({ error: 'Unable to determine app path for file creation' });
  });

  it('generates privacy policy and writes page file', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockGenerateDocument.mockResolvedValue({
      documentType: 'privacy-policy',
      markdown: '# Privacy Policy\n\nContent here.',
    });

    const result = await generatePrivacyPolicyTool.execute(
      {
        businessName: 'Test Biz',
        email: 'test@example.com',
        children: false,
      },
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toEqual({
      text: expect.stringContaining('privacy.tsx'),
      documentType: 'privacy-policy',
      filePath: 'src/pages/privacy.tsx',
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('src/pages/privacy.tsx'),
      expect.stringContaining('# Privacy Policy'),
    );

    expect(mockGenerateDocument).toHaveBeenCalledWith({
      documentType: 'privacy-policy',
      businessName: 'Test Biz',
      email: 'test@example.com',
      children: false,
      customerId: 'cust-abc',
      appId: 'app-123',
    });
  });

  it('returns error message on service failure', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockGenerateDocument.mockRejectedValue(new Error('Compliance API error: 500 Internal Server Error'));

    const result = await generatePrivacyPolicyTool.execute(
      {
        businessName: 'Test Biz',
        email: 'test@example.com',
        children: false,
      },
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toEqual({
      error: expect.stringContaining('Failed to generate privacy policy'),
    });
  });

  it('blocks generation and returns the charge error when the credit charge fails', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockCharge.mockResolvedValue({ ok: false, error: 'Not enough credits to generate this document.' });

    const result = await generatePrivacyPolicyTool.execute(
      {
        businessName: 'Test Biz',
        email: 'test@example.com',
        children: false,
      },
      { metadata: { appId: 'app-123', bmsBudgetId: 'budget-xyz' } },
    );

    expect(result).toEqual({ error: 'Not enough credits to generate this document.' });
    expect(mockGenerateDocument).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('charges with the budget id from context metadata and the privacy-policy type before generating', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockGenerateDocument.mockResolvedValue({
      documentType: 'privacy-policy',
      markdown: '# Privacy Policy\n\nContent here.',
    });

    const result = await generatePrivacyPolicyTool.execute(
      {
        businessName: 'Test Biz',
        email: 'test@example.com',
        children: false,
      },
      { metadata: { appId: 'app-123', bmsBudgetId: 'budget-xyz' } },
    );

    expect(mockCharge).toHaveBeenCalledWith({
      bmsBudgetId: 'budget-xyz',
      appId: 'app-123',
      documentType: 'privacy-policy',
    });
    expect(mockGenerateDocument).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ documentType: 'privacy-policy', filePath: 'src/pages/privacy.tsx' });
  });
});

describe('generate_terms_of_use tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCharge.mockResolvedValue({ ok: true });
    mockChargeConfirmed.mockResolvedValue(true);
    mockMemoryGet.mockResolvedValue({ success: true, exists: false });
  });

  it('blocks generation and does not charge when the charge is not confirmed', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockChargeConfirmed.mockResolvedValue(false);

    const result = await generateTermsOfUseTool.execute(
      {
        businessName: 'Test Biz',
        domainName: 'testbiz.com',
        children: false,
        jurisdiction: 'Texas',
      },
      { metadata: { appId: 'app-123', bmsBudgetId: 'budget-xyz' } },
    );

    expect(result).toMatchObject({ error: expect.stringContaining('request_charge_confirmation') });
    expect(mockCharge).not.toHaveBeenCalled();
    expect(mockGenerateDocument).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('returns error when no customerId can be resolved', async () => {
    mockFindById.mockReturnValue(null);

    const result = await generateTermsOfUseTool.execute(
      {
        businessName: 'Test Biz',
        domainName: 'testbiz.com',
        children: false,
        jurisdiction: 'Texas',
      },
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toEqual({ error: 'Unable to determine customer identity for document generation' });
  });

  it('returns error when no appPath can be resolved', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc' } as any);

    const result = await generateTermsOfUseTool.execute(
      {
        businessName: 'Test Biz',
        domainName: 'testbiz.com',
        children: false,
        jurisdiction: 'Texas',
      },
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toEqual({ error: 'Unable to determine app path for file creation' });
  });

  it('generates terms of use and writes page file', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockGenerateDocument.mockResolvedValue({
      documentType: 'terms-of-use',
      markdown: '# Terms of Use\n\nContent here.',
    });

    const result = await generateTermsOfUseTool.execute(
      {
        businessName: 'Test Biz',
        domainName: 'testbiz.com',
        children: false,
        jurisdiction: 'Texas',
      },
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toEqual({
      text: expect.stringContaining('terms.tsx'),
      documentType: 'terms-of-use',
      filePath: 'src/pages/terms.tsx',
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('src/pages/terms.tsx'),
      expect.stringContaining('# Terms of Use'),
    );

    expect(mockGenerateDocument).toHaveBeenCalledWith({
      documentType: 'terms-of-use',
      businessName: 'Test Biz',
      domainName: 'testbiz.com',
      children: false,
      jurisdiction: 'Texas',
      customerId: 'cust-abc',
      appId: 'app-123',
    });
  });

  it('returns error message on service failure', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockGenerateDocument.mockRejectedValue(new Error('Compliance API error: 500 Internal Server Error'));

    const result = await generateTermsOfUseTool.execute(
      {
        businessName: 'Test Biz',
        domainName: 'testbiz.com',
        children: false,
        jurisdiction: 'Texas',
      },
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toEqual({
      error: expect.stringContaining('Failed to generate terms of use'),
    });
  });

  it('blocks generation and returns the charge error when the credit charge fails', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockCharge.mockResolvedValue({ ok: false, error: 'Not enough credits to generate this document.' });

    const result = await generateTermsOfUseTool.execute(
      {
        businessName: 'Test Biz',
        domainName: 'testbiz.com',
        children: false,
        jurisdiction: 'Texas',
      },
      { metadata: { appId: 'app-123', bmsBudgetId: 'budget-xyz' } },
    );

    expect(result).toEqual({ error: 'Not enough credits to generate this document.' });
    expect(mockGenerateDocument).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('charges with the budget id from context metadata and the terms-of-use type before generating', async () => {
    mockFindById.mockReturnValue({ customerId: 'cust-abc', path: '/tmp/apps/app-123' } as any);
    mockGenerateDocument.mockResolvedValue({
      documentType: 'terms-of-use',
      markdown: '# Terms of Use\n\nContent here.',
    });

    const result = await generateTermsOfUseTool.execute(
      {
        businessName: 'Test Biz',
        domainName: 'testbiz.com',
        children: false,
        jurisdiction: 'Texas',
      },
      { metadata: { appId: 'app-123', bmsBudgetId: 'budget-xyz' } },
    );

    expect(mockCharge).toHaveBeenCalledWith({
      bmsBudgetId: 'budget-xyz',
      appId: 'app-123',
      documentType: 'terms-of-use',
    });
    expect(mockGenerateDocument).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ documentType: 'terms-of-use', filePath: 'src/pages/terms.tsx' });
  });
});

describe('request_charge_confirmation tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryGet.mockResolvedValue({ success: true, exists: false });
  });

  it('is a stop-after tool so the turn pauses for the user', () => {
    expect(requestChargeConfirmationTool.config?.stopAfter).toBe(true);
  });

  it('returns the charge-confirm widget with raw pricing (localized client-side)', async () => {
    const result = await requestChargeConfirmationTool.execute(
      { documentType: 'privacy-policy' },
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toMatchObject({
      widgetType: 'compliance-charge-confirm',
      widgetData: {
        documentType: 'privacy-policy',
        cost: 1,
        showCost: true,
      },
    });
  });

  it('errors without an appId', async () => {
    const result = await requestChargeConfirmationTool.execute(
      { documentType: 'privacy-policy' },
      { metadata: {} },
    );

    expect(result).toMatchObject({ error: expect.stringContaining('app identity') });
  });
});

describe('get_purchased_domain tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the persisted domain when one is available', async () => {
    mockReadAppFqdn.mockReturnValue('studiosketch.com');

    const result = await getPurchasedDomainTool.execute(
      {},
      { metadata: { appId: 'app-123' } },
    );

    expect(mockReadAppFqdn).toHaveBeenCalledWith('app-123', { metadata: { appId: 'app-123' } });
    expect(result).toEqual({ available: true, domainName: 'studiosketch.com' });
  });

  it('reports no domain available when none is on file', async () => {
    mockReadAppFqdn.mockReturnValue(undefined);

    const result = await getPurchasedDomainTool.execute(
      {},
      { metadata: { appId: 'app-123' } },
    );

    expect(result).toEqual(
      expect.objectContaining({ available: false }),
    );
    expect(result).not.toHaveProperty('domainName');
  });
});
