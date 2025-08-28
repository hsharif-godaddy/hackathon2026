import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { AgentRegistry } from '../../registry/index.js';
import { getLLMService } from '../../services/index.js';
import { globalTracer } from '../../utils/index.js';
import { applyInputGuardrails, applyOutputGuardrails, GuardrailTripwireError } from '../../utils/openai-guardrails.js';
import { AppRepository } from '../../database/index.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { getToolDefinitions, executeToolFunction } from '../../tools/index.js';
import { ConversationContextManager } from '../../services/ConversationContextManager.js';
import { MessageSegmentManager } from '../../services/MessageSegmentManager.js';
import type { AgentExecutionContext } from '../../base/index.js';

/**
 * WebSocket message types
 */
interface WSChatRequest {
  type: 'chat';
  message: string;
  appId?: string;
  conversationId?: string;
  threadId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * WebSocket message payload interfaces
 */
interface WSMetadataPayload {
  message?: string;
  agentId?: string;
  agentName?: string;
  threadId?: string;
  conversationId?: string;
  timestamp?: string;
  [key: string]: any;
}

interface WSToolPayload {
  tool_call_id: string;
  tool_name: string;
  tool_args?: string;
  tool_result?: string;
  error?: string;
  start_time: number;
  end_time?: number;
  duration_ms?: number;
  status: 'running' | 'success' | 'error';
}

interface WSCompletionPayload {
  threadId: string;
  timestamp: string;
  start_time: number;
  end_time: number;
  duration_ms: number;
  is_complete: boolean;
}

/**
 * WebSocket connection context
 */
interface WebSocketContext {
  ws: WebSocket;
  agentId: string;
  registry: AgentRegistry;
  appRepo: AppRepository;
  conversationRepo: ConversationRepository;
}

/**
 * Chat processing context
 */
interface ChatContext extends WebSocketContext {
  request: WSChatRequest;
  app?: any;
  conversation?: any;
  agent: any;
  executionContext: AgentExecutionContext;
}

/**
 * WebSocket Message Helper Functions
 */

/**
 * Send a raw WebSocket message with automatic JSON serialization
 */
function sendWSMessage(ws: WebSocket, type: string, payload: any = {}) {
  ws.send(JSON.stringify({ type, ...payload }));
}

/**
 * Send metadata message with automatic timestamp
 */
function sendMetadata(ws: WebSocket, data: Partial<WSMetadataPayload>) {
  sendWSMessage(ws, 'metadata', {
    timestamp: new Date().toISOString(),
    ...data
  });
}

/**
 * Send error message
 */
function sendError(ws: WebSocket, error: string, additionalData: any = {}) {
  sendWSMessage(ws, 'error', { error, ...additionalData });
}

/**
 * Send status message
 */
function sendStatus(ws: WebSocket, status: string, message?: string) {
  sendWSMessage(ws, 'status', { status, message });
}

/**
 * Send content message
 */
function sendContent(ws: WebSocket, content: string, isComplete: boolean) {
  sendWSMessage(ws, 'content', { content, isComplete, is_processing: !isComplete });
}

/**
 * Send tool start event
 */
function sendToolStart(ws: WebSocket, toolCall: any) {
  const payload: WSToolPayload = {
    tool_call_id: toolCall.id,
    tool_name: toolCall.function.name,
    tool_args: toolCall.function.arguments,
    start_time: Date.now(),
    status: 'running'
  };
  sendWSMessage(ws, 'tool_start', payload);
}

/**
 * Send tool completion event
 */
function sendToolComplete(ws: WebSocket, toolCall: any, result: any, startTime: number, isError = false) {
  const endTime = Date.now();
  const payload: WSToolPayload = {
    tool_call_id: toolCall.id,
    tool_name: toolCall.function.name,
    start_time: startTime,
    end_time: endTime,
    duration_ms: endTime - startTime,
    status: isError ? 'error' : 'success'
  };

  if (isError) {
    payload.error = typeof result === 'string' ? result : String(result);
  } else {
    payload.tool_result = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  sendWSMessage(ws, 'tool_complete', payload);
}

/**
 * Send completion signal with timing information
 */
function sendCompletion(ws: WebSocket, threadId: string, startTime: number) {
  const endTime = Date.now();
  const payload: WSCompletionPayload = {
    threadId,
    timestamp: new Date().toISOString(),
    start_time: startTime,
    end_time: endTime,
    duration_ms: endTime - startTime,
    is_complete: true
  };
  sendWSMessage(ws, 'complete', payload);
}

/**
 * Context-aware message helpers that automatically include context data
 */

/**
 * Send metadata with context information
 */
function sendContextMetadata(context: WebSocketContext, message: string, additionalData: any = {}) {
  sendMetadata(context.ws, {
    message,
    agentId: context.agentId,
    ...additionalData
  });
}


/**
 * Create WebSocket server and handle connections
 */
export function createWebSocketServer(server: any) {
  const wss = new WebSocketServer({ server });
  const registry = AgentRegistry.getInstance();
  const appRepo = new AppRepository();
  const conversationRepo = new ConversationRepository();

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const connectionResult = handleConnection(ws, request);
    if (!connectionResult.success || !connectionResult.agentId) {
      return; // Connection was closed
    }

    const context: WebSocketContext = {
      ws,
      agentId: connectionResult.agentId,
      registry,
      appRepo,
      conversationRepo
    };

    setupWebSocketHandlers(context);
    sendConnectionConfirmation(context);
  });

  return wss;
}

/**
 * Handle initial WebSocket connection and validate path
 */
function handleConnection(ws: WebSocket, request: IncomingMessage): { success: boolean; agentId?: string } {
  console.log('🔌 WebSocket client connected to:', request.url);
  
  try {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const pathParts = url.pathname.split('/');
    
    // Check if this is a WebSocket chat request (/ws/agentId)
    if (pathParts[1] !== 'ws') {
      console.log('❌ Invalid WebSocket path:', url.pathname);
      ws.close(1000, 'Invalid path');
      return { success: false };
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

    return { success: true, agentId };
  } catch (error) {
    console.error('Error handling WebSocket connection:', error);
    ws.close(1002, 'Connection error');
    return { success: false };
  }
}

/**
 * Setup WebSocket event handlers
 */
function setupWebSocketHandlers(context: WebSocketContext) {
  const { ws, agentId } = context;

  ws.on('message', async (data) => {
    try {
      const request: WSChatRequest = JSON.parse(data.toString());
      
      if (request.type === 'chat') {
        await handleChatMessage(context, request);
      } else {
        sendError(context.ws, `Unknown message type: ${request.type}`);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
      sendError(context.ws, 'Invalid message format');
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    globalTracer.trace({
      type: 'websocket',
      data: { event: 'disconnection', agentId },
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
}

/**
 * Send connection confirmation message
 */
function sendConnectionConfirmation(context: WebSocketContext) {
  sendContextMetadata(context, 'Connected to WebSocket chat');
}


/**
 * Ensure app is on latest commit before processing chat message
 */
async function ensureLatestCommit(appId: string | undefined): Promise<boolean> {
  if (!appId) return true; // No app ID, nothing to check
  
  // Import necessary modules
  const { GitTool } = await import('../../tools/git-tool.js');
  const { AppRepository } = await import('../../database/repositories/AppRepository.js');
  
  try {
    const appRepository = new AppRepository();
    const app = appRepository.findById(appId);
    if (!app) return false;
    
    const gitTool = new GitTool();
    
    // Get current branch info
    const branchResult = await gitTool.executeGitOperation(app.path, {
      operation: 'branch'
    });
    
    if (!branchResult.success) {
      console.warn('Could not determine current branch state, proceeding with caution');
      return true;
    }
    
    // Check if we're in detached HEAD state or not on main branch
    if (!branchResult.currentBranch || branchResult.currentBranch !== 'main') {
      console.log(`App ${appId} is not on main branch, returning to main before proceeding`);
      
      // Return to main branch
      const checkoutResult = await gitTool.executeGitOperation(app.path, {
        operation: 'checkout',
        branch: 'main'
      });
      
      if (!checkoutResult.success) {
        console.error(`Failed to return to main branch: ${checkoutResult.error}`);
        return false;
      }
      
      console.log(`Successfully returned app ${appId} to main branch`);
    }
    
    return true;
  } catch (error) {
    console.error('Error ensuring latest commit:', error);
    return true; // Proceed anyway, don't block the request
  }
}

/**
 * Handle chat message via WebSocket
 */
async function handleChatMessage(wsContext: WebSocketContext, chatRequest: WSChatRequest) {
  const startTime = Date.now();
  let conversation: any = null;
  let agentMessage: any = null;
  
  try {
    traceWebSocketEvent('chat_message', wsContext.agentId, {
      message: chatRequest.message,
      appId: chatRequest.appId,
      conversationId: chatRequest.conversationId,
      hasThreadId: !!chatRequest.threadId,
      hasUserId: !!chatRequest.userId,
    });
    
    // CRITICAL: Ensure we're on the latest commit before processing any chat messages
    // This prevents making changes on a detached HEAD state
    if (chatRequest.appId) {
      const ensureResult = await ensureLatestCommit(chatRequest.appId);
      if (!ensureResult) {
        sendError(wsContext.ws, 'Failed to ensure latest commit. Changes may not be applied correctly.');
        // Continue processing anyway - we don't want to block the conversation
      }
    }
    
    // Validate the chat request
    const validationResult = await validateChatRequest(wsContext, chatRequest);
    if (!validationResult.success) {
      return; // Error already sent
    }

    // Setup conversation context
    const conversationResult = await setupConversation(wsContext, chatRequest);
    if (!conversationResult.success) {
      return; // Error already sent
    }
    conversation = conversationResult.conversation;

    // Get agent and create execution context
    const agent = await wsContext.registry.getAgent(wsContext.agentId);
    const executionContext = createExecutionContext(chatRequest, wsContext.agentId, validationResult.app);
    
    // Apply input guardrails using OpenAI SDK
    try {
      await applyInputGuardrails(chatRequest.message, executionContext);
    } catch (error) {
      if (error instanceof GuardrailTripwireError) {
        // Send the guardrail response and end the conversation
        sendError(wsContext.ws, 'security_guardrail_triggered', error.message);
        traceWebSocketEvent('guardrail_triggered', wsContext.agentId, {
          type: 'input',
          message: chatRequest.message.substring(0, 100),
          reason: (error as any).guardrailResult?.outputInfo?.analysis?.reason || 'Security concern detected'
        });
        return;
      }
      // Log other errors but continue processing
      console.warn('Input guardrail warning:', error);
    }
    
    const chatContext: ChatContext = {
      ...wsContext,
      request: chatRequest,
      app: validationResult.app,
      conversation,
      agent,
      executionContext
    };

    // Check for special commands (currently none implemented)
    if (await handleSpecialCommands(chatContext)) {
      return; // Special command handled
    }

    // Create placeholder agent message for streaming
    if (conversation) {
      agentMessage = await wsContext.conversationRepo.addMessage(
        conversation.id,
        'agent',
        '', // Start with empty content
        { metadata: { isStreaming: true } }
      );
    }

    // Get system prompt and send initial metadata
    const systemPrompt = await agent.getSystemPrompt(executionContext);
    sendInitialMetadata(chatContext, systemPrompt);

    // Process the chat with LLM
    await processLLMChat(chatContext, systemPrompt, agentMessage);
    
    // Send completion signal
    sendCompletion(wsContext.ws, executionContext.threadId, startTime);
    
  } catch (error) {
    console.error('Chat message error:', error);
    handleChatError(wsContext.ws, error, wsContext.agentId, startTime);
  }
}

/**
 * Validate chat request and return validation result
 */
async function validateChatRequest(
  wsContext: WebSocketContext, 
  request: WSChatRequest
): Promise<{ success: boolean; app?: any }> {
  const { ws, agentId, registry, appRepo } = wsContext;

  if (!request.message) {
    sendError(ws, 'Message is required');
    return { success: false };
  }
  
  if (agentId === 'develop' && !request.appId) {
    sendError(ws, 'appId is required for develop agent');
    return { success: false };
  }
  
  let app = null;
  if (request.appId) {
    app = appRepo.findById(request.appId);
    if (!app) {
      sendError(ws, `App '${request.appId}' not found`);
      return { success: false };
    }
  }
  
  if (!registry.hasAgent(agentId)) {
    sendError(ws, `Agent '${agentId}' not found`);
    return { success: false };
  }

  return { success: true, app };
}

/**
 * Setup conversation context and persistence
 */
async function setupConversation(
  wsContext: WebSocketContext,
  request: WSChatRequest
): Promise<{ success: boolean; conversation?: any }> {
  const { ws, agentId, conversationRepo } = wsContext;

  if (!request.appId) {
    return { success: true }; // No conversation needed
  }

  let conversation: any = null;

  if (request.conversationId) {
    // Load existing conversation
    conversation = await conversationRepo.getById(request.conversationId);
    if (!conversation) {
      sendError(ws, `Conversation '${request.conversationId}' not found`);
      return { success: false };
    }
  } else {
    // Create new conversation
    const title = conversationRepo.generateTitle(request.message);
    conversation = await conversationRepo.create(request.appId, agentId, title);
    
    // Send conversation ID back to client
    sendMetadata(ws, {
      conversationId: conversation.id,
      message: 'New conversation created',
    });
  }
  
  // Save user message
  await conversationRepo.addMessage(
    conversation.id,
    'user',
    request.message
  );

  return { success: true, conversation };
}

/**
 * Create execution context for the agent
 */
function createExecutionContext(
  request: WSChatRequest, 
  agentId: string, 
  app?: any
): AgentExecutionContext {
  return {
    threadId: request.threadId || uuidv4(),
    userId: request.userId || undefined,
    metadata: { 
      agentId,
      appId: request.appId,
      templateVersion: app?.templateVersion,
      ...request.metadata 
    },
    timestamp: new Date(),
  };
}
/**
 * Handle special commands (placeholder for future extensions)
 */
async function handleSpecialCommands(context: ChatContext): Promise<boolean> {
  // No special commands currently implemented
  return false;
}

/**
 * Send initial metadata to client
 */
function sendInitialMetadata(context: ChatContext, systemPrompt: string) {
  const { ws, agentId, agent, executionContext } = context;
  
  traceDebug('System prompt loaded', agentId, executionContext.threadId, {
    promptLength: systemPrompt.length,
  });
  
  sendMetadata(ws, {
    threadId: executionContext.threadId,
    agentId,
    agentName: agent.getConfig().name,
    timestamp: executionContext.timestamp.toISOString(),
  });
}

/**
 * Process chat with LLM service
 */
async function processLLMChat(context: ChatContext, systemPrompt: string, agentMessage: any) {
  const { agent, request, executionContext, conversation, conversationRepo } = context;
  
  try {
    // Use ConversationContextManager to build messages with history
    const contextManager = new ConversationContextManager(conversationRepo, 5);
    const aiEditContext = executionContext.metadata?.aiEditContext;
    const messages = await contextManager.buildMessages(
      systemPrompt,
      request.message,
      conversation?.id,
      aiEditContext,
      executionContext
    );
    
    // Validate messages for Bedrock compatibility
    const validationErrors = validateMessagesForBedrock(messages);
    if (validationErrors.length > 0) {
      console.warn('Bedrock validation errors in conversation context:', validationErrors);
      // Try to fix the messages
      const fixedMessages = fixBedrockValidationIssues(messages);
      console.log(`Fixed ${messages.length - fixedMessages.length} problematic messages`);
      messages.splice(0, messages.length, ...fixedMessages);
    }
    
    traceDebug('Starting LLM processing', context.agentId, executionContext.threadId, {
      messageCount: messages.length,
      hasHistory: !!conversation?.id,
      conversationId: conversation?.id,
    });
    
    const tools = agent.getTools().length > 0 ? getToolDefinitions() : undefined;
    const model = agent.getConfig().model;
    
    const llmRequest = { messages, tools, model };
    
    if (tools) {
      await handleLLMWithFunctionCalls(context, llmRequest, agentMessage);
    } else {
      await handleLLMStreaming(context, llmRequest, agentMessage);
    }
    
  } catch (error) {
    traceError('LLM processing error', context.agentId, executionContext.threadId, error);
    
    sendContent(context.ws, `I apologize, but I encountered an error processing your request: ${error instanceof Error ? error.message : 'Unknown error'}`, false);
  }
}


/**
 * Handle chat errors
 */
function handleChatError(ws: WebSocket, error: any, agentId: string, startTime?: number) {
  globalTracer.trace({
    type: 'error',
    data: {
      event: 'websocket_chat_error',
      agentId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
  
  const errorEndTime = Date.now();
  const errorResponse: any = {
    type: 'error',
    error: error instanceof Error ? error.message : 'Unknown error',
  };
  
  if (startTime) {
    errorResponse.duration_ms = errorEndTime - startTime;
    errorResponse.start_time = startTime;
    errorResponse.end_time = errorEndTime;
  }
  
  sendWSMessage(ws, 'error', errorResponse);
}

/**
 * Utility functions for tracing
 */
function traceWebSocketEvent(event: string, agentId: string, data: any) {
  globalTracer.trace({ type: 'websocket', data: { event, agentId, ...data } });
}

function traceDebug(message: string, agentId: string, threadId: string, data?: any) {
  globalTracer.trace({ type: 'debug', agentId, threadId, data: { message, ...data } });
}

function traceError(message: string, agentId: string, threadId: string, error: any) {
  globalTracer.trace({
    type: 'error',
    agentId,
    threadId,
    data: {
      message,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
}

/**
 * Handle LLM responses with function calling support
 */
async function handleLLMWithFunctionCalls(
  context: ChatContext,
  llmRequest: any,
  agentMessage: any
): Promise<void> {
  const llmService = getLLMService();
  const messages = [...llmRequest.messages];
  let functionCallCount = 0;
  const maxFunctionCalls = 50;
  
  // Use MessageSegmentManager to track chronological order
  const segmentManager = new MessageSegmentManager(context.conversationRepo);

  while (functionCallCount < maxFunctionCalls) {
    // Validate messages before each LLM call
    const validationErrors = validateMessagesForBedrock(messages);
    if (validationErrors.length > 0) {
      console.warn(`Bedrock validation errors before LLM call ${functionCallCount}:`, validationErrors);
      const fixedMessages = fixBedrockValidationIssues(messages);
      messages.splice(0, messages.length, ...fixedMessages);
    }

    const response = await llmService.complete({ ...llmRequest, messages }, context.executionContext);

    if (response.tool_calls && response.tool_calls.length > 0) {
      // Send assistant reasoning if present
      if (response.content) {
        segmentManager.addContentSegment(response.content + '\n\n');
        sendContent(context.ws, response.content + '\n\n', false);
      }

      // Add assistant message to conversation history
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      });

      // Execute each tool call
      for (const toolCall of response.tool_calls) {
        const toolResult = await executeToolCallWithSegments(context, toolCall, segmentManager);
        messages.push(toolResult.message);
      }

      functionCallCount++;
    } else {
      // No more tool calls, send final response
      if (response.content) {
        segmentManager.addContentSegment(response.content);
        sendContent(context.ws, response.content, false);
      }
      break;
    }
  }

  // Handle max function calls reached
  if (functionCallCount >= maxFunctionCalls) {
    const maxReachedMsg = '\n\n_Maximum function call limit reached._';
    segmentManager.addContentSegment(maxReachedMsg);
    sendContent(context.ws, maxReachedMsg, false);
  }
  
  // Save segments to database
  if (agentMessage) {
    await segmentManager.saveToMessage(agentMessage.id);
  }
}

/**
 * Execute a single tool call with segment tracking
 */
async function executeToolCallWithSegments(
  context: ChatContext,
  toolCall: any,
  segmentManager: MessageSegmentManager
): Promise<{ message: any }> {
  const { ws, executionContext } = context;
  const toolStartTime = Date.now();
  
  // Create initial tool call record
  const toolCallRecord = {
    id: toolCall.id,
    tool_name: toolCall.function.name,
    tool_args: JSON.parse(toolCall.function.arguments),
    start_time: toolStartTime,
    status: 'running' as const
  };
  
  // Add tool call segment immediately
  const toolSegment = segmentManager.addToolCallSegment(toolCallRecord);
  
  // Send tool start event
  sendToolStart(ws, toolCall);

  try {
    const args = JSON.parse(toolCall.function.arguments);
    const result = await executeToolFunction(toolCall.function.name, args, executionContext);
    const toolEndTime = Date.now();
    const duration = toolEndTime - toolStartTime;
    
    // Update the tool call segment with results
    const updatedToolCall = {
      ...toolCallRecord,
      tool_result: result,
      end_time: toolEndTime,
      duration_ms: duration,
      status: 'success' as const
    };
    
    segmentManager.updateToolCallSegment(toolSegment.id, updatedToolCall);
    
    // Send tool completion event
    sendToolComplete(ws, toolCall, result, toolStartTime);

    return {
      message: {
        role: 'tool',
        content: typeof result === 'string' ? result : JSON.stringify(result),
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
      }
    };
  } catch (error) {
    const toolEndTime = Date.now();
    const duration = toolEndTime - toolStartTime;
    const errorMessage = `Error executing ${toolCall.function.name}: ${error instanceof Error ? error.message : String(error)}`;
    
    // Update tool call segment with error
    const errorToolCall = {
      ...toolCallRecord,
      error: errorMessage,
      end_time: toolEndTime,
      duration_ms: duration,
      status: 'error' as const
    };
    
    segmentManager.updateToolCallSegment(toolSegment.id, errorToolCall);
    
    // Send tool error event
    sendToolComplete(ws, toolCall, errorMessage, toolStartTime, true);

    return {
      message: {
        role: 'tool',
        content: errorMessage,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
      }
    };
  }
}

/**
 * Execute a single tool call and return the result
 */
async function executeToolCall(
  context: ChatContext,
  toolCall: any,
  toolCalls: any[]
): Promise<{ message: any }> {
  const { ws, executionContext } = context;
  const toolStartTime = Date.now();
  
  // Track tool call for database
  const toolCallRecord = {
    id: toolCall.id,
    tool_name: toolCall.function.name,
    tool_args: JSON.parse(toolCall.function.arguments),
    start_time: toolStartTime,
    status: 'running'
  };
  toolCalls.push(toolCallRecord);
  
  // Send tool start event
  sendToolStart(ws, toolCall);

  try {
    const args = JSON.parse(toolCall.function.arguments);
    const result = await executeToolFunction(toolCall.function.name, args, executionContext);
    const toolEndTime = Date.now();
    const duration = toolEndTime - toolStartTime;
    
    // Update tool call record
    const toolIndex = toolCalls.findIndex(tc => tc.id === toolCall.id);
    if (toolIndex >= 0) {
      toolCalls[toolIndex] = {
        ...toolCalls[toolIndex],
        tool_result: result,
        end_time: toolEndTime,
        duration_ms: duration,
        status: 'success'
      };
    }
    
    // Send tool completion event
    sendToolComplete(ws, toolCall, result, toolStartTime);

    return {
      message: {
        role: 'tool',
        content: typeof result === 'string' ? result : JSON.stringify(result),
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
      }
    };
  } catch (error) {
    const toolEndTime = Date.now();
    const duration = toolEndTime - toolStartTime;
    const errorMessage = `Error executing ${toolCall.function.name}: ${error instanceof Error ? error.message : String(error)}`;
    
    // Update tool call record with error
    const toolIndex = toolCalls.findIndex(tc => tc.id === toolCall.id);
    if (toolIndex >= 0) {
      toolCalls[toolIndex] = {
        ...toolCalls[toolIndex],
        error: errorMessage,
        end_time: toolEndTime,
        duration_ms: duration,
        status: 'error'
      };
    }
    
    // Send tool error event
    sendToolComplete(ws, toolCall, errorMessage, toolStartTime, true);

    return {
      message: {
        role: 'tool',
        content: errorMessage,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
      }
    };
  }
}

/**
 * Handle streaming responses without function calls
 */
async function handleLLMStreaming(
  context: ChatContext,
  llmRequest: any,
  agentMessage: any
): Promise<void> {
  const llmService = getLLMService();
  const segmentManager = new MessageSegmentManager(context.conversationRepo);
  let accumulatedChunk = '';
  
  for await (const chunk of llmService.streamComplete(llmRequest, context.executionContext)) {
    if (chunk.content) {
      accumulatedChunk += chunk.content;
      
      // Apply output guardrails to chunk content
      let sanitizedContent = chunk.content;
      try {
        sanitizedContent = await applyOutputGuardrails(chunk.content, context.executionContext);
      } catch (error) {
        console.warn('Output guardrail warning for chunk:', error);
        // Use original content if guardrails fail
      }
      
      sendContent(context.ws, sanitizedContent, chunk.isComplete);
      
      // Add content in reasonable chunks (every ~100 chars or on completion)
      if (chunk.isComplete || accumulatedChunk.length >= 100) {
        segmentManager.addContentSegment(accumulatedChunk);
        accumulatedChunk = '';
        
        // Save to database periodically
        if (agentMessage) {
          await segmentManager.saveToMessage(agentMessage.id);
        }
      }
    }
    
    if (chunk.isComplete) {
      // Add any remaining content
      if (accumulatedChunk) {
        // Apply final output guardrails to accumulated content
        try {
          const sanitizedAccumulated = await applyOutputGuardrails(accumulatedChunk, context.executionContext);
          segmentManager.addContentSegment(sanitizedAccumulated);
        } catch (error) {
          console.warn('Output guardrail warning for accumulated content:', error);
          segmentManager.addContentSegment(accumulatedChunk);
        }
      }
      
      // Final save
      if (agentMessage) {
        await segmentManager.saveToMessage(agentMessage.id);
      }
      break;
    }
  }
}


/**
 * Update agent message in database
 */
async function updateAgentMessage(
  context: ChatContext,
  agentMessage: any,
  content: string,
  toolCalls: any[] = [],
  isStreaming = false
) {
  if (!agentMessage) return;
  
  try {
    await context.conversationRepo.updateMessage(agentMessage.id, {
      content,
      ...(toolCalls.length > 0 && { toolCalls }),
      metadata: { isStreaming }
    });
  } catch (error) {
    console.warn('Failed to update message in database:', error);
  }
}

/**
 * Validate messages array for Bedrock compatibility
 * Returns array of validation errors
 */
function validateMessagesForBedrock(messages: any[]): string[] {
  const errors: string[] = [];
  const pendingToolCalls = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    if (msg.role === 'assistant' && msg.tool_calls) {
      // Assistant message with tool calls - track expected tool results
      for (const toolCall of msg.tool_calls) {
        pendingToolCalls.add(toolCall.id);
      }
    } else if (msg.role === 'tool') {
      // Tool result message - should match a pending tool call
      if (!pendingToolCalls.has(msg.tool_call_id)) {
        errors.push(`Tool result at index ${i} has unexpected tool_call_id: ${msg.tool_call_id}`);
      } else {
        pendingToolCalls.delete(msg.tool_call_id);
      }
    }
  }

  // Check for any unmatched tool calls
  if (pendingToolCalls.size > 0) {
    errors.push(`Unmatched tool calls: ${Array.from(pendingToolCalls).join(', ')}`);
  }

  return errors;
}

/**
 * Fix Bedrock validation issues by removing assistant messages with unmatched tool calls
 */
function fixBedrockValidationIssues(messages: any[]): any[] {
  const fixedMessages: any[] = [];
  const pendingToolCalls = new Set<string>();
  const toolResults = new Set<string>();

  // First pass: collect all tool results
  for (const msg of messages) {
    if (msg.role === 'tool') {
      toolResults.add(msg.tool_call_id);
    }
  }

  // Second pass: filter out problematic messages
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      // Only include assistant messages where all tool calls have results
      const validToolCalls = msg.tool_calls.filter((tc: any) => toolResults.has(tc.id));
      
      if (validToolCalls.length > 0) {
        // Include assistant message with only valid tool calls
        fixedMessages.push({
          ...msg,
          tool_calls: validToolCalls
        });
        
        // Track these as pending
        for (const toolCall of validToolCalls) {
          pendingToolCalls.add(toolCall.id);
        }
      } else if (msg.content && msg.content.trim()) {
        // Include assistant message without tool calls if it has content
        const { tool_calls, ...msgWithoutToolCalls } = msg;
        fixedMessages.push(msgWithoutToolCalls);
      }
    } else if (msg.role === 'tool') {
      // Include tool result if we have a pending tool call for it
      if (pendingToolCalls.has(msg.tool_call_id)) {
        fixedMessages.push(msg);
        pendingToolCalls.delete(msg.tool_call_id);
      }
    } else {
      // Include all other message types (system, user)
      fixedMessages.push(msg);
    }
  }

  return fixedMessages;
}
