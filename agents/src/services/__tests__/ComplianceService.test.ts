import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@airo/ai-lib', () => ({
  getS2SToken: vi.fn().mockResolvedValue('test-s2s-token'),
}));

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/gd-env.js', () => ({
  resolveEnv: vi.fn().mockReturnValue('dev'),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { complianceService } from '../ComplianceService.js';

describe('ComplianceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

      const result = await complianceService.generateDocument({
        documentType: 'privacy-policy',
        businessName: 'Test Business',
        email: 'test@example.com',
        children: false,
        customerId: 'cust-123',
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
            'x-customer-id': 'cust-123',
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
        }),
      ).rejects.toThrow();
    });
  });
});
