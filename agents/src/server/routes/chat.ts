import { Router, IRouter, Request, Response, NextFunction } from 'express';
import { globalTracer } from '../../utils/index.js';
import { logger } from '../../logging/index.js';
import { getConversationLifecycleStore, getMessageStore } from '../../memory/adapters/index.js';
import { validateAppOwnershipFromBody, validateConversationOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js';
import { BYPASS_SITE_IDS } from '../../services/features.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { skillToolManager } from '../../tools/skill-tool-manager.js';

const router: IRouter = Router();
const lifecycle = getConversationLifecycleStore();
const messages = getMessageStore();
const chatConversationRepo = new ConversationRepository();

// Helper function to extract error message
const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

// SECURITY: Middleware to validate :appId param matches authenticated siteId
// Similar to validateAppOwnership but for routes using :appId instead of :id
const validateAppIdParam = (req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthenticatedRequest;
  const authenticatedSiteId = authReq.agentContext?.siteId;
  const requestedAppId = req.params.appId;

  if (!authenticatedSiteId) {
    res.status(401).json({ error: 'Authentication required', requiresAuth: true });
    return;
  }

  if (!requestedAppId) {
    res.status(400).json({ error: 'appId is required' });
    return;
  }

  if (!BYPASS_SITE_IDS.includes(authenticatedSiteId) && authenticatedSiteId !== requestedAppId) {
    logger.error('route.chat.ownership.denied', {
      message: 'SECURITY VIOLATION: Cross-tenant conversation access attempt',
      authenticatedSiteId,
      requestedAppId,
      path: req.path
    }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] });
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  next();
};



/**
 * GET /agent/traces - Get tracing information for debugging
 */
router.get('/traces', (req, res) => {
  const { agentId, threadId, type, since } = req.query;

  const filters: any = {};
  if (agentId) filters.agentId = agentId as string;
  if (threadId) filters.threadId = threadId as string;
  if (type) filters.type = type as string;
  if (since) filters.since = new Date(since as string);

  const events = globalTracer.getEvents(filters);

  res.json({
    total: events.length,
    filters,
    events: events.slice(0, 100), // Limit to last 100 events
  });
});

/**
 * DELETE /agent/traces - Clear traces
 */
router.delete('/traces', (req, res) => {
  globalTracer.clear();
  res.json({ message: 'Traces cleared' });
});

/**
 * GET /agent/conversations/:appId - Get conversations for an app with pagination
 * Query params: limit, offset
 * SECURITY: Ownership validation prevents cross-tenant conversation listing
 */
router.get('/conversations/:appId', validateAppIdParam, async (req, res) => {
  const appId = req.params.appId!; // Validated by validateAppIdParam middleware
  const { limit, offset } = req.query;

  const limitNum = limit ? parseInt(limit as string, 10) : 1; // Default to 1 for initial load
  const offsetNum = offset ? parseInt(offset as string, 10) : 0;

  if (isNaN(limitNum) || isNaN(offsetNum) || limitNum < 0 || offsetNum < 0) {
    return res.status(400).json({ error: 'Invalid limit or offset' });
  }

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const scope = workspaceScopeFromAppId(appId, customerId);
    const [conversations, total] = await Promise.all([
      lifecycle.getConversationsWithMessageCount(scope, {
        limit: limitNum,
        offset: offsetNum
      }),
      lifecycle.getConversationCount(scope),
    ]);
    const hasMore = offsetNum + conversations.length < total;

    logger.info('conversations.fetch.success', {
      appId,
      limit: limitNum,
      offset: offsetNum,
      conversationsFound: conversations.length,
      total,
      hasMore
    });

    res.json({
      conversations,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore
      }
    });
    return;
  } catch (error) {
    logger.error('conversations.fetch.failure', {
      appId,
      error: getErrorMessage(error),
      limit: limitNum,
      offset: offsetNum
    });
    res.status(500).json({ error: 'Failed to fetch conversations' });
    return;
  }
});

/**
 * GET /agent/conversations/:appId/messages - Get messages from multiple conversations
 * Query params: conversationIds (comma-separated)
 * NOTE: This route must come before /:conversationId to avoid conflicts
 * SECURITY: Ownership validation prevents cross-tenant message access
 */
router.get('/conversations/:appId/messages', validateAppIdParam, async (req, res) => {
  const appId = req.params.appId!; // Validated by validateAppIdParam middleware
  const { conversationIds } = req.query;

  if (!conversationIds) {
    return res.status(400).json({ error: 'conversationIds query parameter is required' });
  }

  const ids = (conversationIds as string).split(',').map(id => id.trim());

  try {
    // SECURITY: Validate that all requested conversations belong to the authenticated app
    if (ids.length > 0) {
      // Fetch all conversations in one query (optimized batch query)
      const conversations = await lifecycle.findByIds(ids);

      // Check that all requested IDs were found
      if (conversations.length !== ids.length) {
        const foundIds = new Set(conversations.map(c => c.id));
        const missingIds = ids.filter(id => !foundIds.has(id));
        logger.warn('chat.messages.conversation-not-found', {
          appId,
          requestedIds: ids,
          foundIds: Array.from(foundIds),
          missingIds
        });
        return res.status(404).json({
          error: 'One or more conversations not found'
        });
      }

      // Check ownership for all conversations
      const unauthorizedConv = conversations.find(conv => conv.appId !== appId);
      if (unauthorizedConv) {
        logger.error('chat.messages.cross-tenant-attempt', {
          message: 'SECURITY VIOLATION: Attempted to fetch conversation from different app',
          authenticatedAppId: appId,
          conversationId: unauthorizedConv.id,
          conversationAppId: unauthorizedConv.appId,
          severity: 'HIGH'
        }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] });

        return res.status(403).json({
          error: 'Access denied',
          message: 'Cannot access conversations from different app'
        });
      }
    }

    // Get all messages for the specified conversations in a single query
    const allMessages = await messages.getMessagesBatch(ids);

    // Sort messages by timestamp (already includes conversationId from the batch query)
    allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    logger.info('conversations.messages.bulk_fetch.success', {
      appId,
      conversationIds: ids,
      messagesFound: allMessages.length
    });

    return res.json({ messages: allMessages });
  } catch (error) {
    logger.error('conversations.messages.bulk_fetch.failure', {
      appId,
      conversationIds: ids,
      error: getErrorMessage(error)
    });
    return res.status(500).json({ error: 'Failed to fetch conversation messages' });
  }
});

/**
 * GET /agent/conversations/:appId/:conversationId - Get conversation with messages
 * SECURITY: Validates both appId ownership and that conversationId belongs to that app
 */
router.get('/conversations/:appId/:conversationId', validateAppIdParam, validateConversationOwnership('conversationId'), async (req, res) => {
  const appId = req.params.appId!; // Validated by validateAppIdParam middleware
  const conversationId = req.params.conversationId!; // Validated by validateConversationOwnership middleware

  const { limit, before } = req.query;
  const paginated = limit !== undefined || before !== undefined;

  try {
    const conversation = await lifecycle.getById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (paginated) {
      const limitNum = limit !== undefined ? parseInt(limit as string, 10) : 50;
      if (Number.isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ error: 'Invalid limit' });
      }
      const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
      const scope = workspaceScopeFromAppId(appId, customerId);
      const result = await messages.getMessagesPaginated(scope, conversationId, {
        limit: limitNum,
        before: typeof before === 'string' ? before : undefined,
      });
      return res.json({
        conversation,
        messages: result.messages,
        pagination: {
          total: result.total,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      });
    }

    const msgs = await messages.getMessages(conversationId);
    return res.json({ conversation, messages: msgs });
  } catch (error) {
    logger.error('conversation.fetch.failure', {
      conversationId,
      paginated,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

/**
 * POST /agent/conversations - Create a new conversation
 * SECURITY: Ownership validation prevents creating conversations for other tenants
 */
router.post('/conversations', validateAppOwnershipFromBody('appId'), async (req, res) => {
  const { appId, agentId, title } = req.body;

  try {

    if (!appId || !agentId) {
      return res.status(400).json({ error: 'appId and agentId are required' });
    }

    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const conversation = await lifecycle.create(workspaceScopeFromAppId(appId, customerId), agentId, title);
    return res.json(conversation);
  } catch (error) {
    logger.error('conversation.create.failure', {
      appId,
      agentId,
      title,
      error: getErrorMessage(error)
    });
    return res.status(500).json({ error: 'Failed to create conversation' });
  }
});

/**
 * PUT /agent/conversations/:conversationId/title - Update conversation title
 * SECURITY: Validates that conversation belongs to authenticated tenant
 */
router.put('/conversations/:conversationId/title', validateConversationOwnership('conversationId'), async (req, res) => {
  const conversationId = req.params.conversationId!; // Validated by validateConversationOwnership middleware
  const { title } = req.body;

  try {

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    await lifecycle.updateTitle(conversationId, title);
    return res.json({ message: 'Title updated successfully' });
  } catch (error) {
    logger.error('conversation.title.update.failure', {
      conversationId,
      title,
      error: getErrorMessage(error)
    });
    return res.status(500).json({ error: 'Failed to update conversation title' });
  }
});

/**
 * DELETE /agent/conversations/:conversationId - Delete a conversation
 * SECURITY: Validates that conversation belongs to authenticated tenant
 */
router.delete('/conversations/:conversationId', validateConversationOwnership('conversationId'), async (req, res) => {
  const conversationId = req.params.conversationId!; // Validated by validateConversationOwnership middleware

  try {
    // Resolve appId BEFORE delete so we can persist the pinned-skills
    // file removal even if the manager has not yet observed this conv.
    let pinAppId: string | undefined;
    try {
      const conversation = await chatConversationRepo.getById(conversationId);
      pinAppId = conversation?.appId;
    } catch (error) {
      logger.warn('conversation.delete.pin_app_lookup_failed', {
        conversationId,
        error: getErrorMessage(error),
      });
    }

    await lifecycle.delete(conversationId);
    skillToolManager.clearConversation(conversationId, pinAppId);
    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    logger.error('conversation.delete.failure', {
      conversationId,
      error: getErrorMessage(error)
    });
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

export const chatRouter = router;
