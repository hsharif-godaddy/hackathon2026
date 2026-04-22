/**
 * Product-level access control middleware.
 *
 * PaaS callers (identified by `product: 'PaaSNodeJS'` in the JWT) are restricted to
 * an allowlist of routes. AAB callers (the default) remain unrestricted.
 */

import { Request, Response, NextFunction } from 'express';

import { logger } from '../../logging/index.js';
import type { AuthenticatedRequest } from './jwt-auth.js';

interface RoutePattern {
  method: string;  // HTTP method
  path: string;    // Express-style path pattern (`:param` segments)
}

/**
 * Exact routes that PaaS callers are allowed to access.
 * Everything else is implicitly denied for PaaS.
 */
const PAAS_ALLOWED_ROUTES: RoutePattern[] = [
  // Zip import
  { method: 'POST', path: '/apps/:id/zip/upload' },
  { method: 'GET', path: '/apps/:id/zip/upload/status' },

  // Git remote operations
  { method: 'POST', path: '/apps/:id/git/remote/configure' },
  { method: 'POST', path: '/apps/:id/git/push' },
  { method: 'POST', path: '/apps/:id/git/pull' },
  { method: 'GET', path: '/apps/:id/git/remote/status' },
  { method: 'GET', path: '/apps/:id/git/sync/status/:jobId' },

  // Git history
  { method: 'GET', path: '/apps/:id/git/history' },

  // Publish
  { method: 'POST', path: '/apps/:id/publish' },

  // App lifecycle
  { method: 'POST', path: '/apps/:id/restart' },

  // Customer logs
  { method: 'GET', path: '/apps/:appId/customer-logs' },

  // DB Import Routes
  { method: 'POST', path: '/apps/:id/database/import' },
  { method: 'GET', path: '/apps/:id/database/import/:jobId' },
  { method: 'GET', path: '/apps/:id/database/import' },

  // DB table routes
  { method: 'GET', path: '/apps/:id/database/tables' },
  { method: 'GET', path: '/apps/:id/database/tables/:tableName/schema' },
  { method: 'GET', path: '/apps/:id/database/tables/:tableName/data' },
  { method: 'POST', path: '/apps/:id/database/tables/:tableName/rows' },
  { method: 'PUT', path: '/apps/:id/database/tables/:tableName/rows' },
  { method: 'DELETE', path: '/apps/:id/database/tables/:tableName/rows' },
  { method: 'GET', path: '/apps/:id/database/tables/:tableName/export' },
];

/**
 * Convert an Express-style route pattern to a RegExp.
 * `:param` segments become `[^/]+`.
 *
 * Security note (ReDoS): Although this function accepts an arbitrary string and uses
 * `new RegExp()`, all callers pass hardcoded patterns from `PAAS_ALLOWED_ROUTES` which
 * are compiled once at module load. The replacement only produces `[^/]+` segments —
 * no nested quantifiers or backtracking-prone constructs. Safe as-is.
 */
export function patternToRegex(pattern: string): RegExp {
  const regexStr = pattern.replace(/:([a-zA-Z0-9_]+)/g, '[^/]+');
  return new RegExp(`^${regexStr}$`);
}

/** Pre-compiled regex cache — built once at module load */
const compiledPatterns = PAAS_ALLOWED_ROUTES.map(route => ({
  method: route.method.toUpperCase(),
  regex: patternToRegex(route.path),
}));

/**
 * Check whether a given method + path is allowed for PaaS callers.
 */
export function isRouteAllowedForPaaS(method: string, path: string): boolean {
  const upperMethod = method.toUpperCase();
  return compiledPatterns.some(
    ({ method: allowedMethod, regex }) =>
      allowedMethod === upperMethod && regex.test(path)
  );
}

/**
 * Express middleware that enforces product-level route access.
 *
 * - Missing agentContext → 401
 * - AAB callers (`product !== 'PaaSNodeJS'`) → pass through (unrestricted)
 * - PaaS callers on allowed route → pass through
 * - PaaS callers on denied route → 403
 */
export function validateProductAccess(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  const agentContext = authReq.agentContext;

  if (!agentContext) {
    logger.warn('middleware.productAccess.noContext', {
      path: req.originalUrl,
      method: req.method,
    });
    res.status(401).json({ error: 'Authentication required', requiresAuth: true });
    return;
  }

  // AAB callers are unrestricted
  if (agentContext.product !== 'PaaSNodeJS') {
    next();
    return;
  }

  // PaaS caller — check allowlist
  // split('?') always returns at least one element
  const cleanPath = (req.originalUrl || req.path).split('?')[0]!;

  if (isRouteAllowedForPaaS(req.method, cleanPath)) {
    logger.debug('middleware.productAccess.allowed', {
      path: cleanPath,
      method: req.method,
      product: 'PaaSNodeJS',
    });
    next();
    return;
  }

  logger.warn('middleware.productAccess.denied', {
    path: cleanPath,
    method: req.method,
    product: 'PaaSNodeJS',
    siteId: agentContext.siteId,
  });
  res.status(403).json({ error: 'Route not available for PaaS consumers' });
}
