import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Response } from 'express';

import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js';

vi.mock('../../../database/repositories/index.js', () => ({
  oauthTokenRepository: {
    findOne: vi.fn(),
  },
}));

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (_req: any, _res: any, next: any) => next(),
}));

import { oauthTokenRepository } from '../../../database/repositories/index.js';

const mockOAuthRepo = vi.mocked(oauthTokenRepository);

describe('Transfer Validate Routes', function transferValidateTests() {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let jsonSpy: ReturnType<typeof vi.fn>;
  let statusSpy: ReturnType<typeof vi.fn>;

  const testAppId = 'test-app-123';

  beforeEach(function setup() {
    vi.clearAllMocks();

    mockReq = {
      params: { id: testAppId },
      agentContext: {
        siteId: testAppId,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      },
    };

    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    mockRes = {
      status: statusSpy,
      json: jsonSpy,
    };
  });

  describe('GET /apps/:id/transfer/validate', function validateTests() {
    it('should return canTransfer true when no godaddy token exists', async function noToken() {
      mockOAuthRepo.findOne.mockReturnValue(null);

      const { default: router } = await import('../transfer-validate.js');
      const handler = router.stack
        .find((layer: any) => layer.route?.path === '/apps/:id/transfer/validate' && layer.route?.methods?.get)
        ?.route?.stack[0]?.handle;

      expect(handler).toBeDefined();
      handler!(mockReq as any, mockRes as any);

      expect(mockOAuthRepo.findOne).toHaveBeenCalledWith(testAppId, 'godaddy');
      expect(jsonSpy).toHaveBeenCalledWith({ canTransfer: true, gdCommerce: false });
    });

    it('should return canTransfer false when godaddy token exists', async function hasToken() {
      mockOAuthRepo.findOne.mockReturnValue({
        id: 1,
        appId: testAppId,
        provider: 'godaddy',
        scopes: 'commerce',
        accessTokenEncrypted: 'encrypted',
        accessTokenIv: 'iv',
        accessTokenTag: 'tag',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);

      const { default: router } = await import('../transfer-validate.js');
      const handler = router.stack
        .find((layer: any) => layer.route?.path === '/apps/:id/transfer/validate' && layer.route?.methods?.get)
        ?.route?.stack[0]?.handle;

      expect(handler).toBeDefined();
      handler!(mockReq as any, mockRes as any);

      expect(mockOAuthRepo.findOne).toHaveBeenCalledWith(testAppId, 'godaddy');
      expect(jsonSpy).toHaveBeenCalledWith({ canTransfer: false, gdCommerce: true });
    });

    it('should return 500 when repository throws', async function repoError() {
      mockOAuthRepo.findOne.mockImplementation(() => {
        throw new Error('Database error');
      });

      const { default: router } = await import('../transfer-validate.js');
      const handler = router.stack
        .find((layer: any) => layer.route?.path === '/apps/:id/transfer/validate' && layer.route?.methods?.get)
        ?.route?.stack[0]?.handle;

      expect(handler).toBeDefined();
      handler!(mockReq as any, mockRes as any);

      expect(statusSpy).toHaveBeenCalledWith(500);
      expect(jsonSpy).toHaveBeenCalledWith({ error: 'Failed to validate transfer eligibility' });
    });
  });
});
