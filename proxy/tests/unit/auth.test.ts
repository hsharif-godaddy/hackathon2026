import { validateGdToken } from '../../src/auth/middleware.js';
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../src/types/index.js';

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
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    next = vi.fn();
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

});
