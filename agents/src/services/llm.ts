import { generateText, streamText, ModelMessage, tool } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { z } from 'zod';
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
  messages: LLMMessage[];
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

/**
 * Convert LLMMessage format to ModelMessage format for AI SDK
 */
function convertToModelMessage(llmMessage: LLMMessage): ModelMessage {
  // Handle tool results (when role is 'tool')
  if (llmMessage.role === 'tool' && llmMessage.tool_call_id) {
    const content = llmMessage.content || '';
    let output;

    // Try to parse as JSON first, otherwise treat as text
    try {
      const jsonContent = JSON.parse(content);
      output = {
        type: 'json' as const,
        value: jsonContent,
      };
    } catch {
      output = {
        type: 'text' as const,
        value: content,
      };
    }

    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: llmMessage.tool_call_id,
          toolName: llmMessage.name,
          output,
        },
      ],
    } as ModelMessage;
  }

  // Handle assistant messages with tool calls
  if (llmMessage.role === 'assistant' && llmMessage.tool_calls && llmMessage.tool_calls.length > 0) {
    const content: any[] = [];

    // Add text content if present
    if (llmMessage.content && llmMessage.content.trim()) {
      content.push({
        type: 'text',
        text: llmMessage.content,
      });
    }

    // Add tool calls as content parts
    for (const toolCall of llmMessage.tool_calls) {
      content.push({
        type: 'tool-call',
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments || '{}'),
      });
    }

    return {
      role: 'assistant',
      content,
    } as ModelMessage;
  }

  // Handle regular messages
  return {
    role: llmMessage.role as 'system' | 'user' | 'assistant',
    content: llmMessage.content || '',
  };
}

/**
 * Convert array of LLMMessage to ModelMessage array
 */
function convertToModelMessages(llmMessages: LLMMessage[]): ModelMessage[] {
  return llmMessages.map(convertToModelMessage);
}

/**
 * Convert JSON Schema to Zod schema for AI SDK tools
 * Simplified version to avoid deep type instantiation issues
 */
function jsonSchemaToZod(jsonSchema: any): z.ZodTypeAny {
  if (jsonSchema.type === 'object') {
    const shape: Record<string, z.ZodTypeAny> = {};
    const properties = jsonSchema.properties || {};
    const required = jsonSchema.required || [];

    for (const [key, property] of Object.entries(properties) as [string, any][]) {
      let zodSchema: z.ZodTypeAny;

      switch (property.type) {
        case 'string':
          if (property.enum) {
            zodSchema = z.enum(property.enum);
          } else {
            zodSchema = z.string();
          }
          break;
        case 'number':
          let numberSchema = z.number();
          if (property.minimum !== undefined) {
            numberSchema = numberSchema.min(property.minimum);
          }
          if (property.maximum !== undefined) {
            numberSchema = numberSchema.max(property.maximum);
          }
          zodSchema = numberSchema;
          break;
        case 'boolean':
          zodSchema = z.boolean();
          break;
        case 'array':
          if (property.items && property.items.type) {
            zodSchema = z.array(jsonSchemaToZod(property.items));
          } else {
            zodSchema = z.array(z.any());
          }
          break;
        case 'object':
          if (property.properties) {
            zodSchema = jsonSchemaToZod(property);
          } else {
            zodSchema = z.record(z.any());
          }
          break;
        default:
          zodSchema = z.any();
      }

      // Make field optional if not in required array
      if (!required.includes(key)) {
        zodSchema = zodSchema.optional();
      }

      // Set default value if provided
      if (property.default !== undefined) {
        zodSchema = zodSchema.default(property.default);
      }

      shape[key] = zodSchema;
    }

    return z.object(shape);
  } else if (jsonSchema.type === 'array') {
    if (jsonSchema.items && jsonSchema.items.type) {
      return z.array(jsonSchemaToZod(jsonSchema.items));
    } else {
      return z.array(z.any());
    }
  } else {
    // Handle primitive types
    switch (jsonSchema.type) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'boolean':
        return z.boolean();
      default:
        return z.any();
    }
  }
}

/**
 * Convert OpenAI tool format to AI SDK tool format
 * Just provide tool definitions without execute functions
 * Let AI SDK generate tool calls for manual execution by WebSocket handler
 */
function convertToAISDKTools(
  openAITools: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>
): Record<string, any> {
  const tools: Record<string, any> = {};

  for (const openAITool of openAITools) {
    const { name, description, parameters } = openAITool.function;
    const inputSchema = jsonSchemaToZod(parameters);

    // Create tool definition without execute function
    // AI SDK will generate tool calls, WebSocket handler will execute them
    tools[name] = tool({
      description,
      inputSchema: inputSchema as any,
    } as any);
  }

  return tools;
}

export class LLMService {
  private model: any; // Using any to avoid type issues with AI SDK version differences
  private defaultModelName: string;
  private tokenUsageRepo: TokenUsageRepository;
  private provider: 'openai' | 'bedrock';

  constructor(apiKey?: string, defaultModel = 'claude-sonnet-4-20250514', provider?: 'openai' | 'bedrock') {
    this.defaultModelName = defaultModel;
    this.tokenUsageRepo = new TokenUsageRepository();

    // Determine provider based on model name or explicit provider parameter
    if (provider) {
      this.provider = provider;
    } else if (apiKey || process.env.OPENAI_API_KEY) {
      this.provider = 'openai';
    } else {
      this.provider = 'bedrock';
    }

    // Configure the model based on provider
    switch (this.provider) {
      case 'bedrock':
        // For Bedrock, we need AWS credentials to be set
        const bedrock = createAmazonBedrock({
          region: process.env.AWS_REGION || 'us-west-2',
          credentialProvider: fromNodeProviderChain(),
        });

        // Mapping of supported Anthropic models to Bedrock model identifiers
        const anthropicModelMap: Record<string, string> = {
          'claude-sonnet-4-20250514': 'us.anthropic.claude-sonnet-4-20250514-v1:0',
          'claude-3-5-haiku-20241022': 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
          'claude-3-7-sonnet-20250219': 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
          'nova-pro-v1': 'us.amazon.nova-pro-v1:0',
          // Add more supported models as needed
        };

        const bedrockModel = anthropicModelMap[this.defaultModelName];
        
        if (!bedrockModel) {
          throw new Error(
            `Invalid or unsupported Anthropic model name for Bedrock: ${this.defaultModelName}. Supported models: ${Object.keys(anthropicModelMap).join(', ')}`
          );
        }

        this.model = bedrock(bedrockModel) as any;
        break;

      case 'openai':
        const provider = createOpenAICompatible({
          name: 'openai',
          apiKey: apiKey || process.env.OPENAI_API_KEY || '',
          baseURL: process.env.OPENAI_BASE_URL || '',
          includeUsage: true, // Include usage information in streaming responses
        });
        this.model = provider(this.defaultModelName) as any;
        break;

      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }

    globalTracer.trace({
      type: 'debug',
      data: {
        message: 'LLMService initialized',
        defaultModel: this.defaultModelName,
        provider: this.provider,
        hasCredentials: true, // We've validated this above
      },
    });
  }

  async complete(
    request: LLMRequest,
    context?: AgentExecutionContext
  ): Promise<LLMResponse> {
    const startTime = process.hrtime.bigint();
    const modelName = request.model || this.defaultModelName;

    // Log LLM request with structured logging (info level - metadata only)
    const requestData: any = {
      model: modelName,
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
        model: modelName,
        messageCount: request.messages.length,
        messages: request.messages
      };
      
      if (context?.metadata?.agentId) debugData.agentId = context.metadata.agentId;
      if (context?.threadId) debugData.threadId = context.threadId;
      
      logger.debug('llm.request.messages', debugData);
    }

    try {
      // Convert LLMMessage format to ModelMessage format for AI SDK
      const modelMessages = convertToModelMessages(request.messages);

      // Convert OpenAI tools to AI SDK format if tools are provided
      const aiSdkTools = request.tools ? convertToAISDKTools(request.tools) : undefined;

      const result = await generateText({
        model: this.model,
        messages: modelMessages,
        temperature: request.temperature ?? 0.5,
        maxOutputTokens: request.maxTokens ?? 16000,
        ...(aiSdkTools ? { tools: aiSdkTools } : {}),
        // Enable cache points for Bedrock
        ...(this.provider === 'bedrock' ? {
          providerOptions: {
            bedrock: { cachePoint: { type: 'default' } },
          },
        } : {}),
      });

      // Convert AI SDK tool calls back to OpenAI format
      const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const toolCall of result.toolCalls) {
          toolCalls.push({
            id: toolCall.toolCallId,
            type: 'function',
            function: {
              name: toolCall.toolName,
              arguments: JSON.stringify(toolCall.input),
            },
          });
        }
      }

      const response: LLMResponse = {
        id: `ai-sdk-${Date.now()}`,
        content: result.text || null,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        usage: result.usage ? {
          promptTokens: result.usage.inputTokens || 0,
          completionTokens: result.usage.outputTokens || 0,
          totalTokens: result.usage.totalTokens || 0,
        } : undefined,
        model: modelName,
        finishReason: result.finishReason || 'unknown',
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
      } else if (context?.metadata?.appId && !response.usage) {
        // Fallback estimation if usage data is not available
        try {
          const estimatedCompletionTokens = Math.ceil((response.content?.length || 0) / 4);
          const estimatedPromptTokens = Math.ceil(request.messages.map(m => m.content || '').join(' ').length / 4);
          
          await this.tokenUsageRepo.recordUsage(
            context.metadata.appId as string,
            'llm_request',
            estimatedPromptTokens,
            estimatedCompletionTokens,
            {
              model: response.model,
              conversationId: context.metadata?.conversationId as string,
              description: `LLM request - ${request.messages.length} messages (estimated tokens)`
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
      const errorData: any = { model: modelName, duration };
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
    const modelName = request.model || this.defaultModelName;

    // Log streaming LLM request with structured logging (info level - metadata only)
    const streamRequestData: any = {
      model: modelName,
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
        model: modelName,
        messageCount: request.messages.length,
        streaming: true,
        messages: request.messages
      };
      
      if (context?.metadata?.agentId) streamDebugData.agentId = context.metadata.agentId;
      if (context?.threadId) streamDebugData.threadId = context.threadId;
      
      logger.debug('llm.request.messages', streamDebugData);
    }

    try {
      // Convert LLMMessage format to ModelMessage format for AI SDK
      const modelMessages = convertToModelMessages(request.messages);

      // Convert OpenAI tools to AI SDK format if tools are provided
      const aiSdkTools = request.tools ? convertToAISDKTools(request.tools) : undefined;

      const result = streamText({
        model: this.model,
        messages: modelMessages,
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 2000,
        ...(aiSdkTools ? { tools: aiSdkTools } : {}),
        // Enable cache points for Bedrock
        ...(this.provider === 'bedrock' ? {
          providerOptions: {
            bedrock: { cachePoint: { type: 'default' } },
          },
        } : {}),
      });

      let fullContent = '';
      let chunkCount = 0;

      for await (const textPart of result.textStream) {
        const content = textPart || '';
        
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
      }

      // Wait for the final result to get usage and finish reason
      const finalResult = await result;
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to milliseconds

      // Log streaming LLM response with structured logging
      const streamResponseData: any = {
        model: modelName,
        messageCount: request.messages.length,
        contentLength: fullContent.length,
        chunkCount,
        finishReason: finalResult.finishReason || 'unknown',
        duration,
        streaming: true,
        hasTools: !!request.tools
      };
      
      if (context?.metadata?.agentId) streamResponseData.agentId = context.metadata.agentId;
      if (context?.threadId) streamResponseData.threadId = context.threadId;
      
      llmEvents.response(logger, streamResponseData);

      // Track token usage for streaming
      if (finalResult.usage && context?.metadata?.appId) {
        try {
          // Await the usage promise and extract values
          const usage = await finalResult.usage;
          await this.tokenUsageRepo.recordUsage(
            context.metadata.appId as string,
            'llm_request',
            usage.inputTokens || 0,
            usage.outputTokens || 0,
            {
              model: modelName,
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
      } else if (context?.metadata?.appId) {
        try {
          // Fallback estimation if usage is not available
          const estimatedTokens = Math.ceil(fullContent.length / 4);
          const promptTokens = Math.ceil(
            request.messages.reduce((acc, m) => acc + ((m.content || '').length), 0) / 4
          );
          await this.tokenUsageRepo.recordUsage(
            context.metadata.appId as string,
            'llm_request',
            promptTokens,
            estimatedTokens,
            {
              model: modelName,
              conversationId: context.metadata?.conversationId as string,
              description: `Streaming LLM request - ${chunkCount} chunks (estimated)`
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

    } catch (error) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to milliseconds

      // Log streaming LLM error with structured logging
      const streamErrorData: any = { model: modelName, duration };
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
