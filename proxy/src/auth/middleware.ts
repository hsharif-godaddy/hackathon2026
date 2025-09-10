import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import logger from '../utils/logger';
import { AuthenticatedRequest, RateLimitOptions } from '../types';

/**
 * Authentication middleware for validating tokens against exact match list
 */
function validateGdToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const requestId = req.id ?? 'unknown';

  if (!authHeader) {
    logger.warn('Missing authorization header', { requestId, path: req.path });
    res.status(401).json({
      error: {
        message: 'Invalid or missing authorization token',
        type: 'invalid_request_error'
      }
    });
    return;
  }

  // Extract token from Bearer header
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/);
  const token = bearerMatch?.[1];

  if (!token) {
    logger.warn('Invalid authorization header format', { 
      requestId, 
      path: req.path, 
      authHeaderPrefix: authHeader.substring(0, 20) 
    });
    res.status(401).json({
      error: {
        message: 'Invalid authorization header format. Expected: Bearer <token>',
        type: 'invalid_request_error'
      }
    });
    return;
  }

  // Check if token is in the valid tokens list
  if (config.auth.validTokens.length === 0) {
    logger.error('No valid tokens configured', { 
      requestId, 
      path: req.path,
      message: 'VALID_TOKENS environment variable not set or empty'
    });
    res.status(500).json({
      error: {
        message: 'Authentication service not properly configured',
        type: 'configuration_error'
      }
    });
    return;
  }

  if (!config.auth.validTokens.includes(token)) {
    logger.warn('Token not in valid tokens list', { 
      requestId, 
      path: req.path, 
      tokenPrefix: token.substring(0, 10) + '...',
      validTokensCount: config.auth.validTokens.length
    });
    res.status(401).json({
      error: {
        message: 'Invalid authorization token',
        type: 'invalid_request_error'
      }
    });
    return;
  }

  // Add token to request context
  req.userToken = token;
  
  logger.debug('Token validation successful', { 
    requestId, 
    path: req.path,
    tokenPrefix: req.userToken.substring(0, 10) + '...',
    validTokensCount: config.auth.validTokens.length
  });
  
  next();
}

/**
 * Rate limiting middleware (simple in-memory implementation)
 */
const rateLimitStore = new Map<string, number[]>();

function rateLimit(options: RateLimitOptions = {}) {
  const {
    windowMs = 60000, // 1 minute
    max = 100, // requests per window
    keyGenerator = (req: Request) => req.ip ?? 'unknown'
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    if (Math.random() < 0.1) { // Clean 10% of the time
      for (const [k, requests] of rateLimitStore.entries()) {
        const filtered = requests.filter(time => time > windowStart);
        if (filtered.length === 0) {
          rateLimitStore.delete(k);
        } else {
          rateLimitStore.set(k, filtered);
        }
      }
    }

    // Get current requests for this key
    const requests = rateLimitStore.get(key) ?? [];
    const recentRequests = requests.filter(time => time > windowStart);

    if (recentRequests.length >= max) {
      logger.warn('Rate limit exceeded', { key, requests: recentRequests.length, max });
      res.status(429).json({
        error: {
          message: 'Too many requests',
          type: 'rate_limit_error'
        }
      });
      return;
    }

    // Add current request
    recentRequests.push(now);
    rateLimitStore.set(key, recentRequests);

    next();
  };
}

export {
  validateGdToken,
  rateLimit
};
