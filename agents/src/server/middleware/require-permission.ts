/**
 * Permission Check Middleware
 *
 * Reusable middleware for checking JWT permissions after authentication.
 * Use after jwtAuthMiddleware to verify specific permissions (canPublish, canDownload).
 */

import { ApiErrorCode } from '@airo/shared/api-error-code';
import { Request, Response, NextFunction } from 'express';

import type { AuthenticatedRequest } from './jwt-auth.js';
import { log } from '../../logging/index.js';

/**
 * Permission types that can be required
 */
export type Permission = 'canPublish' | 'canDownload';

/**
 * Error messages for each permission type
 */
const PERMISSION_ERRORS: Record<Permission, { error: string; details: string }> = {
  canPublish: {
    error: 'Publish not allowed',
    details: 'Publishing requires a paid Airo Builder plan'
  },
  canDownload: {
    error: 'Download not allowed',
    details: 'Downloading requires a paid Airo Builder plan'
  }
};

/**
 * Create middleware that requires a specific permission
 *
 * @param permission - The permission to check ('canPublish' or 'canDownload')
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * router.post('/apps/:id/publish', requirePermission('canPublish'), async (req, res) => {
 *   // Handler code - permission already verified
 * });
 * ```
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    const appId = req.params.id;

    // Check if agentContext exists (should be set by jwtAuthMiddleware)
    if (!authReq.agentContext) {
      const contextLogger = appId ? log.forApp(appId) : log.forAgent('permission-middleware');
      contextLogger.error('middleware.require-permission.no-context', {
        permission,
        reason: 'missing_agentContext',
        message: 'agentContext not found - ensure jwtAuthMiddleware runs first'
      });
      res.status(401).json({
        error: 'Authentication required',
        details: 'Request must be authenticated before checking permissions'
      });
      return;
    }

    // Check if user has the required permission
    if (!authReq.agentContext[permission]) {
      const contextLogger = appId ? log.forApp(appId) : log.forAgent('permission-middleware');
      contextLogger.error('middleware.require-permission.forbidden', {
        appId,
        permission,
        reason: `missing_${permission}_permission`
      });

      res.status(403).json({
        ...PERMISSION_ERRORS[permission],
        code: ApiErrorCode.PermissionDenied,
      });
      return;
    }

    // Permission granted - continue to route handler
    next();
  };
}
