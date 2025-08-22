import { Router, IRouter } from 'express';
import { globalTracer } from '../../utils/index.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';

const router: IRouter = Router();
const conversationRepo = new ConversationRepository();



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
 * GET /agent/conversations/:appId - Get all conversations for an app
 */
router.get('/conversations/:appId', async (req, res) => {
  try {
    const { appId } = req.params;
    const conversations = await conversationRepo.getConversationsWithMessageCount(appId);
    res.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * GET /agent/conversations/:appId/:conversationId - Get conversation with messages
 */
router.get('/conversations/:appId/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    
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
    console.error('Error fetching conversation:', error);
    return res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

/**
 * POST /agent/conversations - Create a new conversation
 */
router.post('/conversations', async (req, res) => {
  try {
    const { appId, agentId, title } = req.body;
    
    if (!appId || !agentId) {
      return res.status(400).json({ error: 'appId and agentId are required' });
    }

    const conversation = await conversationRepo.create(appId, agentId, title);
    return res.json(conversation);
  } catch (error) {
    console.error('Error creating conversation:', error);
    return res.status(500).json({ error: 'Failed to create conversation' });
  }
});

/**
 * PUT /agent/conversations/:conversationId/title - Update conversation title
 */
router.put('/conversations/:conversationId/title', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { title } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    await conversationRepo.updateTitle(conversationId, title);
    return res.json({ message: 'Title updated successfully' });
  } catch (error) {
    console.error('Error updating conversation title:', error);
    return res.status(500).json({ error: 'Failed to update conversation title' });
  }
});

/**
 * DELETE /agent/conversations/:conversationId - Delete a conversation
 */
router.delete('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    await conversationRepo.delete(conversationId);
    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

export { router as chatRouter };
