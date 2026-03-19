/**
 * App Ownership Validation Middleware
 *
 * Validates that the authenticated agent (via JWT siteId) can only access
 * its own site. Agents are site-isolated and cannot access other sites.
 *
 * Validation Logic:
 * 1. Extract authenticated siteId from JWT token (req.agentContext)
 * 2. Extract requested appId from route params/body/query
 * 3. Validate that siteId === appId (agent can only access its own site)
 *
 * @example
 * // For route params (:id)
 * router.post('/apps/:id/zip/upload', validateAppOwnership, async (req, res) => {
 *   // Handler only executes if ownership validation passes
 * });
 *
 * // For body parameters
 * router.post('/files/upload', validateAppOwnershipFromBody('appId'), async (req, res) => {
 *   // Handler only executes if body.appId matches authenticated siteId
 * });
 *
 * // For query parameters
 * router.get('/conversations', validateAppOwnershipFromQuery('appId'), async (req, res) => {
 *   // Handler only executes if query.appId matches authenticated siteId
 * });
 */

import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './jwt-auth.js';
import { Logger } from '../../logging/index.js';
import { BYPASS_SITE_IDS } from '../../services/features.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';

const logger = Logger.create({ service: 'app-ownership-middleware' });

/**
 * Core validation logic shared across all ownership validators
 *
 * @param authenticatedSiteId - siteId from JWT token
 * @param requestedAppId - appId from request (params/body/query)
 * @param source - Where the appId was extracted from (for logging)
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 * @returns true if validation passed, false if response was sent
 */
function validateOwnership(
  authenticatedSiteId: string,
  requestedAppId: string | undefined,
  source: string,
  req: Request,
  res: Response,
  next: NextFunction
): boolean {
  // Validate appId parameter exists
  if (!requestedAppId || typeof requestedAppId !== 'string') {
    logger.warn('route.middleware.ownership.no-app-id', {
      authenticatedSiteId,
      path: req.path,
      source,
    }, { tags: ['security', 'authorization'] });
    res.status(400).json({
      success: false,
      error: 'App ID is required',
    });
    return false;
  }

  // SECURITY: Validate site isolation - agent can only access its authenticated site
  // This prevents cross-tenant data access where an attacker with valid credentials
  // for Site A attempts to access Site B's data by changing the appId parameter
  if (!BYPASS_SITE_IDS.includes(authenticatedSiteId) && authenticatedSiteId !== requestedAppId) {
    logger.error('route.middleware.ownership.denied', {
      message: 'SECURITY VIOLATION: Cross-tenant access attempt',
      authenticatedSiteId,
      requestedAppId,
      path: req.path,
      method: req.method,
      source,
      severity: 'HIGH'
    }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] });
    res.status(403).json({
      success: false,
      error: 'Access denied',
      message: 'Agent can only access its authenticated site',
    });
    return false;
  }

  // Validation passed - log success and continue
  logger.debug('route.middleware.ownership.granted', {
    authenticatedSiteId,
    requestedAppId,
    path: req.path,
    source,
  }, { tags: ['security', 'authorization-success'] });

  next();
  return true;
}

/**
 * Middleware to validate app ownership from route params (:id)
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
    if (!authReq.agentContext?.siteId) {
      logger.warn('route.middleware.ownership.no-context', {
        path: req.path,
        method: req.method,
      }, { tags: ['security', 'authentication'] });
      res.status(401).json({
        error: 'Authentication required',
        requiresAuth: true,
      });
      return;
    }

    const authenticatedSiteId = authReq.agentContext.siteId;
    const requestedAppId = req.params.id;

    validateOwnership(authenticatedSiteId, requestedAppId, 'params.id', req, res, next);
  } catch (error) {
    logger.error('route.middleware.ownership.error', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
      method: req.method,
    }, { tags: ['security', 'error'] });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

/**
 * Create middleware to validate app ownership from request body
 *
 * @param fieldName - Name of the field in request body containing appId (default: 'appId')
 * @returns Express middleware function
 *
 * @example
 * router.post('/files/upload', validateAppOwnershipFromBody('appId'), async (req, res) => {
 *   // Handler only executes if req.body.appId matches authenticated siteId
 * });
 */
export function validateAppOwnershipFromBody(fieldName: string = 'appId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const authReq = req as AuthenticatedRequest;

      // Ensure authentication context exists
      if (!authReq.agentContext?.siteId) {
        logger.warn('route.middleware.ownership.no-context', {
          path: req.path,
          method: req.method,
          source: `body.${fieldName}`,
        }, { tags: ['security', 'authentication'] });
        res.status(401).json({
          error: 'Authentication required',
          requiresAuth: true,
        });
        return;
      }

      const authenticatedSiteId = authReq.agentContext.siteId;
      const requestedAppId = req.body?.[fieldName];

      validateOwnership(authenticatedSiteId, requestedAppId, `body.${fieldName}`, req, res, next);
    } catch (error) {
      logger.error('route.middleware.ownership.error', {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
        method: req.method,
        source: `body.${fieldName}`,
      }, { tags: ['security', 'error'] });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  };
}

/**
 * Create middleware to validate app ownership from query parameters
 *
 * @param fieldName - Name of the query parameter containing appId (default: 'appId')
 * @returns Express middleware function
 *
 * @example
 * router.get('/conversations', validateAppOwnershipFromQuery('appId'), async (req, res) => {
 *   // Handler only executes if req.query.appId matches authenticated siteId
 * });
 */
export function validateAppOwnershipFromQuery(fieldName: string = 'appId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const authReq = req as AuthenticatedRequest;

      // Ensure authentication context exists
      if (!authReq.agentContext?.siteId) {
        logger.warn('route.middleware.ownership.no-context', {
          path: req.path,
          method: req.method,
          source: `query.${fieldName}`,
        }, { tags: ['security', 'authentication'] });
        res.status(401).json({
          error: 'Authentication required',
          requiresAuth: true,
        });
        return;
      }

      const authenticatedSiteId = authReq.agentContext.siteId;
      const requestedAppId = req.query?.[fieldName] as string | undefined;

      validateOwnership(authenticatedSiteId, requestedAppId, `query.${fieldName}`, req, res, next);
    } catch (error) {
      logger.error('route.middleware.ownership.error', {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
        method: req.method,
        source: `query.${fieldName}`,
      }, { tags: ['security', 'error'] });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  };
}

/**
 * Extended request interface with conversation data
 */
export interface ConversationRequest extends AuthenticatedRequest {
  conversation?: {
    id: string;
    appId: string;
    agentId: string;
  };
}

/**
 * Middleware to validate conversation ownership
 *
 * Loads the conversation from the database and verifies that:
 * 1. The conversation exists
 * 2. The conversation.appId matches the authenticated siteId
 * 3. Attaches the conversation to req for use in handlers
 *
 * Requirements:
 * - JWT authentication must run before this middleware
 * - Route must have :id or :conversationId parameter
 *
 * @param paramName - Name of route parameter containing conversationId (default: 'id')
 * @returns Express middleware function
 *
 * @example
 * router.get('/conversations/:id', validateConversationOwnership(), async (req, res) => {
 *   // Handler only executes if conversation belongs to authenticated site
 *   // req.conversation is populated with validated conversation data
 * });
 *
 * router.get('/conversations/:conversationId/messages', validateConversationOwnership('conversationId'), ...)
 */
export function validateConversationOwnership(paramName: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as ConversationRequest;

      // Ensure authentication context exists
      if (!authReq.agentContext?.siteId) {
        logger.warn('route.middleware.conversation.no-context', {
          path: req.path,
          method: req.method,
        }, { tags: ['security', 'authentication'] });
        res.status(401).json({
          error: 'Authentication required',
          requiresAuth: true,
        });
        return;
      }

      const authenticatedSiteId = authReq.agentContext.siteId;
      const conversationId = req.params[paramName];

      // Validate conversationId parameter exists
      if (!conversationId) {
        logger.warn('route.middleware.conversation.no-id', {
          authenticatedSiteId,
          path: req.path,
          paramName,
        }, { tags: ['security', 'authorization'] });
        res.status(400).json({
          success: false,
          error: 'Conversation ID is required',
        });
        return;
      }

      // Load conversation from database
      const conversationRepo = new ConversationRepository();
      const conversation = await conversationRepo.getById(conversationId);

      // Validate conversation exists
      if (!conversation) {
        logger.warn('route.middleware.conversation.not-found', {
          authenticatedSiteId,
          conversationId,
          path: req.path,
        }, { tags: ['security', 'authorization'] });
        res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
        return;
      }

      // SECURITY: Validate conversation belongs to authenticated site
      // This prevents cross-tenant data access where an attacker with valid credentials
      // for Site A attempts to access Site B's conversation by changing the conversationId
      if (!BYPASS_SITE_IDS.includes(authenticatedSiteId) && conversation.appId !== authenticatedSiteId) {
        logger.error('route.middleware.conversation.denied', {
          message: 'SECURITY VIOLATION: Cross-tenant conversation access attempt',
          authenticatedSiteId,
          requestedConversationId: conversationId,
          conversationAppId: conversation.appId,
          path: req.path,
          method: req.method,
          severity: 'HIGH'
        }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] });
        res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'Agent can only access conversations from its authenticated site',
        });
        return;
      }

      // Validation passed - attach conversation to request and continue
      authReq.conversation = {
        id: conversation.id,
        appId: conversation.appId,
        agentId: conversation.agentId
      };

      logger.debug('route.middleware.conversation.granted', {
        authenticatedSiteId,
        conversationId: conversation.id,
        conversationAppId: conversation.appId,
        path: req.path,
      }, { tags: ['security', 'authorization-success'] });

      next();
    } catch (error) {
      logger.error('route.middleware.conversation.error', {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
        method: req.method,
      }, { tags: ['security', 'error'] });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  };
}
