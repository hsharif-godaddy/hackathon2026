import { validateGdToken, rateLimit } from '../../src/auth/middleware';
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../src/types';

describe('Authentication Middleware', () => {
  let req: Partial<AuthenticatedRequest>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      headers: {},
      path: '/test',
      ip: '127.0.0.1'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  describe('validateGdToken', () => {
    it('should reject requests without authorization header', () => {
      validateGdToken(req as AuthenticatedRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          message: 'Invalid or missing authorization token',
          type: 'invalid_request_error'
        }
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject tokens not matching gd-* pattern', () => {
      req.headers!.authorization = 'Bearer invalid-token';
      
      validateGdToken(req as AuthenticatedRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept valid gd-* tokens', () => {
      req.headers!.authorization = 'Bearer gd-valid-token-123';
      
      validateGdToken(req as AuthenticatedRequest, res as Response, next);

      expect((req as AuthenticatedRequest).userToken).toBe('gd-valid-token-123');
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should handle different Bearer token formats', () => {
      req.headers!.authorization = 'Bearer  gd-token-with-spaces  ';
      
      validateGdToken(req as AuthenticatedRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('rateLimit', () => {
    it('should allow requests under the limit', () => {
      const middleware = rateLimit({ max: 5, windowMs: 60000 });
      
      for (let i = 0; i < 5; i++) {
        middleware(req as Request, res as Response, next);
      }

      expect(next).toHaveBeenCalledTimes(5);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should block requests over the limit', () => {
      const middleware = rateLimit({ max: 2, windowMs: 60000 });
      
      // First two requests should pass
      middleware(req as Request, res as Response, next);
      middleware(req as Request, res as Response, next);
      
      // Third request should be blocked
      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should use custom key generator', () => {
      const middleware = rateLimit({ 
        max: 1, 
        windowMs: 60000,
        keyGenerator: (req: Request) => req.headers['x-user-id'] as string || req.ip || 'unknown'
      });

      req.headers!['x-user-id'] = 'user1';
      middleware(req as Request, res as Response, next);

      req.headers!['x-user-id'] = 'user2';
      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(2); // Different users, both should pass
    });
  });
});
