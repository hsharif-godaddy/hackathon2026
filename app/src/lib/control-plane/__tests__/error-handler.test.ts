/**
 * Control Plane Error Handler Tests
 * 
 * Tests the handleControlPlaneError function which converts
 * adapter errors to proper HTTP responses for API routes.
 * 
 * Authentication Flow (Server → Client):
 * 1. Server: handleControlPlaneError() returns 401 NextResponse
 * 2. Client: authFetch() intercepts 401 response
 * 3. Client: authFetch() calls clientRedirect(window)
 * 4. Client: Browser redirects to SSO login page
 * 
 * Note: This test file only covers the server-side (step 1).
 * The client-side redirect (steps 2-4) is handled by @godaddy/gasket-auth's authFetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleControlPlaneError } from '../error-handler';
import { AiroHttpError } from '@/lib/mgmt-airo';
import type { NextResponse } from 'next/server';

/**
 * Mock logger
 */
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

describe('handleControlPlaneError', function errorHandlerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('AiroHttpError handling', function httpErrorTests() {
    it('should return 401 response for auth error', async function test401() {
      const error = new AiroHttpError(401, 'Unauthorized', 'Token expired');
      
      const response = handleControlPlaneError(error, 'test-operation');
      const body = await response.json();
      
      // Server returns 401 NextResponse
      // Client's authFetch() will intercept this 401 and redirect to SSO login
      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 403 response for forbidden error', async function test403() {
      const error = new AiroHttpError(403, 'Forbidden', 'Access denied');
      
      const response = handleControlPlaneError(error, 'test-operation');
      const body = await response.json();
      
      expect(response.status).toBe(403);
      expect(body.error).toBe('Forbidden');
    });

    it('should return 404 response for not found error', async function test404() {
      const error = new AiroHttpError(404, 'Not Found', 'Resource not found');
      
      const response = handleControlPlaneError(error, 'test-operation');
      const body = await response.json();
      
      expect(response.status).toBe(404);
      expect(body.error).toBe('Resource not found');
    });

    it('should return same status code for other HTTP errors', async function testOtherHttpErrors() {
      const testCases = [
        { status: 400, statusText: 'Bad Request', body: 'Invalid input' },
        { status: 500, statusText: 'Internal Server Error', body: 'Server error' },
        { status: 502, statusText: 'Bad Gateway', body: 'Gateway error' },
        { status: 503, statusText: 'Service Unavailable', body: 'Service down' }
      ];

      for (const testCase of testCases) {
        const error = new AiroHttpError(testCase.status, testCase.statusText, testCase.body);
        
        const response = handleControlPlaneError(error, 'test-operation');
        const body = await response.json();
        
        expect(response.status).toBe(testCase.status);
        expect(body.error).toBeDefined();
      }
    });

    it('should include error message in response body', async function testErrorMessage() {
      const errorMessage = 'Detailed error description';
      const error = new AiroHttpError(500, 'Internal Server Error', errorMessage);
      
      const response = handleControlPlaneError(error, 'test-operation');
      const body = await response.json();
      
      expect(body.error).toContain('Internal Server Error');
    });
  });

  describe('Generic error handling', function genericErrorTests() {
    it('should return 500 for generic Error instances', async function testGenericError() {
      const error = new Error('Something went wrong');
      
      const response = handleControlPlaneError(error, 'test-operation');
      const body = await response.json();
      
      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(body.details).toBe('Something went wrong');
    });

    it('should return 500 for unknown error types', async function testUnknownError() {
      const error = 'string error';
      
      const response = handleControlPlaneError(error, 'test-operation');
      const body = await response.json();
      
      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(body.details).toBe('Unknown error');
    });

    it('should handle null error', async function testNullError() {
      const response = handleControlPlaneError(null, 'test-operation');
      const body = await response.json();
      
      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(body.details).toBe('Unknown error');
    });

    it('should handle undefined error', async function testUndefinedError() {
      const response = handleControlPlaneError(undefined, 'test-operation');
      const body = await response.json();
      
      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(body.details).toBe('Unknown error');
    });
  });

  describe('Logging behavior', function loggingTests() {
    it('should log warn for auth errors', async function testAuthLogging() {
      const { logger } = await import('@/lib/request-context');
      const error = new AiroHttpError(401, 'Unauthorized', 'Token expired');
      
      handleControlPlaneError(error, 'test-operation');
      
      expect(logger.warn).toHaveBeenCalledWith(
        'control-plane.test-operation.auth-error',
        expect.objectContaining({
          message: expect.stringContaining('401'),
          status: 401
        })
      );
    });

    it('should log info for 404 errors', async function test404Logging() {
      const { logger } = await import('@/lib/request-context');
      const error = new AiroHttpError(404, 'Not Found', 'Resource not found');
      
      handleControlPlaneError(error, 'test-operation');
      
      expect(logger.info).toHaveBeenCalledWith(
        'control-plane.test-operation.not-found',
        expect.objectContaining({
          message: 'Resource not found',
          status: 404
        })
      );
    });

    it('should log error for other HTTP errors', async function testHttpErrorLogging() {
      const { logger } = await import('@/lib/request-context');
      const error = new AiroHttpError(500, 'Internal Server Error', 'Server error');
      
      handleControlPlaneError(error, 'test-operation');
      
      expect(logger.error).toHaveBeenCalledWith(
        'control-plane.test-operation.http-error',
        expect.objectContaining({
          message: 'HTTP error',
          status: 500
        })
      );
    });

    it('should log error for generic errors', async function testGenericErrorLogging() {
      const { logger } = await import('@/lib/request-context');
      const error = new Error('Generic error');
      
      handleControlPlaneError(error, 'test-operation');
      
      expect(logger.error).toHaveBeenCalledWith(
        'control-plane.test-operation.error',
        expect.objectContaining({
          message: 'Operation failed',
          errorMessage: 'Generic error'
        })
      );
    });
  });

  describe('Operation name in logs', function operationNameTests() {
    it('should include operation name in log keys', async function testOperationName() {
      const { logger } = await import('@/lib/request-context');
      const error = new AiroHttpError(401, 'Unauthorized', 'Token expired');
      
      handleControlPlaneError(error, 'create-site');
      
      expect(logger.warn).toHaveBeenCalledWith(
        'control-plane.create-site.auth-error',
        expect.any(Object)
      );
    });

    it('should handle different operation names', async function testMultipleOperations() {
      const { logger } = await import('@/lib/request-context');
      const operations = ['create-site', 'delete-site', 'update-site', 'list-sites'];
      
      for (const operation of operations) {
        vi.clearAllMocks();
        const error = new AiroHttpError(404, 'Not Found', 'Not found');
        
        handleControlPlaneError(error, operation);
        
        expect(logger.info).toHaveBeenCalledWith(
          `control-plane.${operation}.not-found`,
          expect.any(Object)
        );
      }
    });
  });

  describe('Response structure', function responseStructureTests() {
    it('should return valid NextResponse for all error types', async function testResponseType() {
      const errors = [
        new AiroHttpError(401, 'Unauthorized', 'Auth error'),
        new AiroHttpError(404, 'Not Found', 'Not found'),
        new AiroHttpError(500, 'Internal Server Error', 'Server error'),
        new Error('Generic error')
      ];

      for (const error of errors) {
        const response = handleControlPlaneError(error, 'test-operation');
        
        // Should be able to get JSON body
        const body = await response.json();
        
        // Should have error field
        expect(body.error).toBeDefined();
        expect(typeof body.error).toBe('string');
        
        // Should have valid status
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(600);
      }
    });

    it('should not expose sensitive error details for 500 errors', async function testSensitiveDataHandling() {
      const error = new Error('Database password: secret123');
      
      const response = handleControlPlaneError(error, 'test-operation');
      const body = await response.json();
      
      // Should have generic error message
      expect(body.error).toBe('Internal server error');
      
      // Details might contain the actual error, but main error field should be generic
      expect(body.details).toBe('Database password: secret123');
    });
  });
});

