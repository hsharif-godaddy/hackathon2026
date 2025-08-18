import OpenAI from 'openai';
import { globalTracer } from '../utils/tracing.js';
import type { AgentExecutionContext } from '../base/index.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LLMResponse {
  id: string;
  content: string;
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

  constructor(apiKey?: string, defaultModel = 'gpt-4') {
    const key = apiKey || process.env.OPENAI_API_KEY;
    
    if (!key) {
      throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
    }

    this.openai = new OpenAI({ apiKey: key });
    this.defaultModel = defaultModel;

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

    globalTracer.trace({
      type: 'request',
      agentId: context?.metadata?.agentId as string | undefined,
      threadId: context?.threadId,
      data: {
        model,
        messageCount: request.messages.length,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        messages: request.messages,
      },
    });

    try {
      const completion = await this.openai.chat.completions.create({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 2000,
        stream: false,
      });

      const response: LLMResponse = {
        id: completion.id,
        content: completion.choices[0]?.message?.content || '',
        usage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        } : undefined,
        model: completion.model,
        finishReason: completion.choices[0]?.finish_reason || 'unknown',
      };

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to milliseconds

      globalTracer.trace({
        type: 'response',
        agentId: context?.metadata?.agentId as string,
        threadId: context?.threadId,
        data: {
          responseId: response.id,
          contentLength: response.content.length,
          usage: response.usage,
          finishReason: response.finishReason,
          duration,
          model: response.model,
        },
      });

      return response;

    } catch (error) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to milliseconds

      globalTracer.trace({
        type: 'error',
        agentId: context?.metadata?.agentId as string,
        threadId: context?.threadId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          duration,
          model,
          stack: error instanceof Error ? error.stack : undefined,
        },
      });

      throw error;
    }
  }

  async *streamComplete(
    request: LLMRequest,
    context?: AgentExecutionContext
  ): AsyncGenerator<{ content: string; isComplete: boolean }, void, unknown> {
    const startTime = process.hrtime.bigint();
    const model = request.model || this.defaultModel;

    globalTracer.trace({
      type: 'request',
      agentId: context?.metadata?.agentId as string | undefined,
      threadId: context?.threadId,
      data: {
        model,
        messageCount: request.messages.length,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        streaming: true,
        messages: request.messages,
      },
    });

    try {
      const stream = await this.openai.chat.completions.create({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 2000,
        stream: true,
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

          globalTracer.trace({
            type: 'response',
            agentId: context?.metadata?.agentId as string,
            threadId: context?.threadId,
            data: {
              contentLength: fullContent.length,
              chunkCount,
              finishReason: chunk.choices[0].finish_reason,
              duration,
              model,
              streaming: true,
            },
          });

          yield { content: '', isComplete: true };
          return;
        }
      }

    } catch (error) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to milliseconds

      globalTracer.trace({
        type: 'error',
        agentId: context?.metadata?.agentId as string,
        threadId: context?.threadId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          duration,
          model,
          streaming: true,
          stack: error instanceof Error ? error.stack : undefined,
        },
      });

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
