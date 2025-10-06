import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../logging/index.js';
import { httpRequestEvents } from '../../logging/events/index.js';
import { nanoid } from 'nanoid';
import type { AuthenticatedRequest } from './jwt-auth.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = nanoid(8);
  
  // Build request data
  const userAgent = req.get('User-Agent');
  const contentType = req.get('Content-Type');
  const accept = req.get('Accept');
  const authorization = req.get('Authorization');
  
  // Get auth details if available (set by JWT auth middleware)
  const authDetails = (req as AuthenticatedRequest).agentContext;
  
  const requestData = {
    method: req.method,
    url: req.url,
    ...(userAgent && { userAgent }),
    ...(req.ip && { ip: req.ip }),
    requestId,
    headers: {
      ...(contentType && { 'content-type': contentType }),
      ...(accept && { 'accept': accept }),
      ...(authorization && { 'authorization': '[REDACTED]' }),
    },
    ...(Object.keys(req.query).length > 0 && { query: req.query }),
    // Only log body for non-GET requests and if it's not too large
    ...(req.method !== 'GET' && req.body && JSON.stringify(req.body).length < 1000 && { body: req.body }),
    // Include auth details if available
    ...(authDetails && { auth: authDetails })
  };
  
  // Log response when finished (single log message)
  res.on('finish', () => {
    const duration = Date.now() - start;
    const contentLength = res.get('Content-Length');
    
    // Create consolidated request/response data for single log message
    const logData = {
      ...requestData,
      responseStats: {
        statusCode: res.statusCode,
        ...(contentLength && { contentLength: parseInt(contentLength, 10) }),
        duration
      }
    };
    
    // Log success or error based on status code
    if (res.statusCode >= 400) {
      httpRequestEvents.error(logger, new Error(`HTTP ${res.statusCode}`), logData);
    } else {
      httpRequestEvents.success(logger, logData);
    }
  });

  // Attach request ID to request for potential use in other middleware
  (req as any).requestId = requestId;

  next();
}
