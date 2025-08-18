import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AgentRegistry } from '../../registry/index.js';
import { NotFoundError, BadRequestError } from '../middleware/index.js';
import { getLLMService } from '../../services/index.js';
import { globalTracer } from '../../utils/index.js';
import { AppRepository } from '../../database/index.js';
import { getToolDefinitions, executeToolFunction } from '../../tools/index.js';
import type { AgentExecutionContext } from '../../base/index.js';

const router = Router();
const registry = AgentRegistry.getInstance();
const appRepo = new AppRepository();

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
  appId?: string;
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
    
    globalTracer.trace({
      type: 'request',
      data: {
        endpoint: 'chat-streaming',
        agentId,
        message: chatRequest.message,
        appId: chatRequest.appId,
        hasThreadId: !!chatRequest.threadId,
        hasUserId: !!chatRequest.userId,
      },
    });
    
    // Validate request
    if (!chatRequest.message) {
      throw new BadRequestError('Message is required');
    }
    
    // Require appId for develop agent
    if (agentId === 'develop' && !chatRequest.appId) {
      throw new BadRequestError('appId is required for develop agent');
    }
    
    // Validate appId exists if provided
    if (chatRequest.appId) {
      const app = appRepo.findById(chatRequest.appId);
      if (!app) {
        throw new NotFoundError(`App '${chatRequest.appId}' not found`);
      }
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
      metadata: { 
        agentId,
        appId: chatRequest.appId,
        ...chatRequest.metadata 
      },
      timestamp: new Date(),
    };
    
    globalTracer.trace({
      type: 'debug',
      agentId,
      threadId: context.threadId,
      data: {
        message: 'Execution context created',
        context,
      },
    });
    
    // Get system prompt (validate everything before starting stream)
    const systemPrompt = await agent.getSystemPrompt(context);
    
    globalTracer.trace({
      type: 'debug',
      agentId,
      threadId: context.threadId,
      data: {
        message: 'System prompt loaded',
        promptLength: systemPrompt.length,
      },
    });
    
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
    })}\n\n`);
      
    // Send thinking status
    res.write(`data: ${JSON.stringify({
      type: 'status',
      status: 'thinking',
      message: 'Agent is processing your request...',
      })}\n\n`);
    
    try {
      // Use actual LLM service
      const llmService = getLLMService();
      
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: chatRequest.message },
      ];
      
      globalTracer.trace({
        type: 'debug',
        agentId,
        threadId: context.threadId,
        data: {
          message: 'Starting LLM processing',
          messageCount: messages.length,
        },
      });
      
      // Get tool definitions if the agent has tools
      const tools = agent.getTools().length > 0 ? getToolDefinitions() : undefined;
      
      // Use non-streaming for function calls, streaming for regular responses
      if (tools) {
        await handleWithFunctionCalls(llmService, { messages, tools }, context, agent, res);
      } else {
        await handleStreaming(llmService, { messages }, context, res);
      }
      
    } catch (llmError) {
      globalTracer.trace({
        type: 'error',
        agentId,
        threadId: context.threadId,
        data: {
          message: 'LLM error occurred',
          error: llmError instanceof Error ? llmError.message : String(llmError),
          stack: llmError instanceof Error ? llmError.stack : undefined,
        },
      });
      
      // Send error message to client
      res.write(`data: ${JSON.stringify({
        type: 'content',
        content: `I apologize, but I encountered an error processing your request: ${llmError instanceof Error ? llmError.message : 'Unknown error'}`,
        isComplete: false,
      })}\n\n`);
    }
    
    // Send completion signal
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      threadId: context.threadId,
      timestamp: new Date().toISOString(),
    })}\n\n`);
    
    res.end();
    
    globalTracer.trace({
      type: 'response',
      agentId,
      threadId: context.threadId,
      data: {
        message: 'Streaming response completed',
      },
    });
    
  } catch (error) {
    globalTracer.trace({
      type: 'error',
      data: {
        endpoint: 'chat-streaming',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    
    // Send error through SSE
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    })}\n\n`);
    res.end();
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
    
    // Require appId for develop agent
    if (agentId === 'develop' && !chatRequest.appId) {
      throw new BadRequestError('appId is required for develop agent');
    }
    
    // Validate appId exists if provided
    if (chatRequest.appId) {
      const app = appRepo.findById(chatRequest.appId);
      if (!app) {
        throw new NotFoundError(`App '${chatRequest.appId}' not found`);
      }
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
 * Handle LLM responses with function calling support
 */
async function handleWithFunctionCalls(
  llmService: any,
  request: any,
  context: AgentExecutionContext,
  agent: any,
  res: any
): Promise<void> {
  const messages = [...request.messages];
  let functionCallCount = 0;
  const maxFunctionCalls = 25; // Prevent infinite loops

  while (functionCallCount < maxFunctionCalls) {
    const response = await llmService.complete(request, context);

    if (response.tool_calls && response.tool_calls.length > 0) {
      // Handle tool calls
      res.write(`data: ${JSON.stringify({
        type: 'status',
        status: 'executing_tools',
        message: `Executing ${response.tool_calls.length} tool(s)...`,
      })}\n\n`);

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      });

      // Execute each tool call
      for (const toolCall of response.tool_calls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeToolFunction(toolCall.function.name, args, context);
          
          // Add tool result to messages
          messages.push({
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
          });

          res.write(`data: ${JSON.stringify({
            type: 'tool_result',
            tool_name: toolCall.function.name,
            tool_result: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          })}\n\n`);

        } catch (error) {
          const errorMessage = `Error executing ${toolCall.function.name}: ${error instanceof Error ? error.message : String(error)}`;
          
          messages.push({
            role: 'tool',
            content: errorMessage,
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
          });

          res.write(`data: ${JSON.stringify({
            type: 'tool_error',
            tool_name: toolCall.function.name,
            error: errorMessage,
          })}\n\n`);
        }
      }

      // Update request with new messages for next iteration
      request.messages = messages;
      functionCallCount++;

    } else {
      // No more tool calls, send final response
      if (response.content) {
        res.write(`data: ${JSON.stringify({
          type: 'content',
          content: response.content,
          isComplete: false,
        })}\n\n`);
      }
      break;
    }
  }

  if (functionCallCount >= maxFunctionCalls) {
    res.write(`data: ${JSON.stringify({
      type: 'content',
      content: '\n\n_Maximum function call limit reached._',
      isComplete: false,
    })}\n\n`);
  }
}

/**
 * Handle streaming responses without function calls
 */
async function handleStreaming(
  llmService: any,
  request: any,
  context: AgentExecutionContext,
  res: any
): Promise<void> {
  for await (const chunk of llmService.streamComplete(request, context)) {
    if (chunk.content) {
      res.write(`data: ${JSON.stringify({
        type: 'content',
        content: chunk.content,
        isComplete: chunk.isComplete,
      })}\n\n`);
    }
    
    if (chunk.isComplete) {
      break;
    }
  }
}

export { router as chatRouter };
