import express, { Request, Response, Router } from 'express';
import multer from 'multer';

import { validateGdToken } from '../auth/middleware';
import gettyClient from '../clients/getty-client';
import knowbClient from '../clients/knowb-client';
import webScraperClient from '../clients/web-scraper-client';
import { config } from '../config';
import ssoValidationRoutes from './sso-validation';
import logger from '../utils/logger';
import {
  AuthenticatedRequest,
  HealthStatus,
  GettySearchParams,
  KnowBSearchParams,
  KnowBUploadParams,
  WebScraperParams
} from '../types';

const upload = multer({ storage: multer.memoryStorage() });

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


// Backward compatibility route for legacy /img/search endpoint
// This redirects old agent code to the new /v1/search endpoint
router.get('/img/search',
  validateGdToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const requestId = String(req.id ?? 'unknown');
    const startTime = req.startTime ?? Date.now();

    logger.info('[INFO] Legacy /img/search route accessed, processing as /v1/search', {
      requestId,
      originalPath: req.path,
      query: req.query
    });

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

      res.set('Content-Type', response.headers['content-type'] as string || 'application/json');
      res.set('Cache-Control', 'public, max-age=300');
      res.status(response.statusCode);
      res.send(response.data);

    } catch (error) {
      const err = error as { message: string; statusCode?: number; duration?: number };
      const totalDuration = Date.now() - startTime;

      logger.error('[ERROR] Legacy Getty API search failed', {
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

// Getty Images search endpoint (new format)
router.get('/v1/search',
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
      logger.info('[INFO] Getty API search completed', {
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
      logger.error('[ERROR] Getty API search failed', {
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

// Getty Video search endpoint
router.get('/v1/videos/search',
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
        pageSize: Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 1)),
        ...req.query
      };

      // Remove potentially dangerous parameters
      delete params.callback;
      delete params.jsonp;

      const response = await gettyClient.videoSearch(params, requestId);
      const totalDuration = Date.now() - startTime;

      // Single comprehensive log statement
      logger.info('[INFO] Getty Video API search completed', {
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
      logger.error('[ERROR] Getty Video API search failed', {
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
      res.status(statusCode).json({
        error: {
          message: 'Getty Video API request failed',
          type: 'upstream_error',
          requestId
        }
      });
    }
  }
);

// Getty Video upload endpoint
router.post('/v1/videos/upload',
  validateGdToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const requestId = String(req.id ?? 'unknown');
    const startTime = req.startTime ?? Date.now();

    try {
      // Validate required parameters
      if (!req.body || !req.body.id) {
        res.status(400).json({
          error: {
            message: 'Missing required parameter: id',
            type: 'invalid_request_error'
          }
        });
        return;
      }

      const videoId = req.body.id as string;

      const response = await gettyClient.videoUpload(videoId, requestId);
      const totalDuration = Date.now() - startTime;

      // Single comprehensive log statement
      logger.info('[INFO] Getty Video upload completed', {
        requestId,
        method: req.method,
        path: req.path,
        videoId,
        userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
        statusCode: response.statusCode,
        gettyDuration: response.duration ? `${response.duration}ms` : 'unknown',
        totalDuration: `${totalDuration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      // Set response headers
      res.set('Content-Type', response.headers['content-type'] as string || 'application/json');
      res.status(response.statusCode);
      res.send(response.data);

    } catch (error) {
      const err = error as { message: string; statusCode?: number; duration?: number };
      const totalDuration = Date.now() - startTime;

      // Single comprehensive error log statement
      logger.error('[ERROR] Getty Video upload failed', {
        requestId,
        method: req.method,
        path: req.path,
        body: req.body,
        userToken: req.userToken ? req.userToken.substring(0, 10) + '...' : 'unknown',
        error: err.message,
        statusCode: err.statusCode,
        gettyDuration: err.duration ? `${err.duration}ms` : 'unknown',
        totalDuration: `${totalDuration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      const statusCode = err.statusCode ?? 503;
      res.status(statusCode).json({
        error: {
          message: 'Getty Video upload failed',
          type: 'upstream_error',
          requestId
        }
      });
    }
  }
);

// Web Scraper scrape endpoint
router.get('/v1/scrape-website',
  validateGdToken,
  async (req: AuthenticatedRequest, res: Response) => {
    res.status(403).json({
      error: {
        message: 'Tool service coming soon',
        type: 'forbidden'
      }
    });
    return;

    // const requestId = String(req.id ?? 'unknown');
    // const startTime = req.startTime ?? Date.now();

    // try {
    //   // Validate required parameters
    //   if (!req.query.url) {
    //     res.status(400).json({
    //       error: {
    //         message: 'Missing required parameter: url',
    //         type: 'invalid_request_error'
    //       }
    //     });
    //     return;
    //   }

    //   const params: WebScraperParams = {
    //     url: req.query.url as string
    //   };

    //   const response = await webScraperClient.scrape(params, requestId);
    //   const totalDuration = Date.now() - startTime;

    //   logger.info('[INFO] Web Scraper scrape completed', {
    //     requestId,
    //     method: req.method,
    //     path: req.path,
    //     query: { url: params.url },
    //     userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
    //     statusCode: response.statusCode,
    //     scrapeDuration: response.duration ? `${response.duration}ms` : 'unknown',
    //     totalDuration: `${totalDuration}ms`,
    //     userAgent: req.get('User-Agent'),
    //     ip: req.ip
    //   });

    //   res.set('Content-Type', response.headers['content-type'] as string || 'application/json');
    //   res.set('Cache-Control', 'no-cache'); // Don't cache scraping results
    //   res.status(response.statusCode);
    //   res.send(response.data);

    // } catch (error) {
    //   const err = error as { message: string; statusCode?: number; duration?: number };
    //   const totalDuration = Date.now() - startTime;

    //   logger.error('[ERROR] Web Scraper scrape failed', {
    //     requestId,
    //     method: req.method,
    //     path: req.path,
    //     query: req.query,
    //     userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
    //     error: err.message,
    //     statusCode: err.statusCode,
    //     scrapeDuration: err.duration ? `${err.duration}ms` : 'unknown',
    //     totalDuration: `${totalDuration}ms`,
    //     userAgent: req.get('User-Agent'),
    //     ip: req.ip
    //   });

    //   const statusCode = err.statusCode ?? 503;
    //   res.status(statusCode).json({
    //     error: {
    //       message: 'Web Scraper API request failed',
    //       type: 'upstream_error',
    //       requestId
    //     }
    //   });
    // }
  }
);

// Web Scraper screenshot endpoint
router.get('/v1/screenshot-website',
  validateGdToken,
  async (req: AuthenticatedRequest, res: Response) => {

    res.status(403).json({
      error: {
        message: 'Tool service coming soon',
        type: 'forbidden'
      }
    });
    return;

    // const requestId = String(req.id ?? 'unknown');
    // const startTime = req.startTime ?? Date.now();

    // try {
    //   // Validate required parameters
    //   if (!req.query.url) {
    //     res.status(400).json({
    //       error: {
    //         message: 'Missing required parameter: url',
    //         type: 'invalid_request_error'
    //       }
    //     });
    //     return;
    //   }

    //   const params: WebScraperParams = {
    //     url: req.query.url as string
    //   };

    //   const response = await webScraperClient.screenshot(params, requestId);
    //   const totalDuration = Date.now() - startTime;

    //   logger.info('[INFO] Web Scraper screenshot completed', {
    //     requestId,
    //     method: req.method,
    //     path: req.path,
    //     query: { url: params.url },
    //     userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
    //     statusCode: response.statusCode,
    //     screenshotDuration: response.duration ? `${response.duration}ms` : 'unknown',
    //     totalDuration: `${totalDuration}ms`,
    //     userAgent: req.get('User-Agent'),
    //     ip: req.ip
    //   });

    //   res.set('Content-Type', response.headers['content-type'] as string || 'application/json');
    //   res.set('Cache-Control', 'no-cache'); // Don't cache screenshots
    //   res.status(response.statusCode);
    //   res.send(response.data);

    // } catch (error) {
    //   const err = error as { message: string; statusCode?: number; duration?: number };
    //   const totalDuration = Date.now() - startTime;

    //   logger.error('[ERROR] Web Scraper screenshot failed', {
    //     requestId,
    //     method: req.method,
    //     path: req.path,
    //     query: req.query,
    //     userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
    //     error: err.message,
    //     statusCode: err.statusCode,
    //     screenshotDuration: err.duration ? `${err.duration}ms` : 'unknown',
    //     totalDuration: `${totalDuration}ms`,
    //     userAgent: req.get('User-Agent'),
    //     ip: req.ip
    //   });

    //   const statusCode = err.statusCode ?? 503;
    //   res.status(statusCode).json({
    //     error: {
    //       message: 'Web Scraper API request failed',
    //       type: 'upstream_error',
    //       requestId
    //     }
    //   });
    // }
  }
);


// KnowB knowledge base search endpoint
router.post('/v1/knowb/search',
  validateGdToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const requestId = String(req.id ?? 'unknown');
    const startTime = req.startTime ?? Date.now();

    try {
      // Validate required query parameter
      const { query, kbNodeIds, maxResults, scoreThreshold } = req.body as KnowBSearchParams;

      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        res.status(400).json({
          error: {
            message: 'Missing required parameter: query',
            type: 'invalid_request_error'
          }
        });
        return;
      }

      // Build search params - always use defaults
      const params: KnowBSearchParams = {
        query: query.trim(),
        kbNodeIds: config.knowb.defaultKbNodeIds,
        maxResults: config.knowb.defaultMaxResults,
        scoreThreshold: config.knowb.defaultScoreThreshold
      };

      const response = await knowbClient.search(params, requestId);
      const totalDuration = Date.now() - startTime;

      logger.info('[INFO] KnowB search completed', {
        requestId,
        method: req.method,
        path: req.path,
        query: {
          query: params.query.substring(0, 100),
          kbNodeIds: params.kbNodeIds,
          maxResults: params.maxResults,
          scoreThreshold: params.scoreThreshold
        },
        userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
        statusCode: response.statusCode,
        searchDuration: response.duration ? `${response.duration}ms` : 'unknown',
        totalDuration: `${totalDuration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      // Force JSON content type and re-serialize to prevent XSS from upstream data
      res.set('Content-Type', 'application/json');
      res.set('Cache-Control', 'no-cache');
      res.status(response.statusCode);
      try {
        // Parse and re-serialize to validate JSON and sanitize any malicious content
        const jsonData = typeof response.data === 'string'
          ? JSON.parse(response.data)
          : response.data;
        res.json(jsonData);
      } catch {
        // If response is not valid JSON, log error and return safe error response
        logger.warn('[WARN] KnowB returned invalid JSON response', {
          requestId,
          statusCode: response.statusCode,
          contentType: response.headers['content-type']
        });
        res.status(502).json({
          error: {
            message: 'Invalid response from upstream API',
            type: 'upstream_error',
            requestId
          }
        });
      }

    } catch (error) {
      const err = error as { message: string; statusCode?: number; duration?: number };
      const totalDuration = Date.now() - startTime;

      logger.error('[ERROR] KnowB search failed', {
        requestId,
        method: req.method,
        path: req.path,
        body: req.body,
        userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
        error: err.message,
        statusCode: err.statusCode,
        searchDuration: err.duration ? `${err.duration}ms` : 'unknown',
        totalDuration: `${totalDuration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      const statusCode = err.statusCode ?? 503;
      res.status(statusCode).json({
        error: {
          message: 'KnowB API request failed',
          type: 'upstream_error',
          requestId
        }
      });
    }
  }
);

// KnowB knowledge base upload endpoint
router.post('/v1/knowb/upload',
  validateGdToken,
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response) => {
    const requestId = String(req.id ?? 'unknown');
    const startTime = req.startTime ?? Date.now();

    try {
      if (!req.file) {
        res.status(400).json({
          error: {
            message: 'Missing required file upload',
            type: 'invalid_request_error'
          }
        });
        return;
      }

      const { kbNodeId, resourceType, acl, metadata } = req.body;

      if (!kbNodeId || typeof kbNodeId !== 'string') {
        res.status(400).json({
          error: {
            message: 'Missing required parameter: kbNodeId',
            type: 'invalid_request_error'
          }
        });
        return;
      }

      if (!resourceType || typeof resourceType !== 'string') {
        res.status(400).json({
          error: {
            message: 'Missing required parameter: resourceType',
            type: 'invalid_request_error'
          }
        });
        return;
      }

      const params: KnowBUploadParams = {
        kbNodeId,
        resourceType,
        file: req.file.buffer,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      };

      if (acl !== undefined) {
        params.acl = acl;
      }

      if (metadata) {
        try {
          params.metadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
        } catch {
          res.status(400).json({
            error: {
              message: 'Invalid metadata format (must be valid JSON)',
              type: 'invalid_request_error'
            }
          });
          return;
        }
      }

      const response = await knowbClient.upload(params, requestId);
      const totalDuration = Date.now() - startTime;

      logger.info('[INFO] KnowB upload completed', {
        requestId,
        method: req.method,
        path: req.path,
        filename: params.filename,
        kbNodeId: params.kbNodeId,
        resourceType: params.resourceType,
        fileSize: params.file.length,
        userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
        statusCode: response.statusCode,
        uploadDuration: response.duration ? `${response.duration}ms` : 'unknown',
        totalDuration: `${totalDuration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      res.set('Content-Type', 'application/json');
      res.status(response.statusCode);
      try {
        const jsonData = typeof response.data === 'string'
          ? JSON.parse(response.data)
          : response.data;
        res.json(jsonData);
      } catch {
        logger.warn('[WARN] KnowB returned invalid JSON response', {
          requestId,
          statusCode: response.statusCode,
          contentType: response.headers['content-type']
        });
        res.status(502).json({
          error: {
            message: 'Invalid response from upstream API',
            type: 'upstream_error',
            requestId
          }
        });
      }

    } catch (error) {
      const err = error as { message: string; statusCode?: number; duration?: number; response?: string };
      const totalDuration = Date.now() - startTime;

      logger.error('[ERROR] KnowB upload failed', {
        requestId,
        method: req.method,
        path: req.path,
        body: req.body,
        userToken: req.userToken ? req.userToken.substring(0, 5) + '...' : 'unknown',
        error: err.message,
        statusCode: err.statusCode,
        uploadDuration: err.duration ? `${err.duration}ms` : 'unknown',
        totalDuration: `${totalDuration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      const statusCode = err.statusCode ?? 503;
      res.status(statusCode).json({
        error: {
          message: err.message || 'KnowB upload failed',
          type: 'upstream_error',
          requestId,
          details: err.response
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
