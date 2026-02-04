import { Response, NextFunction } from 'express';
import { config } from '../config';
import logger from '../utils/logger';
import { AuthenticatedRequest } from '../types';

/**
 * Authentication middleware for validating tokens against exact match list
 */
function validateGdToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const requestId = String(req.id ?? 'unknown');

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
  const token = bearerMatch?.[1]?.trim();

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
export {
  validateGdToken
};
