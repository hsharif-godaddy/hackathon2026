import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  validateAppOwnership,
  validateAppOwnershipFromBody,
  validateAppOwnershipFromQuery,
  validateConversationOwnership
} from '../app-ownership.js';
import { AuthenticatedRequest } from '../jwt-auth.js';
import { BYPASS_SITE_IDS } from '../../../services/index.js';

describe('validateAppOwnership middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: any;
  let statusSpy: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup request mock
    mockReq = {
      params: {},
      path: '/apps/test-app/git/replace',
      method: 'POST',
      agentContext: {
        siteId: 'authenticated-site',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      },
    };

    // Setup response mock
    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    mockRes = {
      status: statusSpy,
      json: jsonSpy,
    };

    // Setup next mock
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication context validation', () => {
    it('should return 401 when agentContext is missing', () => {
      delete mockReq.agentContext;

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Authentication required',
        requiresAuth: true,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when siteId is missing from agentContext', () => {
      mockReq.agentContext = {
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      } as any;

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Authentication required',
        requiresAuth: true,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Request parameter validation', () => {
    it('should return 400 when appId parameter is missing', () => {
      mockReq.params = {};

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'App ID is required',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Bypass site validation', () => {

    BYPASS_SITE_IDS.forEach((bypassSite) => {
      describe(`when authenticated with bypass site: ${bypassSite}`, () => {
        it('should allow access to any app (same site)', () => {
          mockReq.params = { id: bypassSite };
          mockReq.agentContext = {
            siteId: bypassSite,
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
          };

          validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

          expect(mockNext).toHaveBeenCalled();
          expect(statusSpy).not.toHaveBeenCalled();
        });

        it('should allow access to any app (different site)', () => {
          mockReq.params = { id: 'any-other-app-123' };
          mockReq.agentContext = {
            siteId: bypassSite,
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
          };

          validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

          expect(mockNext).toHaveBeenCalled();
          expect(statusSpy).not.toHaveBeenCalled();
        });
      });
    });

    it('should allow bypass sites to access multiple different apps', () => {
      const testCases = [
        { bypassSite: 'bypass-site', targetApp: 'app-1' },
        { bypassSite: 'default-site', targetApp: 'app-2' },
        { bypassSite: 'local-dev-site', targetApp: 'app-3' },
        { bypassSite: 'mock-site-id', targetApp: 'app-4' },
        { bypassSite: 'unknown-site', targetApp: 'app-5' },
      ];

      testCases.forEach(({ bypassSite, targetApp }) => {
        vi.clearAllMocks();

        mockReq.params = { id: targetApp };
        mockReq.agentContext = {
          siteId: bypassSite,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        };

        validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(statusSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('Site isolation validation', () => {
    it('should return 403 when siteId does not match requested appId', () => {
      mockReq.params = { id: 'different-app' };
      mockReq.agentContext = {
        siteId: 'authenticated-site',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Access denied',
        message: 'Agent can only access its authenticated site',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() when siteId matches requested appId', () => {
      mockReq.params = { id: 'authenticated-site' };
      mockReq.agentContext = {
        siteId: 'authenticated-site',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should allow access when agent accesses its own site', () => {
      const siteId = 'my-site-123';
      mockReq.params = { id: siteId };
      mockReq.agentContext = {
        siteId,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should enforce isolation for non-bypass sites', () => {
      const regularSites = ['production-site', 'user-site-123', 'customer-app'];

      regularSites.forEach((siteId) => {
        vi.clearAllMocks();

        mockReq.params = { id: 'different-app' };
        mockReq.agentContext = {
          siteId,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        };

        validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

        expect(statusSpy).toHaveBeenCalledWith(403);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });
  });

  describe('Error handling', () => {
    it('should return 500 when an unexpected error occurs', () => {
      // Mock Request to throw error when accessing params
      const errorReq = {
        get params() {
          throw new Error('Unexpected error');
        },
        path: '/apps/test-app/git/replace',
        method: 'POST',
        agentContext: {
          siteId: 'authenticated-site',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        },
      };

      validateAppOwnership(errorReq as unknown as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(500);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Internal server error',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Integration scenarios', () => {
    it('should validate complete happy path', () => {
      const siteId = 'app-123';
      mockReq.params = { id: siteId };
      mockReq.agentContext = {
        siteId,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should deny access when trying to access different site', () => {
      mockReq.params = { id: 'other-site-456' };
      mockReq.agentContext = {
        siteId: 'my-site-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Access denied',
        message: 'Agent can only access its authenticated site',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

describe('validateAppOwnershipFromBody middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: any;
  let statusSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      body: {},
      path: '/files/upload',
      method: 'POST',
      agentContext: {
        siteId: 'authenticated-site',
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

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication validation', () => {
    it('should return 401 when agentContext is missing', () => {
      delete mockReq.agentContext;
      const middleware = validateAppOwnershipFromBody('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Authentication required',
        requiresAuth: true,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Body field validation', () => {
    it('should return 400 when body field is missing', () => {
      mockReq.body = {};
      const middleware = validateAppOwnershipFromBody('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'App ID is required',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 when body field is not a string', () => {
      mockReq.body = { appId: 123 };
      const middleware = validateAppOwnershipFromBody('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Ownership validation', () => {
    it('should return 403 when body.appId does not match authenticated siteId', () => {
      mockReq.body = { appId: 'different-site' };
      mockReq.agentContext = {
        siteId: 'authenticated-site',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const middleware = validateAppOwnershipFromBody('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Access denied',
        message: 'Agent can only access its authenticated site',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() when body.appId matches authenticated siteId', () => {
      mockReq.body = { appId: 'authenticated-site' };
      mockReq.agentContext = {
        siteId: 'authenticated-site',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const middleware = validateAppOwnershipFromBody('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });

  describe('Custom field names', () => {
    it('should validate custom field name from body', () => {
      mockReq.body = { customField: 'authenticated-site' };
      mockReq.agentContext = {
        siteId: 'authenticated-site',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const middleware = validateAppOwnershipFromBody('customField');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });
});

describe('validateAppOwnershipFromQuery middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: any;
  let statusSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      query: {},
      path: '/api/conversations',
      method: 'GET',
      agentContext: {
        siteId: 'authenticated-site',
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

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication validation', () => {
    it('should return 401 when agentContext is missing', () => {
      delete mockReq.agentContext;
      const middleware = validateAppOwnershipFromQuery('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Authentication required',
        requiresAuth: true,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Query parameter validation', () => {
    it('should return 400 when query parameter is missing', () => {
      mockReq.query = {};
      const middleware = validateAppOwnershipFromQuery('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'App ID is required',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 when query parameter is not a string', () => {
      mockReq.query = { appId: ['array', 'value'] };
      const middleware = validateAppOwnershipFromQuery('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Ownership validation', () => {
    it('should return 403 when query.appId does not match authenticated siteId', () => {
      mockReq.query = { appId: 'different-site' };
      mockReq.agentContext = {
        siteId: 'authenticated-site',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const middleware = validateAppOwnershipFromQuery('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Access denied',
        message: 'Agent can only access its authenticated site',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() when query.appId matches authenticated siteId', () => {
      mockReq.query = { appId: 'authenticated-site' };
      mockReq.agentContext = {
        siteId: 'authenticated-site',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const middleware = validateAppOwnershipFromQuery('appId');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });

  describe('Custom field names', () => {
    it('should validate custom query parameter name', () => {
      mockReq.query = { customParam: 'authenticated-site' };
      mockReq.agentContext = {
        siteId: 'authenticated-site',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const middleware = validateAppOwnershipFromQuery('customParam');

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });
});

describe('validateConversationOwnership middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: any;
  let statusSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      params: {},
      path: '/api/conversations/conv-123/messages',
      method: 'GET',
      agentContext: {
        siteId: 'authenticated-site',
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

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication validation', () => {
    it('should return 401 when agentContext is missing', async () => {
      delete mockReq.agentContext;
      const middleware = validateConversationOwnership();

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Authentication required',
        requiresAuth: true,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Parameter validation', () => {
    it('should return 400 when conversationId parameter is missing', async () => {
      mockReq.params = {};
      const middleware = validateConversationOwnership();

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Conversation ID is required',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Conversation loading and validation', () => {
    it.skip('should return 404 when conversation does not exist', async () => {
      // TODO: Implement with proper DB mocking infrastructure
      // This test requires mocking the ConversationRepository which needs
      // a proper vitest mock setup for ESM modules
      expect(true).toBe(true);
    });

    it.skip('should return 403 when conversation belongs to different tenant', async () => {
      // TODO: Implement with proper DB mocking infrastructure
      // This test requires mocking the ConversationRepository which needs
      // a proper vitest mock setup for ESM modules
      expect(true).toBe(true);
    });

    it.skip('should call next() and attach conversation when ownership is valid', async () => {
      // TODO: Implement with proper DB mocking infrastructure
      // This test requires mocking the ConversationRepository which needs
      // a proper vitest mock setup for ESM modules
      expect(true).toBe(true);
    });
  });

  describe('Custom parameter names', () => {
    it.skip('should validate conversation from custom parameter name', async () => {
      // TODO: Implement with proper DB mocking infrastructure
      // This test requires mocking the ConversationRepository which needs
      // a proper vitest mock setup for ESM modules
      expect(true).toBe(true);
    });
  });
});
