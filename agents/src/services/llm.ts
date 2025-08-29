import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { globalTracer } from '../utils/tracing.js';
import type { AgentExecutionContext } from '../base/index.js';
import { TokenUsageRepository } from '../database/index.js';
import { logger } from '../logging/index.js';
import { llmEvents } from '../logging/events/index.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface LLMRequest {
  messages: ChatCompletionMessageParam[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
}

export interface LLMResponse {
  id: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | undefined;
  model: string;
  finishReason: string;
}

export class LLMService {
  private openai: OpenAI;
  private defaultModel: string;
  private tokenUsageRepo: TokenUsageRepository;

  constructor(apiKey?: string, defaultModel = 'claude-sonnet-4-20250514') {
    const key = apiKey || process.env.OPENAI_API_KEY;
    
    if (!key) {
      throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
    }

    this.openai = new OpenAI({ apiKey: key });
    this.defaultModel = defaultModel;
    this.tokenUsageRepo = new TokenUsageRepository();

    globalTracer.trace({
      type: 'debug',
      data: {
        message: 'LLMService initialized',
        defaultModel: this.defaultModel,
        hasApiKey: !!key,
      },
    });
  }

  async complete(
    request: LLMRequest,
    context?: AgentExecutionContext
  ): Promise<LLMResponse> {
    const startTime = process.hrtime.bigint();
    const model = request.model || this.defaultModel;

    // Log LLM request with structured logging (info level - metadata only)
    const requestData: any = {
      model,
      messageCount: request.messages.length,
      streaming: false,
      hasTools: !!request.tools
    };
    
    if (context?.metadata?.agentId) requestData.agentId = context.metadata.agentId;
    if (context?.threadId) requestData.threadId = context.threadId;
    if (request.temperature !== undefined) requestData.temperature = request.temperature;
    if (request.maxTokens !== undefined) requestData.maxTokens = request.maxTokens;
    
    llmEvents.request(logger, requestData);
    
    // Log full messages at debug level
    if (request.messages && request.messages.length > 0) {
      const debugData: any = {
        model,
        messageCount: request.messages.length,
        messages: request.messages
      };
      
      if (context?.metadata?.agentId) debugData.agentId = context.metadata.agentId;
      if (context?.threadId) debugData.threadId = context.threadId;
      
      logger.debug('llm.request.messages', debugData);
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.5,
        max_tokens: request.maxTokens ?? 16000,
        stream: false,
        ...(request.tools ? { tools: request.tools } : {}),
      });

      const toolCalls = completion.choices[0]?.message?.tool_calls?.filter(tc => tc.type === 'function').map(tc => ({
        id: tc.id,
        type: tc.type as 'function',
        function: {
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        },
      }));

      const response: LLMResponse = {
        id: completion.id,
        content: completion.choices[0]?.message?.content || null,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        usage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        } : undefined,
        model: completion.model,
        finishReason: completion.choices[0]?.finish_reason || 'unknown',
      };

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to milliseconds

      // Log LLM response with structured logging
      const responseData: any = {
        model: response.model,
        messageCount: request.messages.length,
        contentLength: response.content?.length || 0,
        finishReason: response.finishReason,
        duration,
        streaming: false,
        hasTools: !!request.tools
      };
      
      if (response.id) responseData.responseId = response.id;
      if (context?.metadata?.agentId) responseData.agentId = context.metadata.agentId;
      if (context?.threadId) responseData.threadId = context.threadId;
      if (response.usage) responseData.usage = response.usage;
      
      llmEvents.response(logger, responseData);

      // Track token usage in database
      if (response.usage && context?.metadata?.appId) {
        try {
          await this.tokenUsageRepo.recordUsage(
            context.metadata.appId as string,
            'llm_request',
            response.usage.promptTokens,
            response.usage.completionTokens,
            {
              model: response.model,
              conversationId: context.metadata?.conversationId as string,
              description: `LLM request - ${request.messages.length} messages`
            }
          );
        } catch (tokenError) {
          llmEvents.tokenUsageFailure(logger, tokenError as Error, {
            appId: context.metadata.appId as string,
            operation: 'record_usage',
            tokenType: 'llm_request'
          });
        }
      }

      return response;

    } catch (error) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to milliseconds

      // Log LLM error with structured logging
      const errorData: any = { model, duration };
      if (context?.metadata?.agentId) errorData.agentId = context.metadata.agentId;
      if (context?.threadId) errorData.threadId = context.threadId;
      
      llmEvents.error(logger, error as Error, errorData);

      throw error;
    }
  }

  async *streamComplete(
    request: LLMRequest,
    context?: AgentExecutionContext
  ): AsyncGenerator<{ content: string; isComplete: boolean }, void, unknown> {
    const startTime = process.hrtime.bigint();
    const model = request.model || this.defaultModel;

    // Log streaming LLM request with structured logging (info level - metadata only)
    const streamRequestData: any = {
      model,
      messageCount: request.messages.length,
      streaming: true,
      hasTools: !!request.tools
    };
    
    if (context?.metadata?.agentId) streamRequestData.agentId = context.metadata.agentId;
    if (context?.threadId) streamRequestData.threadId = context.threadId;
    if (request.temperature !== undefined) streamRequestData.temperature = request.temperature;
    if (request.maxTokens !== undefined) streamRequestData.maxTokens = request.maxTokens;
    
    llmEvents.request(logger, streamRequestData);
    
    // Log full messages at debug level
    if (request.messages && request.messages.length > 0) {
      const streamDebugData: any = {
        model,
        messageCount: request.messages.length,
        streaming: true,
        messages: request.messages
      };
      
      if (context?.metadata?.agentId) streamDebugData.agentId = context.metadata.agentId;
      if (context?.threadId) streamDebugData.threadId = context.threadId;
      
      logger.debug('llm.request.messages', streamDebugData);
    }

    try {
      const stream = await this.openai.chat.completions.create({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 2000,
        stream: true,
        ...(request.tools ? { tools: request.tools } : {}),
      });

      let fullContent = '';
      let chunkCount = 0;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        
        if (content) {
          fullContent += content;
          chunkCount++;

          // Only log first and last chunks to reduce noise
          if (chunkCount === 1) {
            globalTracer.trace({
              type: 'debug',
              agentId: context?.metadata?.agentId as string | undefined,
              threadId: context?.threadId,
              data: {
                message: 'First chunk received',
                chunkNumber: chunkCount,
                chunkContent: content,
                totalContentLength: fullContent.length,
              },
            });
          }

          yield { content, isComplete: false };
        }

        if (chunk.choices[0]?.finish_reason) {
          // Log the last chunk before finishing
          if (chunkCount > 1) {
            globalTracer.trace({
              type: 'debug',
              agentId: context?.metadata?.agentId as string | undefined,
              threadId: context?.threadId,
              data: {
                message: 'Last chunk received',
                chunkNumber: chunkCount,
                finalContent: content,
                totalContentLength: fullContent.length,
              },
            });
          }
          const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to milliseconds

          // Log streaming LLM response with structured logging
          const streamResponseData: any = {
            model,
            messageCount: request.messages.length,
            contentLength: fullContent.length,
            chunkCount,
            finishReason: chunk.choices[0].finish_reason,
            duration,
            streaming: true,
            hasTools: !!request.tools
          };
          
          if (context?.metadata?.agentId) streamResponseData.agentId = context.metadata.agentId;
          if (context?.threadId) streamResponseData.threadId = context.threadId;
          
          llmEvents.response(logger, streamResponseData);

          // Track token usage for streaming (approximate based on content length)
          if (context?.metadata?.appId) {
            try {
              // Estimate tokens: roughly 1 token per 4 characters
              const estimatedTokens = Math.ceil(fullContent.length / 4);
              const promptTokens = Math.ceil(request.messages.join(' ').length / 4);
              
              await this.tokenUsageRepo.recordUsage(
                context.metadata.appId as string,
                'llm_request',
                promptTokens,
                estimatedTokens,
                {
                  model,
                  conversationId: context.metadata?.conversationId as string,
                  description: `Streaming LLM request - ${chunkCount} chunks`
                }
              );
            } catch (tokenError) {
              llmEvents.tokenUsageFailure(logger, tokenError as Error, {
                appId: context.metadata.appId as string,
                operation: 'record_streaming_usage',
                tokenType: 'llm_request'
              });
            }
          }

          yield { content: '', isComplete: true };
          return;
        }
      }

    } catch (error) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to milliseconds

      // Log streaming LLM error with structured logging
      const streamErrorData: any = { model, duration };
      if (context?.metadata?.agentId) streamErrorData.agentId = context.metadata.agentId;
      if (context?.threadId) streamErrorData.threadId = context.threadId;
      
      llmEvents.error(logger, error as Error, streamErrorData);

      throw error;
    }
  }
}

// Global LLM service instance
let llmService: LLMService | null = null;

export function getLLMService(): LLMService {
  if (!llmService) {
    llmService = new LLMService();
  }
  return llmService;
}
