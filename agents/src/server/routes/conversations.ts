import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { Logger } from '../../logging/index.js';

const router: RouterType = Router();
const logger = Logger.create({ service: 'conversations-routes' });

/**
 * GET /api/conversations
 * Get all conversations for an app
 */
router.get('/api/conversations', async (req: Request, res: Response) => {
  try {
    const appId = req.query.appId as string;

    if (!appId) {
      return res.status(400).json({ error: 'appId query parameter is required' });
    }

    logger.debug('conversations.list.begin', { appId });

    const conversationRepo = new ConversationRepository();
    const conversations = await conversationRepo.getByAppId(appId);

    // Get message counts and last messages for each conversation
    const enrichedConversations = await Promise.all(
      conversations.map(async (conversation) => {
        const messages = await conversationRepo.getMessages(conversation.id);
        const lastUserMessage = messages
          .filter(m => m.sender === 'user')
          .pop();

        return {
          id: conversation.id,
          appId: conversation.appId,
          agentId: conversation.agentId,
          title: conversation.title,
          messageCount: messages.length,
          lastMessage: lastUserMessage?.content?.slice(0, 100),
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString()
        };
      })
    );

    logger.debug('conversations.list.success', {
      appId,
      count: enrichedConversations.length
    });

    return res.json({
      conversations: enrichedConversations,
      total: enrichedConversations.length
    });
  } catch (error) {
    logger.error('conversations.list.error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * GET /api/conversations/:id/messages
 * Get all messages for a specific conversation with full details
 *
 * Requires appId query parameter to validate ownership
 */
router.get('/api/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.id;
    const appId = req.query.appId as string;

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    if (!appId) {
      return res.status(400).json({ error: 'appId query parameter is required' });
    }

    logger.debug('conversations.messages.begin', { conversationId, appId });

    const conversationRepo = new ConversationRepository();

    // Validate conversation exists and belongs to the requesting app
    const conversation = await conversationRepo.getById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.appId !== appId) {
      logger.warn('conversations.messages.unauthorized', {
        conversationId,
        requestedAppId: appId,
        actualAppId: conversation.appId
      });
      return res.status(403).json({ error: 'Unauthorized access to conversation' });
    }

    const messages = await conversationRepo.getMessages(conversationId);

    const formattedMessages = messages.map(message => ({
      id: message.id,
      conversationId: message.conversationId,
      sender: message.sender,
      content: message.content,
      messageType: message.messageType,
      toolCalls: message.toolCalls || [],
      segments: message.segments || [],
      metadata: message.metadata || {},
      contextAttachments: message.contextAttachments || [],
      createdAt: message.createdAt.toISOString()
    }));

    logger.debug('conversations.messages.success', {
      conversationId,
      appId,
      count: formattedMessages.length
    });

    return res.json({
      messages: formattedMessages,
      total: formattedMessages.length
    });
  } catch (error) {
    logger.error('conversations.messages.error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

export { router as conversationsRouter };

