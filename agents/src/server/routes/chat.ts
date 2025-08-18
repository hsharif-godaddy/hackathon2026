import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AgentRegistry } from '../../registry/index.js';
import { NotFoundError, BadRequestError } from '../middleware/index.js';
import type { AgentExecutionContext } from '../../base/index.js';

const router = Router();
const registry = AgentRegistry.getInstance();

/**
 * Chat message interface
 */
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

/**
 * Chat request interface
 */
interface ChatRequest {
  message: string;
  threadId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  stream?: boolean;
}

/**
 * POST /agent/:agentId/chat-streaming - Streaming chat endpoint
 */
router.post('/:agentId/chat-streaming', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const chatRequest: ChatRequest = req.body;
    
    // Validate request
    if (!chatRequest.message) {
      throw new BadRequestError('Message is required');
    }
    
    if (!registry.hasAgent(agentId)) {
      throw new NotFoundError(`Agent '${agentId}' not found`);
    }
    
    // Get agent instance
    const agent = await registry.getAgent(agentId);
    
    // Create execution context
    const context: AgentExecutionContext = {
      threadId: chatRequest.threadId || uuidv4(),
      userId: chatRequest.userId || undefined,
      metadata: chatRequest.metadata || undefined,
      timestamp: new Date(),
    };
    
    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    
    // Send initial metadata
    res.write(`data: ${JSON.stringify({
      type: 'metadata',
      threadId: context.threadId,
      agentId,
      agentName: agent.getConfig().name,
      timestamp: context.timestamp.toISOString(),
    })}\\n\\n`);
    
    // For now, we'll simulate a streaming response
    // In a real implementation, this would integrate with the agent-sdk
    const systemPrompt = await agent.getSystemPrompt(context);
    
    // Send system prompt (for debugging/transparency)
    res.write(`data: ${JSON.stringify({
      type: 'system_prompt',
      content: systemPrompt,
    })}\\n\\n`);
    
    // Simulate agent thinking
    res.write(`data: ${JSON.stringify({
      type: 'status',
      status: 'thinking',
      message: 'Agent is processing your request...',
    })}\\n\\n`);
    
    // Simulate streaming response
    const response = `I'm the ${agent.getConfig().name}. I received your message: "${chatRequest.message}". This is a simulated response from the class-based agent system. In a full implementation, this would connect to the actual agent SDK for real conversation handling.`;
    
    // Stream the response word by word
    const words = response.split(' ');
    for (let i = 0; i < words.length; i++) {
      const isLast = i === words.length - 1;
      const content = words[i] + (isLast ? '' : ' ');
      
      res.write(`data: ${JSON.stringify({
        type: 'content',
        content,
        isComplete: isLast,
      })}\\n\\n`);
      
      // Add small delay to simulate real streaming
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Send completion signal
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      threadId: context.threadId,
      timestamp: new Date().toISOString(),
    })}\\n\\n`);
    
    res.end();
    
  } catch (error) {
    // Send error through SSE
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    })}\\n\\n`);
    res.end();
    next(error);
  }
});

/**
 * POST /agent/:agentId/chat - Non-streaming chat endpoint
 */
router.post('/:agentId/chat', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const chatRequest: ChatRequest = req.body;
    
    // Validate request
    if (!chatRequest.message) {
      throw new BadRequestError('Message is required');
    }
    
    if (!registry.hasAgent(agentId)) {
      throw new NotFoundError(`Agent '${agentId}' not found`);
    }
    
    // Get agent instance
    const agent = await registry.getAgent(agentId);
    
    // Create execution context
    const context: AgentExecutionContext = {
      threadId: chatRequest.threadId || uuidv4(),
      userId: chatRequest.userId || undefined,
      metadata: chatRequest.metadata || undefined,
      timestamp: new Date(),
    };
    
    // For now, simulate a response
    // In a real implementation, this would integrate with the agent-sdk
    const systemPrompt = await agent.getSystemPrompt(context);
    
    const response = `I'm the ${agent.getConfig().name}. I received your message: "${chatRequest.message}". This is a simulated response from the class-based agent system.`;
    
    res.json({
      agentId,
      agentName: agent.getConfig().name,
      threadId: context.threadId,
      message: response,
      timestamp: new Date().toISOString(),
      metadata: {
        systemPromptLength: systemPrompt.length,
        toolCount: agent.getTools().length,
      },
    });
    
  } catch (error) {
    next(error);
  }
});

export { router as chatRouter };
