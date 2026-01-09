/**
 * App Ownership Validation Middleware
 *
 * Validates that the authenticated agent (via JWT siteId) can only access
 * its own site. Agents are site-isolated and cannot access other sites.
 *
 * Validation Logic:
 * 1. Extract authenticated siteId from JWT token (req.agentContext)
 * 2. Extract requested appId from route params (req.params.id)
 * 3. Validate that siteId === appId (agent can only access its own site)
 *
 * @example
 * router.post('/apps/:id/git/replace', validateAppOwnership, async (req, res) => {
 *   // Handler only executes if ownership validation passes
 * });
 */

import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './jwt-auth.js';
import { Logger } from '../../logging/index.js';
import { BYPASS_SITE_IDS } from '../../services/features.js';

const logger = Logger.create({ service: 'app-ownership-middleware' });

/**
 * Middleware to validate app ownership based on site isolation
 *
 * Requirements:
 * - JWT authentication must run before this middleware
 * - Route must have :id parameter containing the requested appId
 *
 * @param req - Express request with agentContext and params
 * @param res - Express response
 * @param next - Express next function
 */
export function validateAppOwnership(req: Request, res: Response, next: NextFunction): void {
  try {
    const authReq = req as AuthenticatedRequest;

    // Ensure authentication context exists
    if (!authReq.agentContext || !authReq.agentContext.siteId) {
      logger.warn('route.middleware.ownership.no-context', {
        path: req.path,
        method: req.method,
      });
      res.status(401).json({
        error: 'Authentication required',
        requiresAuth: true,
      });
      return;
    }

    const authenticatedSiteId = authReq.agentContext.siteId;
    const requestedAppId = req.params.id;

    // Validate appId parameter exists
    if (!requestedAppId) {
      logger.warn('route.middleware.ownership.no-app-id', {
        authenticatedSiteId,
        path: req.path,
      });
      res.status(400).json({
        success: false,
        error: 'App ID is required',
      });
      return;
    }

    // Validate site isolation: agent can only access its authenticated site
    if (!BYPASS_SITE_IDS.includes(authenticatedSiteId) && authenticatedSiteId !== requestedAppId) {
      logger.warn('route.middleware.ownership.denied', {
        authenticatedSiteId,
        requestedAppId,
        path: req.path,
        method: req.method,
      });
      res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'Agent can only access its authenticated site',
      });
      return;
    }

    // Validation passed - log success and continue
    logger.info('route.middleware.ownership.granted', {
      authenticatedSiteId,
      requestedAppId,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('route.middleware.ownership.error', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method,
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}
