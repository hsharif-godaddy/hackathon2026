import { Router, IRouter } from 'express';
import { globalTracer } from '../../utils/index.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { logger } from '../../logging/index.js';

const router: IRouter = Router();
const conversationRepo = new ConversationRepository();

// Helper function to extract error message
const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
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
 */
router.get('/conversations/:appId', async (req, res) => {
  const { appId } = req.params;
  const { limit, offset } = req.query;
  
  const limitNum = limit ? parseInt(limit as string, 10) : 1; // Default to 1 for initial load
  const offsetNum = offset ? parseInt(offset as string, 10) : 0;
  
  if (isNaN(limitNum) || isNaN(offsetNum) || limitNum < 0 || offsetNum < 0) {
    return res.status(400).json({ error: 'Invalid limit or offset' });
  }

  try {
    
    const conversations = await conversationRepo.getConversationsWithMessageCount(appId, {
      limit: limitNum,
      offset: offsetNum
    });
    
    const total = await conversationRepo.getConversationCount(appId);
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
 */
router.get('/conversations/:appId/messages', async (req, res) => {
  const { appId } = req.params;
  const { conversationIds } = req.query;
  
  if (!conversationIds) {
    return res.status(400).json({ error: 'conversationIds query parameter is required' });
  }
  
  const ids = (conversationIds as string).split(',').map(id => id.trim());

  try {
    
    // Get all messages for the specified conversations in a single query
    const allMessages = await conversationRepo.getMessagesBatch(ids);
    
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
 */
router.get('/conversations/:appId/:conversationId', async (req, res) => {
  const { conversationId } = req.params;

  try {
    
    const conversation = await conversationRepo.getById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await conversationRepo.getMessages(conversationId);
    
    
    return res.json({
      conversation,
      messages
    });
  } catch (error) {
    logger.error('conversation.fetch.failure', {
      conversationId,
      error: getErrorMessage(error)
    });
    return res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

/**
 * POST /agent/conversations - Create a new conversation
 */
router.post('/conversations', async (req, res) => {
  const { appId, agentId, title } = req.body;

  try {
    
    if (!appId || !agentId) {
      return res.status(400).json({ error: 'appId and agentId are required' });
    }

    const conversation = await conversationRepo.create(appId, agentId, title);
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
 */
router.put('/conversations/:conversationId/title', async (req, res) => {
  const { conversationId } = req.params;
  const { title } = req.body;

  try {
    
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    await conversationRepo.updateTitle(conversationId, title);
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
 */
router.delete('/conversations/:conversationId', async (req, res) => {
  const { conversationId } = req.params;

  try {
    await conversationRepo.delete(conversationId);
    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    logger.error('conversation.delete.failure', {
      conversationId,
      error: getErrorMessage(error)
    });
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

export { router as chatRouter };
