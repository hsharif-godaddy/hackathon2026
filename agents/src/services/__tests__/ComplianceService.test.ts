import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetS2SToken, mockResolveEnv } = vi.hoisted(() => ({
  mockGetS2SToken: vi.fn(),
  mockResolveEnv: vi.fn(),
}));

vi.mock('@airo/ai-lib', () => ({
  getS2SToken: mockGetS2SToken,
}));

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/gd-env.js', () => ({
  resolveEnv: mockResolveEnv,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { complianceService } from '../ComplianceService.js';

describe('ComplianceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveEnv.mockReturnValue('dev');
    mockGetS2SToken.mockResolvedValue('test-s2s-token');
    delete process.env.COMPLIANCE_API_URL;
  });

  afterEach(() => {
    delete process.env.COMPLIANCE_API_URL;
  });

  describe('generateDocument', () => {
    it('generates a privacy policy with correct request shape', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          documentType: 'privacy-policy',
          markdown: '# Privacy Policy\n\nThis is the privacy policy for Test Business.',
        }),
      });

      // Valid UUID is forwarded unchanged (non-UUID values fall back to the
      // zero UUID — see the dedicated fallback test below).
      const validCustomerId = '123e4567-e89b-12d3-a456-426614174000';
      const result = await complianceService.generateDocument({
        documentType: 'privacy-policy',
        businessName: 'Test Business',
        email: 'test@example.com',
        children: false,
        customerId: validCustomerId,
        appId: 'app-001',
      });

      expect(result).toEqual({
        documentType: 'privacy-policy',
        markdown: '# Privacy Policy\n\nThis is the privacy policy for Test Business.',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://compliance-agent.mvci.api.dev-godaddy.com/api/document/generate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-s2s-token',
            'x-app-key': 'airo-app-builder',
            'x-app-id': 'app-001',
            'x-customer-id': validCustomerId,
          }),
          body: JSON.stringify({
            documentType: 'privacy-policy',
            businessName: 'Test Business',
            email: 'test@example.com',
            children: false,
          }),
        }),
      );
    });

    it('falls back to the zero UUID when customerId is not a valid UUID and we are running locally', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          documentType: 'privacy-policy',
          markdown: '# Privacy Policy',
        }),
      });

      // Vitest sets NODE_ENV='test', which the resolver treats as local — so
      // a non-UUID customerId is substituted with the nil UUID instead of
      // throwing. Hosted environments take the reject path (next test).
      await complianceService.generateDocument({
        documentType: 'privacy-policy',
        businessName: 'Test Business',
        email: 'test@example.com',
        children: false,
        customerId: 'local-user-001',
        appId: 'app-001',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://compliance-agent.mvci.api.dev-godaddy.com/api/document/generate',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-customer-id': '00000000-0000-0000-0000-000000000000',
          }),
        }),
      );
    });

    it('rejects non-UUID customerId in hosted environments', async () => {
      // Pretend we are running in a hosted container (no `local.*` GASKET_ENV
      // and NODE_ENV is something other than 'test'). The service must refuse
      // to substitute the nil UUID — silently mis-attributing generated legal
      // docs to a placeholder customer is a worse failure mode than throwing.
      const originalGasket = process.env.GASKET_ENV;
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.GASKET_ENV = 'dev-private';
      process.env.NODE_ENV = 'production';
      try {
        await expect(
          complianceService.generateDocument({
            documentType: 'privacy-policy',
            businessName: 'Test Business',
            email: 'test@example.com',
            children: false,
            customerId: 'local-user-001',
            appId: 'app-001',
          }),
        ).rejects.toThrow('customerId must be a UUID');
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        if (originalGasket === undefined) delete process.env.GASKET_ENV; else process.env.GASKET_ENV = originalGasket;
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('generates a terms of use with correct request shape', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          documentType: 'terms-of-use',
          markdown: '# Terms of Use\n\nThese terms govern use of Test Business.',
        }),
      });

      const result = await complianceService.generateDocument({
        documentType: 'terms-of-use',
        businessName: 'Test Business',
        domainName: 'testbusiness.com',
        children: false,
        jurisdiction: 'California',
        customerId: 'cust-456',
        appId: 'app-002',
      });

      expect(result).toEqual({
        documentType: 'terms-of-use',
        markdown: '# Terms of Use\n\nThese terms govern use of Test Business.',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://compliance-agent.mvci.api.dev-godaddy.com/api/document/generate',
        expect.objectContaining({
          body: JSON.stringify({
            documentType: 'terms-of-use',
            businessName: 'Test Business',
            domainName: 'testbusiness.com',
            children: false,
            jurisdiction: 'California',
          }),
        }),
      );
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'Validation failed' }),
      });

      await expect(
        complianceService.generateDocument({
          documentType: 'privacy-policy',
          businessName: 'Test',
          email: 'test@example.com',
          children: false,
          customerId: 'cust-123',
          appId: 'app-001',
        }),
      ).rejects.toThrow('Compliance API error: 400');
    });

    it('throws on timeout', async () => {
      mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'TimeoutError'));

      await expect(
        complianceService.generateDocument({
          documentType: 'privacy-policy',
          businessName: 'Test',
          email: 'test@example.com',
          children: false,
          customerId: 'cust-123',
          appId: 'app-001',
        }),
      ).rejects.toThrow();
    });

    it('throws and normalizes a generic network error', async () => {
      mockFetch.mockRejectedValue(new Error('network down'));

      await expect(
        complianceService.generateDocument({
          documentType: 'privacy-policy',
          businessName: 'Test',
          email: 'test@example.com',
          children: false,
          customerId: 'cust-123',
        }),
      ).rejects.toThrow('network down');
    });

    it('propagates a non-Error rejection as an Error', async () => {
      mockFetch.mockRejectedValue('boom');

      await expect(
        complianceService.generateDocument({
          documentType: 'privacy-policy',
          businessName: 'Test',
          email: 'test@example.com',
          children: false,
          customerId: 'cust-123',
        }),
      ).rejects.toThrow('boom');
    });

    it('prefers COMPLIANCE_API_URL override when set', async () => {
      process.env.COMPLIANCE_API_URL = 'https://compliance-override.example.test';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documentType: 'privacy-policy', markdown: '# Privacy Policy' }),
      });

      await complianceService.generateDocument({
        documentType: 'privacy-policy',
        businessName: 'Test Business',
        email: 'test@example.com',
        children: false,
        customerId: 'cust-123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://compliance-override.example.test/api/document/generate',
        expect.any(Object),
      );
    });

    it('resolves the prod base URL when env is prod', async () => {
      mockResolveEnv.mockReturnValue('prod');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documentType: 'privacy-policy', markdown: '# Privacy Policy' }),
      });

      await complianceService.generateDocument({
        documentType: 'privacy-policy',
        businessName: 'Test Business',
        email: 'test@example.com',
        children: false,
        customerId: 'cust-123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://compliance-agent.mvci.api.godaddy.com/api/document/generate',
        expect.any(Object),
      );
    });
  });
});
