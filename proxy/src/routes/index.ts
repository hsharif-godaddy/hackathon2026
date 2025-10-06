import express, { Request, Response, Router } from 'express';
import { validateGdToken } from '../auth/middleware';
import gettyClient from '../clients/getty-client';
import ssoValidationRoutes from './sso-validation';
import logger from '../utils/logger';
import {
  AuthenticatedRequest,
  HealthStatus,
  GettySearchParams
} from '../types';

const router: Router = express.Router();

// SSO public key proxy routes (no auth required - agents will validate)
router.use('/', ssoValidationRoutes);

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '2.0.0'
  };
  
  res.status(200).json(health);
});


// Getty Images search endpoint
router.get('/img/search',
  validateGdToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const requestId = String(req.id ?? 'unknown');
    const startTime = req.startTime ?? Date.now();
    
    try {
      // Validate required parameters
      if (!req.query.phrase && !req.query.q) {
        res.status(400).json({
          error: {
            message: 'Missing required parameter: phrase or q',
            type: 'invalid_request_error'
          }
        });
        return;
      }

      // Sanitize and validate query parameters
      const params: GettySearchParams = {
        phrase: req.query.phrase as string || req.query.q as string,
        page: Math.max(1, parseInt(req.query.page as string) || 1),
        pageSize: Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 25)),
        ...req.query
      };

      // Remove potentially dangerous parameters
      delete params.callback;
      delete params.jsonp;

      const response = await gettyClient.search(params, requestId);
      const totalDuration = Date.now() - startTime;

      // Single comprehensive log statement
      logger.info('[SECURE] Getty API search completed', {
        requestId,
        method: req.method,
        path: req.path,
        query: {
          phrase: params.phrase,
          page: params.page,
          pageSize: params.pageSize
        },
        userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
        statusCode: response.statusCode,
        gettyDuration: response.duration ? `${response.duration}ms` : 'unknown',
        totalDuration: `${totalDuration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      // Set response headers
      res.set('Content-Type', response.headers['content-type'] as string || 'application/json');
      res.set('Cache-Control', 'public, max-age=300'); // 5 minute cache
      res.status(response.statusCode);
      res.send(response.data);

    } catch (error) {
      const err = error as { message: string; statusCode?: number; duration?: number };
      const totalDuration = Date.now() - startTime;
      
      // Single comprehensive error log statement
      logger.error('[SECURE] Getty API search failed', {
        requestId,
        method: req.method,
        path: req.path,
        query: req.query,
        userToken: req.userToken ? req.userToken.substring(0, 10) + '...' : 'unknown',
        error: err.message,
        statusCode: err.statusCode,
        gettyDuration: err.duration ? `${err.duration}ms` : 'unknown',
        totalDuration: `${totalDuration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      const statusCode = err.statusCode ?? 503;
      let errorMessage: string;
      let errorType: string;

      if (statusCode === 400) {
        errorMessage = 'Bad Request';
        errorType = 'bad_request_error';
      } else if (statusCode >= 500) {
        errorMessage = 'Internal Server Error';
        errorType = 'internal_error';
      } else {
        errorMessage = 'Getty Images API request failed';
        errorType = 'upstream_error';
      }

      res.status(statusCode).json({
        error: {
          message: errorMessage,
          type: errorType,
          requestId
        }
      });
    }
  }
);


// Catch-all for unsupported routes
router.use('*', (req: Request, res: Response) => {
  logger.warn('Unsupported route accessed', { 
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  });
  
  res.status(404).json({
    error: {
      message: 'Not Found',
      type: 'not_found_error'
    }
  });
});

export default router;
