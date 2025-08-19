import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { AgentRegistry } from '../../registry/index.js';
import { getLLMService } from '../../services/index.js';
import { globalTracer } from '../../utils/index.js';
import { AppRepository } from '../../database/index.js';
import { getToolDefinitions, executeToolFunction } from '../../tools/index.js';
import type { AgentExecutionContext } from '../../base/index.js';
import { FakeEventsAgent } from '../../agents/index.js';

const registry = AgentRegistry.getInstance();
const appRepo = new AppRepository();

/**
 * WebSocket message types
 */
interface WSChatRequest {
  type: 'chat';
  message: string;
  appId?: string;
  threadId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

interface WSMessage {
  type: 'metadata' | 'status' | 'content' | 'tool_start' | 'tool_complete' | 'tool_result' | 'tool_error' | 'complete' | 'error';
  [key: string]: any;
}

/**
 * Create WebSocket server and handle connections
 */
export function createWebSocketServer(server: any) {
  const wss = new WebSocketServer({ 
    server,
    // Don't specify a path - handle all WebSocket connections
  });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    console.log('🔌 WebSocket client connected to:', request.url);
    
    // Parse agent ID from URL path
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const pathParts = url.pathname.split('/');
    
    // Check if this is a WebSocket chat request (/ws/agentId)
    if (pathParts[1] !== 'ws') {
      console.log('❌ Invalid WebSocket path:', url.pathname);
      ws.close(1000, 'Invalid path');
      return;
    }
    
    const agentId = pathParts[2] || 'develop';

    globalTracer.trace({
      type: 'websocket',
      data: {
        event: 'connection',
        agentId,
        clientIP: request.socket.remoteAddress,
      },
    });

    ws.on('message', async (data) => {
      try {
        const request: WSChatRequest = JSON.parse(data.toString());
        
        if (request.type === 'chat') {
          await handleChatMessage(ws, agentId, request);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            error: `Unknown message type: ${request.type}`,
          }));
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format',
        }));
      }
    });

    ws.on('close', () => {
      console.log('🔌 WebSocket client disconnected');
      globalTracer.trace({
        type: 'websocket',
        data: {
          event: 'disconnection',
          agentId,
        },
      });
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      globalTracer.trace({
        type: 'error',
        data: {
          event: 'websocket_error',
          agentId,
          error: error.message,
        },
      });
    });

    // Send initial connection confirmation
    ws.send(JSON.stringify({
      type: 'metadata',
      message: 'Connected to WebSocket chat',
      agentId,
      timestamp: new Date().toISOString(),
    }));
  });

  return wss;
}

/**
 * Handle chat message via WebSocket
 */
async function handleChatMessage(ws: WebSocket, agentId: string, chatRequest: WSChatRequest) {
  // Track start time for duration calculation
  let agentStartTime: number | undefined;
  
  try {
    globalTracer.trace({
      type: 'websocket',
      data: {
        event: 'chat_message',
        agentId,
        message: chatRequest.message,
        appId: chatRequest.appId,
        hasThreadId: !!chatRequest.threadId,
        hasUserId: !!chatRequest.userId,
      },
    });
    
    // Validate request
    if (!chatRequest.message) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Message is required',
      }));
      return;
    }
    
    // Require appId for develop agent
    if (agentId === 'develop' && !chatRequest.appId) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'appId is required for develop agent',
      }));
      return;
    }
    
    // Validate appId exists if provided
    if (chatRequest.appId) {
      const app = appRepo.findById(chatRequest.appId);
      if (!app) {
        ws.send(JSON.stringify({
          type: 'error',
          error: `App '${chatRequest.appId}' not found`,
        }));
        return;
      }
    }
    
    if (!registry.hasAgent(agentId)) {
      ws.send(JSON.stringify({
        type: 'error',
        error: `Agent '${agentId}' not found`,
      }));
      return;
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
        message: 'WebSocket execution context created',
        context,
      },
    });
    
    // Get system prompt (validate everything before starting)
    const systemPrompt = await agent.getSystemPrompt(context);
    
    globalTracer.trace({
      type: 'debug',
      agentId,
      threadId: context.threadId,
      data: {
        message: 'System prompt loaded for WebSocket',
        promptLength: systemPrompt.length,
      },
    });
    
    // Send initial metadata
    ws.send(JSON.stringify({
      type: 'metadata',
      threadId: context.threadId,
      agentId,
      agentName: agent.getConfig().name,
      timestamp: context.timestamp.toISOString(),
    }));
      
    // Check for special fake events trigger
    if (agentId === 'fake-events' && chatRequest.message.trim() === 'FAKE-EVENTS') {
      globalTracer.trace({
        type: 'debug',
        agentId,
        threadId: context.threadId,
        data: {
          message: 'Fake events trigger detected via WebSocket, bypassing LLM',
        },
      });

      // Send initial status for fake events
      ws.send(JSON.stringify({
        type: 'status',
        status: 'generating_fake_events',
        message: 'Generating fake events for WebSocket debugging...',
      }));

      try {
        // Cast the agent to FakeEventsAgent and call the fake events generator
        if (agent instanceof FakeEventsAgent) {
          await agent.generateFakeEventsWS(ws, context);
        } else {
          throw new Error('Agent is not a FakeEventsAgent instance');
        }
      } catch (fakeError) {
        globalTracer.trace({
          type: 'error',
          agentId,
          threadId: context.threadId,
          data: {
            message: 'Fake events generation error via WebSocket',
            error: fakeError instanceof Error ? fakeError.message : String(fakeError),
          },
        });

        ws.send(JSON.stringify({
          type: 'content',
          content: `Error generating fake events: ${fakeError instanceof Error ? fakeError.message : 'Unknown error'}`,
          isComplete: false,
        }));
      }

      // Send completion signal
      ws.send(JSON.stringify({
        type: 'complete',
        threadId: context.threadId,
        timestamp: new Date().toISOString(),
      }));
      
      globalTracer.trace({
        type: 'websocket',
        agentId,
        threadId: context.threadId,
        data: {
          message: 'Fake events WebSocket response completed',
        },
      });
      
      return; // Exit early, don't continue with normal LLM processing
    }
    
    // Set start time for duration calculation
    agentStartTime = Date.now();
    
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
          message: 'Starting LLM processing via WebSocket',
          messageCount: messages.length,
        },
      });
      
      // Get tool definitions if the agent has tools
      const tools = agent.getTools().length > 0 ? getToolDefinitions() : undefined;
      
      // Get the agent's model configuration
      const agentConfig = agent.getConfig();
      const model = agentConfig.model;
      
      globalTracer.trace({
        type: 'debug',
        agentId,
        threadId: context.threadId,
        data: {
          message: 'Using model configuration for WebSocket',
          agentModel: model,
          agentId,
        },
      });
      
      // Use non-streaming for function calls, streaming for regular responses
      if (tools) {
        await handleWithFunctionCallsWS(llmService, { messages, tools, model }, context, agent, ws);
      } else {
        await handleStreamingWS(llmService, { messages, model }, context, ws);
      }
      
    } catch (llmError) {
      globalTracer.trace({
        type: 'error',
        agentId,
        threadId: context.threadId,
        data: {
          message: 'LLM error occurred via WebSocket',
          error: llmError instanceof Error ? llmError.message : String(llmError),
          stack: llmError instanceof Error ? llmError.stack : undefined,
        },
      });
      
      // Send error message to client
      ws.send(JSON.stringify({
        type: 'content',
        content: `I apologize, but I encountered an error processing your request: ${llmError instanceof Error ? llmError.message : 'Unknown error'}`,
        isComplete: false,
      }));
    }
    
    // Send completion signal with duration
    const agentEndTime = Date.now();
    const totalDuration = agentEndTime - agentStartTime;
    
    ws.send(JSON.stringify({
      type: 'complete',
      threadId: context.threadId,
      timestamp: new Date().toISOString(),
      start_time: agentStartTime,
      end_time: agentEndTime,
      duration_ms: totalDuration,
    }));
    
    globalTracer.trace({
      type: 'websocket',
      agentId,
      threadId: context.threadId,
      data: {
        message: 'WebSocket streaming response completed',
      },
    });
    
  } catch (error) {
    globalTracer.trace({
      type: 'error',
      data: {
        event: 'websocket_chat_error',
        agentId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    
    // Send error through WebSocket with duration if available
    const errorEndTime = Date.now();
    const errorResponse: any = {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    
    // Include duration if agentStartTime was set
    if (agentStartTime) {
      errorResponse.duration_ms = errorEndTime - agentStartTime;
      errorResponse.start_time = agentStartTime;
      errorResponse.end_time = errorEndTime;
    }
    
    ws.send(JSON.stringify(errorResponse));
  }
}

/**
 * Handle LLM responses with function calling support via WebSocket
 */
async function handleWithFunctionCallsWS(
  llmService: any,
  request: any,
  context: AgentExecutionContext,
  agent: any,
  ws: WebSocket
): Promise<void> {
  const messages = [...request.messages];
  let functionCallCount = 0;
  const maxFunctionCalls = 50; // Prevent infinite loops

  while (functionCallCount < maxFunctionCalls) {
    const response = await llmService.complete(request, context);

    if (response.tool_calls && response.tool_calls.length > 0) {
      // Send assistant content if present (LLM's reasoning/context)
      if (response.content) {
        ws.send(JSON.stringify({
          type: 'content',
          content: response.content + '\n\n',
          isComplete: false,
        }));
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      });

      // Execute each tool call
      for (const toolCall of response.tool_calls) {
        const toolStartTime = Date.now();
        
        // Send tool start event
        ws.send(JSON.stringify({
          type: 'tool_start',
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name,
          tool_args: toolCall.function.arguments,
          start_time: toolStartTime,
        }));

        try {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeToolFunction(toolCall.function.name, args, context);
          const toolEndTime = Date.now();
          const duration = toolEndTime - toolStartTime;
          
          // Add tool result to messages
          messages.push({
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
          });

          // Send tool complete event with result and timing
          ws.send(JSON.stringify({
            type: 'tool_complete',
            tool_call_id: toolCall.id,
            tool_name: toolCall.function.name,
            tool_result: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            start_time: toolStartTime,
            end_time: toolEndTime,
            duration_ms: duration,
            status: 'success',
          }));

        } catch (error) {
          const toolEndTime = Date.now();
          const duration = toolEndTime - toolStartTime;
          const errorMessage = `Error executing ${toolCall.function.name}: ${error instanceof Error ? error.message : String(error)}`;
          
          messages.push({
            role: 'tool',
            content: errorMessage,
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
          });

          // Send tool complete event with error and timing
          ws.send(JSON.stringify({
            type: 'tool_complete',
            tool_call_id: toolCall.id,
            tool_name: toolCall.function.name,
            error: errorMessage,
            start_time: toolStartTime,
            end_time: toolEndTime,
            duration_ms: duration,
            status: 'error',
          }));
        }
      }

      // Update request with new messages for next iteration
      request.messages = messages;
      functionCallCount++;

    } else {
      // No more tool calls, send final response
      if (response.content) {
        ws.send(JSON.stringify({
          type: 'content',
          content: response.content,
          isComplete: false,
        }));
      }
      break;
    }
  }

  if (functionCallCount >= maxFunctionCalls) {
    ws.send(JSON.stringify({
      type: 'content',
      content: '\n\n_Maximum function call limit reached._',
      isComplete: false,
    }));
  }
}

/**
 * Handle streaming responses without function calls via WebSocket
 */
async function handleStreamingWS(
  llmService: any,
  request: any,
  context: AgentExecutionContext,
  ws: WebSocket
): Promise<void> {
  for await (const chunk of llmService.streamComplete(request, context)) {
    if (chunk.content) {
      ws.send(JSON.stringify({
        type: 'content',
        content: chunk.content,
        isComplete: chunk.isComplete,
      }));
    }
    
    if (chunk.isComplete) {
      break;
    }
  }
}
