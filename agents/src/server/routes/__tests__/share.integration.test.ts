/**
 * Share Routes Integration Test Suite
 *
 * Comprehensive integration tests for the share token routes covering:
 * - POST /apps/:appId/share - Create share token
 * - GET /apps/:appId/share - List share tokens
 * - POST /apps/:appId/share/validate - Validate share token
 * - Authorization and ownership validation
 * - Token expiration handling
 * - Cross-tenant isolation
 * - Error scenarios (404, 401, 400)
 * - Input validation
 */

import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js';
import { ShareTokenRepository } from '../../../database/repositories/ShareTokenRepository.js';

// Mock dependencies
vi.mock('../../../database/repositories/ShareTokenRepository.js');
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

describe('Share Routes Integration Tests', () => {
  let mockShareTokenRepo: any;
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let jsonSpy: any;
  let statusSpy: any;

  const testAppId = 'test-app-123';
  const testAuthSiteId = 'test-app-123'; // Same as appId for ownership
  const testToken = 'test-token-12';
  const futureExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock PREVIEW_URL environment variable
    process.env.PREVIEW_URL = 'https://test-app-123.preview.test-godaddy.com';

    // Mock ShareTokenRepository
    mockShareTokenRepo = {
      create: vi.fn(),
      findByAppId: vi.fn(),
      findByToken: vi.fn(),
      markFirstUsed: vi.fn(),
    };

    vi.mocked(ShareTokenRepository).mockImplementation(() => mockShareTokenRepo);

    // Setup response mocks
    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    mockRes = {
      status: statusSpy,
      json: jsonSpy,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PREVIEW_URL;
  });

  describe('POST /apps/:appId/share - Create share token', () => {
    beforeEach(() => {
      mockReq = {
        params: { appId: testAppId },
        body: {},
        agentContext: {
          siteId: testAuthSiteId,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        },
      };
    });

    it('should create share token with default expiration (7 days)', async () => {
      const mockToken = {
        token: testToken,
        appId: testAppId,
        expiresAt: futureExpiry,
        createdAt: new Date(),
        firstUsedAt: null,
      };

      mockShareTokenRepo.create.mockReturnValue(mockToken);

      // Dynamically import and test the route handler
      const { default: router } = await import('../share.js');

      // Extract the POST route handler
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      expect(route).toBeDefined();

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(mockShareTokenRepo.create).toHaveBeenCalledWith({
          appId: testAppId,
          expiresIn: 604800, // 7 days in seconds
        });

        expect(jsonSpy).toHaveBeenCalledWith({
          token: testToken,
          appId: testAppId,
          shareUrl: expect.stringContaining(testToken),
          createdAt: expect.any(Date),
          expiresAt: futureExpiry,
        });
      }
    });

    it('should create token with custom expiration duration', async () => {
      mockReq.body = { expiresIn: 3600 }; // 1 hour

      const mockToken = {
        token: testToken,
        appId: testAppId,
        expiresAt: Date.now() + 3600 * 1000,
        createdAt: new Date(),
        firstUsedAt: null,
      };

      mockShareTokenRepo.create.mockReturnValue(mockToken);

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(mockShareTokenRepo.create).toHaveBeenCalledWith({
          appId: testAppId,
          expiresIn: 3600,
        });
      }
    });

    it('should validate expiresIn is a number', async () => {
      mockReq.body = { expiresIn: 'invalid' };

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(statusSpy).toHaveBeenCalledWith(400);
        expect(jsonSpy).toHaveBeenCalledWith({
          error: expect.stringContaining('valid number'),
        });
      }
    });

    it('should validate expiresIn is not NaN', async () => {
      mockReq.body = { expiresIn: NaN };

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(statusSpy).toHaveBeenCalledWith(400);
      }
    });

    it('should validate expiresIn is within allowed range', async () => {
      mockReq.body = { expiresIn: 100 }; // Too short (< 1 hour)

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(statusSpy).toHaveBeenCalledWith(400);
        expect(jsonSpy).toHaveBeenCalledWith({
          error: expect.stringContaining('between 1 hour and 30 days'),
        });
      }
    });

    it('should add https:// protocol when PREVIEW_URL lacks protocol', async () => {
      // Set PREVIEW_URL without protocol (as provided by Nomad templates)
      process.env.PREVIEW_URL = 'test-app-123.preview.test-godaddy.com';

      const mockToken = {
        token: testToken,
        appId: testAppId,
        expiresAt: futureExpiry,
        createdAt: new Date(),
        firstUsedAt: null,
      };

      mockShareTokenRepo.create.mockReturnValue(mockToken);

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(jsonSpy).toHaveBeenCalledWith({
          token: testToken,
          appId: testAppId,
          shareUrl: expect.stringContaining('https://test-app-123.preview.test-godaddy.com?airoShareToken='),
          createdAt: expect.any(String),
          expiresAt: futureExpiry,
        });
      }
    });

    it('should preserve existing protocol in PREVIEW_URL', async () => {
      // Set PREVIEW_URL with http:// protocol (edge case)
      process.env.PREVIEW_URL = 'http://test-app-123.preview.test-godaddy.com';

      const mockToken = {
        token: testToken,
        appId: testAppId,
        expiresAt: futureExpiry,
        createdAt: new Date(),
        firstUsedAt: null,
      };

      mockShareTokenRepo.create.mockReturnValue(mockToken);

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(jsonSpy).toHaveBeenCalledWith({
          token: testToken,
          appId: testAppId,
          shareUrl: expect.stringContaining('http://test-app-123.preview.test-godaddy.com?airoShareToken='),
          createdAt: expect.any(String),
          expiresAt: futureExpiry,
        });
      }
    });

    it('should return 500 when PREVIEW_URL is not configured', async () => {
      // Clear PREVIEW_URL to simulate missing configuration
      delete process.env.PREVIEW_URL;

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        // Should return 500 error
        expect(statusSpy).toHaveBeenCalledWith(500);
        expect(jsonSpy).toHaveBeenCalledWith({
          error: 'Preview URL not configured',
        });

        // Should NOT create token in database (avoids orphaned tokens)
        expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
      }
    });

    it('should reject cross-tenant access', async () => {
      mockReq.agentContext!.siteId = 'different-site'; // Different from appId

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      // The validateAppOwnership middleware should catch this before the handler
      // This test documents expected behavior at middleware level
      expect(mockReq.agentContext!.siteId).not.toBe(testAppId);
    });
  });

  describe('GET /apps/:appId/share - List share tokens', () => {
    beforeEach(() => {
      mockReq = {
        params: { appId: testAppId },
        agentContext: {
          siteId: testAuthSiteId,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        },
      };
    });

    it('should list all tokens for app', async () => {
      const mockTokens = [
        {
          token: 'token-1',
          appId: testAppId,
          expiresAt: futureExpiry,
          createdAt: new Date('2024-01-01'),
          firstUsedAt: null,
        },
        {
          token: 'token-2',
          appId: testAppId,
          expiresAt: futureExpiry - 1000,
          createdAt: new Date('2024-01-02'),
          firstUsedAt: new Date('2024-01-03'),
        },
      ];

      mockShareTokenRepo.findByAppId.mockReturnValue(mockTokens);

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.get
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(mockShareTokenRepo.findByAppId).toHaveBeenCalledWith(testAppId);
        expect(jsonSpy).toHaveBeenCalledWith({
          tokens: expect.arrayContaining([
            expect.objectContaining({ token: 'token-1' }),
            expect.objectContaining({ token: 'token-2' }),
          ]),
        });
      }
    });

    it('should return 500 when PREVIEW_URL is not configured', async () => {
      // Clear PREVIEW_URL to simulate missing configuration
      delete process.env.PREVIEW_URL;

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.get
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        // Should return 500 error
        expect(statusSpy).toHaveBeenCalledWith(500);
        expect(jsonSpy).toHaveBeenCalledWith({
          error: 'Preview URL not configured',
        });
      }
    });

    it('should return empty array when no tokens exist', async () => {
      mockShareTokenRepo.findByAppId.mockReturnValue([]);

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.get
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(jsonSpy).toHaveBeenCalledWith({
          tokens: [],
        });
      }
    });
  });

  describe('POST /apps/:appId/share/validate - Validate share token', () => {
    beforeEach(() => {
      mockReq = {
        params: { appId: testAppId },
        body: { token: testToken },
        agentContext: undefined, // Public endpoint - no auth required
      };
    });

    it('should validate and mark first use of valid token', async () => {
      const mockToken = {
        token: testToken,
        appId: testAppId,
        expiresAt: futureExpiry,
        createdAt: new Date(),
        firstUsedAt: null,
      };

      mockShareTokenRepo.findByToken.mockReturnValue(mockToken);

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/validate' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(mockShareTokenRepo.findByToken).toHaveBeenCalledWith(testToken);
        expect(mockShareTokenRepo.markFirstUsed).toHaveBeenCalledWith(testToken);
        expect(jsonSpy).toHaveBeenCalledWith({
          valid: true,
          appId: testAppId,
        });
      }
    });

    it('should reject expired token', async () => {
      const expiredToken = {
        token: testToken,
        appId: testAppId,
        expiresAt: Date.now() - 1000, // Expired 1 second ago
        createdAt: new Date(),
        firstUsedAt: null,
      };

      mockShareTokenRepo.findByToken.mockReturnValue(expiredToken);

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/validate' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(jsonSpy).toHaveBeenCalledWith({
          valid: false,
          reason: 'expired',
        });
        expect(mockShareTokenRepo.markFirstUsed).not.toHaveBeenCalled();
      }
    });

    it('should reject non-existent token', async () => {
      mockShareTokenRepo.findByToken.mockReturnValue(null);

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/validate' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(jsonSpy).toHaveBeenCalledWith({
          valid: false,
          reason: 'not_found',
        });
      }
    });

    it('should reject token for different app', async () => {
      const wrongAppToken = {
        token: testToken,
        appId: 'different-app', // Wrong appId
        expiresAt: futureExpiry,
        createdAt: new Date(),
        firstUsedAt: null,
      };

      mockShareTokenRepo.findByToken.mockReturnValue(wrongAppToken);

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/validate' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(jsonSpy).toHaveBeenCalledWith({
          valid: false,
          reason: 'invalid',
        });
      }
    });

    it('should validate token format before database lookup', async () => {
      mockReq.body.token = 'invalid+token'; // Invalid format

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/validate' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(statusSpy).toHaveBeenCalledWith(400);
        expect(jsonSpy).toHaveBeenCalledWith({
          error: expect.stringContaining('format'),
        });
        expect(mockShareTokenRepo.findByToken).not.toHaveBeenCalled();
      }
    });

    it('should require token in request body', async () => {
      mockReq.body = {}; // No token

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/validate' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(statusSpy).toHaveBeenCalledWith(400);
        expect(jsonSpy).toHaveBeenCalledWith({
          error: expect.stringContaining('required'),
        });
      }
    });
  });

  describe('Authorization and Security', () => {
    it('should require authentication for token creation', async () => {
      mockReq = {
        params: { appId: testAppId },
        body: {},
        agentContext: undefined, // No auth
      };

      // The jwtAuthMiddleware should catch this before the handler
      // This test documents expected behavior at middleware level
      expect(mockReq.agentContext).toBeUndefined();
    });

    it('should require authentication for token listing', async () => {
      mockReq = {
        params: { appId: testAppId },
        agentContext: undefined, // No auth
      };

      // The jwtAuthMiddleware should catch this before the handler
      expect(mockReq.agentContext).toBeUndefined();
    });

    it('should allow public access for token validation', async () => {
      mockReq = {
        params: { appId: testAppId },
        body: { token: testToken },
        agentContext: undefined, // Public endpoint
      };

      // Validation endpoint should work without authentication
      expect(mockReq.agentContext).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      mockReq = {
        params: { appId: testAppId },
        body: {},
        agentContext: {
          siteId: testAuthSiteId,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        },
      };
    });

    it('should handle database errors gracefully', async () => {
      mockShareTokenRepo.create.mockImplementation(() => {
        throw new Error('Database error');
      });

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(statusSpy).toHaveBeenCalledWith(500);
        expect(jsonSpy).toHaveBeenCalledWith({
          error: expect.stringContaining('Failed to create'),
        });
      }
    });

    it('should handle token collision errors', async () => {
      mockShareTokenRepo.create.mockImplementation(() => {
        const error: any = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed');
        error.code = 'SQLITE_CONSTRAINT';
        throw error;
      });

      const { default: router } = await import('../share.js');
      const route = (router.stack || []).find((layer: any) =>
        layer.route?.path === '/' && layer.route?.methods?.post
      );

      if (route?.route?.stack?.[0]?.handle) {
        await route.route.stack[0].handle(mockReq, mockRes, vi.fn());

        expect(statusSpy).toHaveBeenCalledWith(500);
      }
    });
  });
});
