import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { Logger } from '../../logging/index.js';
import { validateAppOwnershipFromQuery, validateConversationOwnership, type ConversationRequest } from '../middleware/app-ownership.js';

const router: RouterType = Router();
const logger = Logger.create({ service: 'conversations-routes' });

/**
 * GET /api/conversations
 * Get all conversations for an app
 * SECURITY: Ownership validation prevents cross-tenant conversation listing
 */
router.get('/api/conversations', validateAppOwnershipFromQuery('appId'), async (req: Request, res: Response) => {
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
 * SECURITY: Conversation ownership validation prevents cross-tenant message access
 * The validateConversationOwnership middleware loads the conversation and validates ownership
 */
router.get('/api/conversations/:id/messages', validateConversationOwnership(), async (req: Request, res: Response) => {
  try {
    // Type-safe access to validated conversation data
    const authReq = req as ConversationRequest;
    const conversationId = authReq.conversation!.id;
    const appId = authReq.conversation!.appId;

    logger.debug('conversations.messages.begin', { conversationId, appId });

    const conversationRepo = new ConversationRepository();
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

/**
 * PATCH /api/conversations/:id/tools/:toolId
 * Update a tool's result in conversation history
 *
 * This enables widgets to persist their state changes to conversation history
 * so the final state is preserved across page refreshes.
 *
 * SECURITY: Ownership validation prevents cross-tenant conversation access
 * Requires appId query parameter to validate ownership
 */
router.patch('/api/conversations/:id/tools/:toolId', validateAppOwnershipFromQuery('appId'), async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.id;
    const toolId = req.params.toolId;
    const appId = req.query.appId as string;
    const { result } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    if (!toolId) {
      return res.status(400).json({ error: 'toolId is required' });
    }

    if (!appId) {
      return res.status(400).json({ error: 'appId query parameter is required' });
    }

    if (result === undefined) {
      return res.status(400).json({ error: 'result is required in request body' });
    }

    logger.debug('conversations.tool.update.begin', { conversationId, toolId, appId });

    const conversationRepo = new ConversationRepository();

    // Validate conversation exists and belongs to the requesting app
    const conversation = await conversationRepo.getById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.appId !== appId) {
      logger.warn('conversations.tool.update.unauthorized', {
        conversationId,
        toolId,
        requestedAppId: appId,
        actualAppId: conversation.appId
      });
      return res.status(403).json({ error: 'Unauthorized access to conversation' });
    }

    // Get all messages and find the one containing this tool
    // Search in reverse order (most recent first) since recent tools are more likely to be updated
    const messages = await conversationRepo.getMessages(conversationId);
    const messageWithTool = [...messages].reverse().find(msg =>
      msg.toolCalls?.some((tc: any) => tc.id === toolId)
    );

    if (!messageWithTool) {
      logger.warn('conversations.tool.update.not_found', {
        conversationId,
        toolId,
        messagesChecked: messages.length
      });
      return res.status(404).json({ error: 'Tool not found in conversation history' });
    }

    // Update the tool's result
    const updatedToolCalls = messageWithTool.toolCalls?.map((tc: any) => {
      if (tc.id === toolId) {
        return {
          ...tc,
          result,
          status: 'completed'
        };
      }
      return tc;
    });

    // Update the segments as well to keep them in sync
    const updatedSegments = messageWithTool.segments?.map((segment: any) => {
      if (segment.type === 'tool_call' && segment.toolCall?.id === toolId) {
        return {
          ...segment,
          toolCall: {
            ...segment.toolCall,
            result,
            status: 'completed'
          }
        };
      }
      return segment;
    });

    // Persist the updates
    await conversationRepo.updateMessage(messageWithTool.id, {
      toolCalls: updatedToolCalls || [],
      segments: updatedSegments || []
    });

    logger.info('conversations.tool.update.success', {
      conversationId,
      toolId,
      appId,
      messageId: messageWithTool.id
    });

    return res.json({
      success: true,
      messageId: messageWithTool.id,
      toolId
    });
  } catch (error) {
    logger.error('conversations.tool.update.error', {
      conversationId: req.params.id,
      toolId: req.params.toolId,
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({ error: 'Failed to update tool result' });
  }
});

export { router as conversationsRouter };

