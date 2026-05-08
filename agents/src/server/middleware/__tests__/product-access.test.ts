import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  validateProductAccess,
  isRouteAllowedForPaaS,
  patternToRegex,
} from '../product-access.js';
import type { AuthenticatedRequest } from '../jwt-auth.js';

describe('product-access middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: ReturnType<typeof vi.fn>;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      params: {},
      path: '/apps/test-app/zip/upload',
      originalUrl: '/apps/test-app/zip/upload',
      method: 'POST',
      agentContext: {
        siteId: 'test-site',
        canDownload: true,
        canPublish: true,
        isE2S: false,
        product: 'AiroAppBuilder',
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

  describe('AAB callers', () => {
    it('should allow AAB callers through any route', () => {
      mockReq.originalUrl = '/debug/something';
      mockReq.agentContext!.product = 'AiroAppBuilder';

      validateProductAccess(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should treat missing product as AAB (backward compat)', () => {
      const ctx = mockReq.agentContext as any;
      delete ctx.product;

      mockReq.originalUrl = '/debug/something';

      validateProductAccess(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });

  describe('Missing agentContext', () => {
    it('should return 401 when agentContext is missing', () => {
      delete mockReq.agentContext;

      validateProductAccess(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Authentication required',
        requiresAuth: true,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('PaaS allowed routes', () => {
    const allowedRoutes = [
      // Zip import
      { method: 'POST', path: '/apps/abc123/zip/upload' },
      { method: 'GET', path: '/apps/abc123/zip/upload/status' },
      // Git remote
      { method: 'POST', path: '/apps/abc123/git/remote/configure' },
      { method: 'POST', path: '/apps/abc123/git/push' },
      { method: 'POST', path: '/apps/abc123/git/pull' },
      { method: 'GET', path: '/apps/abc123/git/remote/status' },
      { method: 'GET', path: '/apps/abc123/git/sync/status/job-456' },
      // Git history
      { method: 'GET', path: '/apps/abc123/git/history' },
      // Publish
      { method: 'POST', path: '/apps/abc123/publish' },
      { method: 'POST', path: '/apps/abc123/publish/restart' },
      // App lifecycle
      { method: 'POST', path: '/apps/abc123/restart' },
      // Customer logs
      { method: 'GET', path: '/apps/abc123/customer-logs' },
      // Files API
      { method: 'GET', path: '/apps/abc123/files' },
      { method: 'GET', path: '/apps/abc123/files/read' },
      { method: 'POST', path: '/apps/abc123/files/write' },
      // Screenshots
      { method: 'GET', path: '/apps/abc123/screenshot' },
      { method: 'POST', path: '/apps/abc123/capture-screenshot' },
    ];

    it.each(allowedRoutes)(
      'should allow PaaS caller for $method $path',
      ({ method, path }) => {
        mockReq.agentContext!.product = 'PaaSNodeJS';
        mockReq.method = method;
        mockReq.originalUrl = path;

        validateProductAccess(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(statusSpy).not.toHaveBeenCalled();
      }
    );
  });

  describe('PaaS denied routes', () => {
    const deniedRoutes = [
      { method: 'GET', path: '/agents' },
      { method: 'GET', path: '/apps/abc123/social/meta' },
      { method: 'GET', path: '/debug/memory' },
      { method: 'GET', path: '/apps/abc123/download' },
      { method: 'GET', path: '/agent/conversations' },
      { method: 'POST', path: '/agent/develop/chat' },
      { method: 'POST', path: '/media/upload' },
      { method: 'POST', path: '/apps/abc123/files/edit' },
      { method: 'POST', path: '/apps/abc123/files/search' },
    ];

    it.each(deniedRoutes)(
      'should deny PaaS caller for $method $path',
      ({ method, path }) => {
        mockReq.agentContext!.product = 'PaaSNodeJS';
        mockReq.method = method;
        mockReq.originalUrl = path;

        validateProductAccess(mockReq as Request, mockRes as Response, mockNext);

        expect(statusSpy).toHaveBeenCalledWith(403);
        expect(jsonSpy).toHaveBeenCalledWith({
          error: 'Route not available for PaaS consumers',
        });
        expect(mockNext).not.toHaveBeenCalled();
      }
    );
  });

  describe('Method restrictions', () => {
    it('should deny GET on POST-only zip upload route for PaaS', () => {
      mockReq.agentContext!.product = 'PaaSNodeJS';
      mockReq.method = 'GET';
      mockReq.originalUrl = '/apps/abc123/zip/upload';

      validateProductAccess(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should deny POST on GET-only git remote status for PaaS', () => {
      mockReq.agentContext!.product = 'PaaSNodeJS';
      mockReq.method = 'POST';
      mockReq.originalUrl = '/apps/abc123/git/remote/status';

      validateProductAccess(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Query strings', () => {
    it('should strip query string before matching', () => {
      mockReq.agentContext!.product = 'PaaSNodeJS';
      mockReq.method = 'POST';
      mockReq.originalUrl = '/apps/abc123/zip/upload?force=true';

      validateProductAccess(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should deny even with query string on denied route', () => {
      mockReq.agentContext!.product = 'PaaSNodeJS';
      mockReq.method = 'GET';
      mockReq.originalUrl = '/debug/memory?detail=true';

      validateProductAccess(mockReq as Request, mockRes as Response, mockNext);

      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

describe('patternToRegex', () => {
  it('should match exact paths', () => {
    const regex = patternToRegex('/apps/:id/git/push');
    expect(regex.test('/apps/abc123/git/push')).toBe(true);
    expect(regex.test('/apps/abc123/git/push/')).toBe(false);
    expect(regex.test('/apps/abc123/git/push/extra')).toBe(false);
  });

  it('should convert :param to single segment wildcard', () => {
    const regex = patternToRegex('/apps/:id/zip/upload');
    expect(regex.test('/apps/abc123/zip/upload')).toBe(true);
    expect(regex.test('/apps/my-app/zip/upload')).toBe(true);
    expect(regex.test('/apps//zip/upload')).toBe(false);
  });

  it('should handle multiple :param segments', () => {
    const regex = patternToRegex('/apps/:id/git/sync/status/:jobId');
    expect(regex.test('/apps/abc123/git/sync/status/job-456')).toBe(true);
    expect(regex.test('/apps/abc123/git/sync/status/')).toBe(false);
  });
});

describe('isRouteAllowedForPaaS', () => {
  it('should allow zip import routes', () => {
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/zip/upload')).toBe(true);
    expect(isRouteAllowedForPaaS('GET', '/apps/test-app/zip/upload/status')).toBe(true);
  });

  it('should allow git remote routes', () => {
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/git/remote/configure')).toBe(true);
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/git/push')).toBe(true);
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/git/pull')).toBe(true);
    expect(isRouteAllowedForPaaS('GET', '/apps/test-app/git/remote/status')).toBe(true);
    expect(isRouteAllowedForPaaS('GET', '/apps/test-app/git/sync/status/j-123')).toBe(true);
  });

  it('should allow git history route', () => {
    expect(isRouteAllowedForPaaS('GET', '/apps/test-app/git/history')).toBe(true);
  });

  it('should allow publish route', () => {
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/publish')).toBe(true);
  });

  it('should allow publish restart route', () => {
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/publish/restart')).toBe(true);
  });

  it('should allow restart route', () => {
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/restart')).toBe(true);
  });

  it('should allow diagnose route', () => {
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/diagnose')).toBe(true);
  });

  it('should allow customer-logs route', () => {
    expect(isRouteAllowedForPaaS('GET', '/apps/test-app/customer-logs')).toBe(true);
  });

  it('should allow files API routes', () => {
    expect(isRouteAllowedForPaaS('GET', '/apps/test-app/files')).toBe(true);
    expect(isRouteAllowedForPaaS('GET', '/apps/test-app/files/read')).toBe(true);
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/files/write')).toBe(true);
  });

  it('should deny with wrong method', () => {
    expect(isRouteAllowedForPaaS('GET', '/apps/test-app/zip/upload')).toBe(false);
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/git/remote/status')).toBe(false);
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/files')).toBe(false);
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/files/read')).toBe(false);
    expect(isRouteAllowedForPaaS('GET', '/apps/test-app/files/write')).toBe(false);
  });

  it('should deny non-allowlisted routes', () => {
    expect(isRouteAllowedForPaaS('GET', '/agents')).toBe(false);
    expect(isRouteAllowedForPaaS('GET', '/debug/memory')).toBe(false);
    expect(isRouteAllowedForPaaS('POST', '/agent/develop/chat')).toBe(false);
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/files/edit')).toBe(false);
    expect(isRouteAllowedForPaaS('POST', '/apps/test-app/files/search')).toBe(false);
  });
});
