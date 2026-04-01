import type { Request, Response, NextFunction } from 'express';
import { Logger } from '../../logging/index.js';

const logger = Logger.create({ component: 'error-handler' });

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

export class BadRequestError extends Error implements ApiError {
  status = 400;
  code = 'BAD_REQUEST';
  
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends Error implements ApiError {
  status = 404;
  code = 'NOT_FOUND';
  
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class InternalServerError extends Error implements ApiError {
  status = 500;
  code = 'INTERNAL_SERVER_ERROR';
  
  constructor(message: string) {
    super(message);
    this.name = 'InternalServerError';
  }
}

export function errorHandler(
  error: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('middleware.error-handler.error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    status: error.status || 500,
    code: error.code || 'INTERNAL_SERVER_ERROR',
  });

  const status = error.status || 500;
  const code = error.code || 'INTERNAL_SERVER_ERROR';
  
  res.status(status).json({
    error: {
      message: error.message,
      code,
      timestamp: new Date().toISOString(),
    },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.url} not found`,
      code: 'NOT_FOUND',
      timestamp: new Date().toISOString(),
    },
  });
}
