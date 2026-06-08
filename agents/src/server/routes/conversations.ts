import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { Logger } from '../../logging/index.js';
import { getConversationLifecycleStore, getMessageStore } from '../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js';
import { validateAppOwnershipFromQuery, validateConversationOwnership, type ConversationRequest } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { mapSegmentsToUI, mapToolCallsToUI } from '../tool-call-mapper.js';

const router: RouterType = Router();
const logger = Logger.create({ component: 'conversations-routes' });
const lifecycle = getConversationLifecycleStore();
const messages = getMessageStore();

const patchMessageMetadataSchema = z.object({
  metadata: z.object({
    feedback: z.enum(['positive', 'negative']).nullable(),
  }),
});

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

    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const conversations = await lifecycle.getByAppId(workspaceScopeFromAppId(appId, customerId));

    const enrichedConversations = await Promise.all(
      conversations.map(async (conversation) => {
        const msgs = await messages.getMessages(conversation.id);
        const lastUserMessage = msgs
          .filter(m => m.sender === 'user')
          .pop();

        return {
          id: conversation.id,
          appId: conversation.appId,
          agentId: conversation.agentId,
          title: conversation.title,
          messageCount: msgs.length,
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

    const msgs = await messages.getMessages(conversationId);

    const formattedMessages = msgs.map(message => ({
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
 * GET /api/conversations/:id/messages/paginated
 * Get paginated messages for a conversation (cursor-based)
 * Query params: limit (default 20, max 100), before (cursor - message ID)
 * SECURITY: Conversation ownership validation prevents cross-tenant message access
 */
router.get('/api/conversations/:id/messages/paginated', validateConversationOwnership(), async (req: Request, res: Response) => {
  try {
    const authReq = req as ConversationRequest;
    const conversationId = authReq.conversation!.id;
    const appId = authReq.conversation!.appId;

    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100);
    const before = req.query.before as string | undefined;

    logger.debug('conversations.messages.paginated.begin', { conversationId, appId, limit, before });

    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const result = await messages.getMessagesPaginated(workspaceScopeFromAppId(appId, customerId), conversationId, { limit, before });

    const paginatedMsgs = result.messages.map(msg => {
      let sender: 'user' | 'assistant';
      if (msg.sender === 'agent') {
        sender = 'assistant';
      } else if (msg.sender === 'user') {
        sender = 'user';
      } else {
        logger.warn('conversations.messages.paginated.unexpected_sender', {
          conversationId, messageId: msg.id, sender: msg.sender,
        });
        sender = 'assistant';
      }

      return {
        id: msg.id,
        conversationId: msg.conversationId,
        sender,
        content: msg.content,
        createdAt: msg.createdAt.toISOString(),
        ...(msg.messageType != null && { messageType: msg.messageType }),
        ...(msg.toolCalls != null && { toolCalls: mapToolCallsToUI(msg.toolCalls as any) }),
        ...(msg.segments != null && { segments: mapSegmentsToUI(msg.segments as any) }),
        ...(msg.metadata != null && { metadata: msg.metadata }),
        ...(msg.contextAttachments != null && { contextAttachments: msg.contextAttachments }),
        ...(msg.origin != null && { origin: msg.origin }),
      };
    });

    logger.debug('conversations.messages.paginated.success', {
      conversationId, appId, count: paginatedMsgs.length, hasMore: result.hasMore,
    });

    return res.json({
      messages: paginatedMsgs,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      total: result.total,
    });
  } catch (error) {
    logger.error('conversations.messages.paginated.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * PATCH /api/conversations/:id/messages/:messageId
 * Merge metadata onto a persisted conversation message (e.g. per-message thumbs up/down state).
 * SECURITY: Conversation ownership validation prevents cross-tenant message access
 */
router.patch(
  '/api/conversations/:id/messages/:messageId',
  validateConversationOwnership(),
  async (req: Request, res: Response) => {
    try {
      const authReq = req as ConversationRequest;
      const conversationId = authReq.conversation!.id;
      const messageId = req.params.messageId;

      const parsed = patchMessageMetadataSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        });
      }

      if (!messageId) {
        logger.warn('conversations.message.metadata.update.missing_message_id', {
          conversationId,
        });
        return res.status(400).json({ error: 'messageId is required' });
      }

      const message = await messages.getMessageById(messageId);
      if (!message || message.conversationId !== conversationId) {
        return res.status(404).json({ error: 'Message not found' });
      }

      await messages.updateMessageMetadata(messageId, parsed.data.metadata);

      logger.info('conversations.message.metadata.updated', {
        conversationId,
        messageId,
        feedback: parsed.data.metadata.feedback,
      });

      return res.json({
        success: true,
        messageId,
        metadata: parsed.data.metadata,
      });
    } catch (error) {
      logger.error('conversations.message.metadata.update.error', {
        conversationId: req.params.id,
        messageId: req.params.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: 'Failed to update message metadata' });
    }
  }
);

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

    const conversation = await lifecycle.getById(conversationId);
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

    const allMsgs = await messages.getMessages(conversationId);
    const messageWithTool = [...allMsgs].reverse().find(msg =>
      msg.toolCalls?.some((tc: any) => tc.id === toolId)
    );

    if (!messageWithTool) {
      logger.warn('conversations.tool.update.not_found', {
        conversationId,
        toolId,
        messagesChecked: allMsgs.length
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

    await messages.updateMessage(messageWithTool.id, {
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

export const conversationsRouter = router;
