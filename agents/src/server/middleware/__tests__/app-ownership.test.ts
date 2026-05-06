import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  validateAppOwnership,
  validateAppOwnershipFromParam,
  validateAppOwnershipFromBody,
  validateAppOwnershipFromQuery,
  validateConversationOwnership
} from '../app-ownership.js';
import { AuthenticatedRequest } from '../jwt-auth.js';
import { BYPASS_SITE_IDS } from '../../../services/index.js';

// Canonical appId fixtures — must match APP_ID_RE (10-char lowercase nanoid).
const SITE_A = 'abcdefghij';
const SITE_B = 'klmnopqrst';
const SITE_C = 'aaaaaaaaaa';
const SITE_D = 'bbbbbbbbbb';
const SITE_E = 'cccccccccc';

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
      path: '/apps/test-app/zip/upload',
      method: 'POST',
      agentContext: {
        siteId: SITE_A,
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
      mockReq.params = { id: SITE_B };
      mockReq.agentContext = {
        siteId: SITE_A,
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
      mockReq.params = { id: SITE_A };
      mockReq.agentContext = {
        siteId: SITE_A,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should allow access when agent accesses its own site', () => {
      const siteId = SITE_A;
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
      const regularSites = [SITE_C, SITE_D, SITE_E];

      regularSites.forEach((siteId) => {
        vi.clearAllMocks();

        mockReq.params = { id: SITE_B };
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
        path: '/apps/test-app/zip/upload',
        method: 'POST',
        agentContext: {
          siteId: SITE_A,
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
      const siteId = SITE_A;
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
      mockReq.params = { id: SITE_B };
      mockReq.agentContext = {
        siteId: SITE_A,
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
        siteId: SITE_A,
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
      mockReq.body = { appId: SITE_B };
      mockReq.agentContext = {
        siteId: SITE_A,
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
      mockReq.body = { appId: SITE_A };
      mockReq.agentContext = {
        siteId: SITE_A,
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
      mockReq.body = { customField: SITE_A };
      mockReq.agentContext = {
        siteId: SITE_A,
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
        siteId: SITE_A,
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
      mockReq.query = { appId: SITE_B };
      mockReq.agentContext = {
        siteId: SITE_A,
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
      mockReq.query = { appId: SITE_A };
      mockReq.agentContext = {
        siteId: SITE_A,
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
      mockReq.query = { customParam: SITE_A };
      mockReq.agentContext = {
        siteId: SITE_A,
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
        siteId: SITE_A,
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

describe('App ID shape validation', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: any;
  let statusSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy, json: jsonSpy };
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function authCtx(siteId: string) {
    return {
      siteId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
  }

  describe('validateAppOwnership (params.id)', () => {
    it('returns 400 with "Invalid app ID format" when non-bypass siteId and params.id is a static segment like "create"', () => {
      mockReq = {
        params: { id: 'create' },
        path: '/apps/create/diagnose',
        method: 'POST',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid app ID format',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 400 when params.id is an uppercase nanoid (shape is lowercase-only)', () => {
      mockReq = {
        params: { id: SITE_A.toUpperCase() },
        path: '/apps/SOMETHING/diagnose',
        method: 'POST',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('accepts a valid 10-char nanoid when siteId matches', () => {
      mockReq = {
        params: { id: SITE_A },
        path: `/apps/${SITE_A}/diagnose`,
        method: 'POST',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('still 403s on a valid-shape id that does not match siteId (cross-tenant signal preserved)', () => {
      mockReq = {
        params: { id: SITE_B },
        path: `/apps/${SITE_B}/diagnose`,
        method: 'POST',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    BYPASS_SITE_IDS.forEach((bypassSite) => {
      it(`exempts shape check for bypass siteId "${bypassSite}" — passes through with a non-canonical id`, () => {
        mockReq = {
          params: { id: 'create' },
          path: '/apps/create/diagnose',
          method: 'POST',
          agentContext: authCtx(bypassSite),
        };

        validateAppOwnership(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(statusSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('validateAppOwnershipFromBody (body.appId)', () => {
    it('returns 400 when non-bypass siteId and body.appId is malformed', () => {
      mockReq = {
        body: { appId: 'create' },
        path: '/files/upload',
        method: 'POST',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnershipFromBody('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid app ID format',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('exempts bypass siteIds from shape check on body.appId', () => {
      mockReq = {
        body: { appId: 'arbitrary-dev-id' },
        path: '/files/upload',
        method: 'POST',
        agentContext: authCtx('local-dev-site'),
      };

      validateAppOwnershipFromBody('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateAppOwnershipFromQuery (query.appId)', () => {
    it('returns 400 when non-bypass siteId and query.appId is malformed', () => {
      mockReq = {
        query: { appId: 'servers' },
        path: '/api/conversations',
        method: 'GET',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnershipFromQuery('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('exempts bypass siteIds from shape check on query.appId', () => {
      mockReq = {
        query: { appId: 'arbitrary-dev-id' },
        path: '/api/conversations',
        method: 'GET',
        agentContext: authCtx('bypass-site'),
      };

      validateAppOwnershipFromQuery('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });
});

describe('validateAppOwnershipFromParam middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: any;
  let statusSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy, json: jsonSpy };
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function authCtx(siteId: string) {
    return {
      siteId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
  }

  describe('Authentication validation', () => {
    it('returns 401 when agentContext is missing', () => {
      mockReq = {
        params: { appId: SITE_A },
        path: '/events/abc',
        method: 'GET',
      };

      validateAppOwnershipFromParam('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Authentication required',
        requiresAuth: true,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 when siteId is missing from agentContext', () => {
      mockReq = {
        params: { appId: SITE_A },
        path: '/events/abc',
        method: 'GET',
        agentContext: {
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        } as any,
      };

      validateAppOwnershipFromParam('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Param lookup uses the configured paramName', () => {
    it('reads req.params[paramName] (not req.params.id) when paramName is custom', () => {
      // Regression guard: if the lookup is ever wrongly coded as `req.params.id`,
      // this test fails because it would read SITE_A (matching) and pass,
      // instead of reading SITE_B (mismatching) and 403ing.
      mockReq = {
        params: { id: SITE_A, appId: SITE_B },
        path: '/events/abc',
        method: 'GET',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnershipFromParam('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('falls back to req.params.id when called with no argument (default paramName)', () => {
      mockReq = {
        params: { id: SITE_A },
        path: '/apps/abc',
        method: 'GET',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnershipFromParam()(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('returns 400 when the configured paramName is absent from req.params', () => {
      mockReq = {
        params: { id: SITE_A }, // note: 'appId' not present
        path: '/events/abc',
        method: 'GET',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnershipFromParam('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'App ID is required',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Shape validation', () => {
    it('returns 400 with "Invalid app ID format" when non-bypass siteId and paramName value is malformed', () => {
      mockReq = {
        params: { appId: 'create' },
        path: '/apps/create/events',
        method: 'POST',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnershipFromParam('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid app ID format',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('accepts a valid 10-char nanoid when siteId matches', () => {
      mockReq = {
        params: { appId: SITE_A },
        path: `/events/${SITE_A}`,
        method: 'GET',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnershipFromParam('appId')(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    BYPASS_SITE_IDS.forEach((bypassSite) => {
      it(`exempts shape check for bypass siteId "${bypassSite}"`, () => {
        mockReq = {
          params: { appId: 'create' },
          path: '/apps/create/events',
          method: 'POST',
          agentContext: authCtx(bypassSite),
        };

        validateAppOwnershipFromParam('appId')(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(statusSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('Ownership validation', () => {
    it('returns 403 when valid-shape paramName value does not match siteId', () => {
      mockReq = {
        params: { appId: SITE_B },
        path: `/events/${SITE_B}`,
        method: 'GET',
        agentContext: authCtx(SITE_A),
      };

      validateAppOwnershipFromParam('appId')(mockReq as Request, mockRes as Response, mockNext);

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
