import type { ToolCall } from '../database/schema.js';
import { ConversationRepository } from '../database/repositories/ConversationRepository.js';
import { logger } from '../logging/index.js';
import { countTokens, estimateTokens } from '../utils/token-counter.js';
import { MessageCompressor } from './compression/MessageCompressor.js';
import type { CompressionStrategy } from './compression/MessageCompressor.js';

/**
 * LLM message format for OpenAI-style APIs
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

/**
 * Raw database message with conversation context
 */
export interface DatabaseMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'agent';
  content: string;
  segments?: Array<{
    id: string;
    type: 'content' | 'tool_call';
    content?: string;
    tool_call?: {
      id: string;
      tool_name: string;
      tool_args: any;
      tool_result?: any;
      error?: string;
      status?: 'running' | 'success' | 'error';
    };
    timestamp: Date;
  }>;
  toolCalls?: ToolCall[];
  createdAt: Date;
}

/**
 * Loads conversation messages from database and converts them to LLM format
 * Uses segments-based approach for proper message reconstruction
 */
export class ConversationHistoryLoader {
  private compressor = new MessageCompressor();

  constructor(private conversationRepo: ConversationRepository) {}

  /**
   * Register a compression strategy
   */
  registerCompressionStrategy(strategy: CompressionStrategy): void {
    this.compressor.registerStrategy(strategy);
  }

  /**
   * Get the message compressor instance for configuration
   */
  getCompressor(): MessageCompressor {
    return this.compressor;
  }

  /**
   * Get a specific strategy by name
   */
  getStrategy<T extends CompressionStrategy>(name: string): T | undefined {
    return this.compressor.getStrategies().find((s) => s.name === name) as T | undefined;
  }

  /**
   * Load all messages for an app/agent combination from database
   * Uses getMessagesForHistory for consistent normalized format
   * @param appId - ID of the app
   * @param agentId - ID of the agent
   * @returns Array of raw database messages sorted by timestamp (oldest first)
   */
  async loadDatabaseMessages(appId: string, agentId: string): Promise<DatabaseMessage[]> {
    logger.debug('conversation.history.loader.load_begin', {
      appId,
      agentId,
    });

    const conversations = await this.conversationRepo.findByAppAndAgent(appId, agentId);

    logger.debug('conversation.history.loader.conversations_found', {
      appId,
      agentId,
      conversationsCount: conversations.length,
    });

    const allMessages: DatabaseMessage[] = [];

    for (const conversation of conversations) {
      const messages = await this.conversationRepo.getMessagesForHistory(conversation.id);
      allMessages.push(
        ...messages.map((msg) => ({
          ...msg,
          conversationId: conversation.id,
        }))
      );
    }

    allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    logger.debug('conversation.history.loader.load_complete', {
      appId,
      agentId,
      totalMessages: allMessages.length,
    });

    return allMessages;
  }

  /**
   * Load messages for a specific conversation from database
   * Uses getMessagesForHistory for consistent normalized format
   * @param conversationId - ID of the conversation
   * @returns Array of raw database messages sorted by timestamp (oldest first)
   */
  async loadDatabaseMessagesByConversationId(conversationId: string): Promise<DatabaseMessage[]> {
    logger.debug('conversation.history.loader.load_by_conversation_begin', {
      conversationId,
    });

    const messages = await this.conversationRepo.getMessagesForHistory(conversationId);
    const dbMessages = messages.map((msg) => ({
      ...msg,
      conversationId,
    }));

    dbMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    logger.debug('conversation.history.loader.load_by_conversation_complete', {
      conversationId,
      totalMessages: dbMessages.length,
    });

    return dbMessages;
  }

  /**
   * Convert database messages to LLM format using segments
   * @param dbMessages - Array of database messages
   * @returns Array of LLM messages
   */
  convertToLLMMessages(dbMessages: DatabaseMessage[]): LLMMessage[] {
    logger.debug('conversation.history.loader.convert_begin', {
      totalMessages: dbMessages.length,
    });

    const llmMessages: LLMMessage[] = [];

    for (const message of dbMessages) {
      if (message.sender === 'user') {
        if (message.content && message.content.trim() !== '') {
          llmMessages.push({
            role: 'user',
            content: message.content.trim(),
          });
        } else {
          logger.warn('conversation.history.loader.empty_user_message', {
            messageId: message.id,
            conversationId: message.conversationId,
          });
        }
      } else if (message.sender === 'agent') {
        if (!message.segments || message.segments.length === 0) {
          logger.warn('conversation.history.loader.no_segments', {
            messageId: message.id,
            conversationId: message.conversationId,
          });
          
          if (message.content && message.content.trim() !== '') {
            llmMessages.push({
              role: 'assistant',
              content: message.content.trim(),
            });
          }
          continue;
        }

        const segmentMessages = this.processMessageSegments(
          message.segments,
          message.conversationId
        );
        llmMessages.push(...segmentMessages);
      }
    }

    logger.debug('conversation.history.loader.convert_complete', {
      inputMessages: dbMessages.length,
      outputMessages: llmMessages.length,
    });

    return llmMessages;
  }

  /**
   * Process message segments to create properly ordered LLM messages
   * Emits assistant/tool pairs as tools are executed to preserve execution order
   * Returns a single interleaved array
   * 
   * Deduplicates tool calls by tool_call_id to prevent duplicate entries
   */
  private processMessageSegments(
    segments: Array<{
      id: string;
      type: 'content' | 'tool_call';
      content?: string;
      tool_call?: {
        id: string;
        tool_name: string;
        tool_args: any;
        tool_result?: any;
        error?: string;
        status?: 'running' | 'success' | 'error';
      };
      timestamp: Date;
    }>,
    conversationId: string
  ): LLMMessage[] {
    const sortedSegments = segments.sort((a, b) => {
      const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return timeA - timeB;
    });

    const messages: LLMMessage[] = [];
    let contentAccumulator = '';
    const processedToolCallIds = new Set<string>();

    for (const segment of sortedSegments) {
      if (segment.type === 'content' && segment.content) {
        let normalizedContent = segment.content;
        if (Array.isArray(normalizedContent)) {
          normalizedContent = normalizedContent
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join('');
        }
        contentAccumulator += normalizedContent;
      } else if (segment.type === 'tool_call' && segment.tool_call) {
        // Deduplicate tool calls by ID
        if (processedToolCallIds.has(segment.tool_call.id)) {
          logger.debug('conversation.history.loader.tool_call_duplicate_skipped', {
            conversationId,
            toolCallId: segment.tool_call.id,
            toolName: segment.tool_call.tool_name,
          });
          continue;
        }

        logger.debug('conversation.history.loader.tool_call_found', {
          conversationId,
          toolCallId: segment.tool_call.id,
          toolName: segment.tool_call.tool_name,
          hasResult: !!segment.tool_call.tool_result,
        });

        if (!segment.tool_call.tool_result) {
          logger.warn('conversation.history.loader.tool_call_skipped', {
            conversationId,
            toolCallId: segment.tool_call.id,
            toolName: segment.tool_call.tool_name,
            reason: 'no_result',
          });
          continue;
        }

        // Mark this tool call as processed
        processedToolCallIds.add(segment.tool_call.id);

        if (contentAccumulator.trim()) {
          messages.push({
            role: 'assistant',
            content: contentAccumulator.trim(),
          });
          contentAccumulator = '';
        }

        const toolCall = this.convertSingleToolCall(segment.tool_call);
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [toolCall]
        });

        const toolContent =
          typeof segment.tool_call.tool_result === 'string'
            ? segment.tool_call.tool_result.trim()
            : JSON.stringify(segment.tool_call.tool_result);

        if (toolContent && toolContent !== '{}' && toolContent !== 'null') {
          messages.push({
            role: 'tool',
            content: toolContent,
            tool_call_id: segment.tool_call.id,
            name: segment.tool_call.tool_name,
          });
        }
      }
    }

    if (contentAccumulator.trim()) {
      messages.push({
        role: 'assistant',
        content: contentAccumulator.trim(),
      });
    }

    return messages;
  }

  /**
   * Apply token-based limiting to LLM messages
   * Keeps most recent messages within token limit
   * @param llmMessages - Array of LLM messages (must be chronologically sorted)
   * @param maxTokens - Maximum tokens to include
   * @param modelName - Model name for accurate token counting
   * @returns Token-limited array of LLM messages
   */
  applyTokenLimit(llmMessages: LLMMessage[], maxTokens: number, modelName?: string): LLMMessage[] {
    logger.debug('conversation.history.loader.token_limit_begin', {
      totalMessages: llmMessages.length,
      maxTokens,
      modelName: modelName || 'estimation',
    });

    const limitedMessages: LLMMessage[] = [];
    let currentTokenCount = 0;

    for (let i = llmMessages.length - 1; i >= 0; i--) {
      const message = llmMessages[i];
      if (!message) continue;
      const messageContent = this.serializeMessageForTokenCount(message);

      let messageTokens: number;
      if (modelName && messageContent.trim()) {
        try {
          const result = countTokens(messageContent, modelName);
          messageTokens = result.tokenCount;
        } catch (error) {
          messageTokens = estimateTokens(messageContent);
          logger.warn('conversation.history.loader.token_count_fallback', {
            messageIndex: i,
            error: error instanceof Error ? error.message : String(error),
            estimatedTokens: messageTokens,
          });
        }
      } else {
        messageTokens = estimateTokens(messageContent);
      }

      if (currentTokenCount + messageTokens > maxTokens && limitedMessages.length > 0) {
        logger.info('conversation.history.loader.token_limit_reached', {
          processedMessages: limitedMessages.length,
          currentTokens: currentTokenCount,
          maxTokens,
          droppedMessages: i + 1,
        });
        break;
      }

      limitedMessages.unshift(message);
      currentTokenCount += messageTokens;
    }

    logger.debug('conversation.history.loader.token_limit_complete', {
      inputMessages: llmMessages.length,
      outputMessages: limitedMessages.length,
      estimatedTokens: currentTokenCount,
      maxTokens,
    });

    return limitedMessages;
  }

  /**
   * Serialize an LLM message to string for token counting
   * Includes content, tool calls, and tool results
   */
  private serializeMessageForTokenCount(message: LLMMessage): string {
    let serialized = message.content || '';

    if (message.tool_calls && message.tool_calls.length > 0) {
      serialized += '\n[Tool Calls]\n';
      for (const toolCall of message.tool_calls) {
        serialized += `${toolCall.function.name}: ${toolCall.function.arguments}\n`;
      }
    }

    if (message.role === 'tool') {
      serialized += `\n[Tool Result: ${message.name}]\n${message.content}`;
    }

    return serialized;
  }

  /**
   * Load messages with compression and token limit applied
   * This is the main entry point for conversation history loading
   * @param appId - ID of the app
   * @param agentId - ID of the agent
   * @param maxTokens - Maximum tokens to include (default: 40000)
   * @param modelName - Model name for accurate token counting
   * @param enableCompression - Whether to apply compression (default: true)
   * @returns Token-limited array of LLM messages
   */
  async loadMessagesWithTokenLimit(
    appId: string,
    agentId: string,
    maxTokens: number = 40000,
    modelName?: string,
    enableCompression: boolean = true,
    appPath?: string
  ): Promise<LLMMessage[]> {
    const dbMessages = await this.loadDatabaseMessages(appId, agentId);
    let llmMessages = this.convertToLLMMessages(dbMessages);
    
    if (enableCompression) {
      const hotFileStrategy = this.getStrategy('hot-file-inclusion');
      
      logger.debug('conversation.history.hot_files.strategy_check', {
        appId,
        agentId,
        hasStrategy: !!hotFileStrategy,
        hasAppPath: !!appPath,
        appPath,
      });
      
      if (hotFileStrategy && appPath) {
        (hotFileStrategy as any).setAppPath(appPath);
      }

      const compressionResult = this.compressor.compressMessages(llmMessages);
      llmMessages = compressionResult.messages;
      
      if (hotFileStrategy && appPath) {
        await (hotFileStrategy as any).loadHotFilesContent();
        const hotFilesList = (hotFileStrategy as any).getHotFilesList();
        const hotFilesMessage = (hotFileStrategy as any).getHotFilesMessage();
        
        logger.debug('conversation.history.hot_files.load_result', {
          appId,
          agentId,
          totalHotFiles: hotFilesList.length,
          hasMessage: !!hotFilesMessage,
          messageLength: hotFilesMessage?.length || 0,
        });
        
        if (hotFilesMessage) {
          llmMessages.unshift({
            role: 'user',
            content: hotFilesMessage,
          });
          
          logger.info('conversation.history.hot_files.injected', {
            appId,
            agentId,
            hotFiles: hotFilesList.length,
            messageLength: hotFilesMessage.length,
          });
        } else if (hotFilesList.length > 0) {
          logger.warn('conversation.history.hot_files.no_message', {
            appId,
            agentId,
            hotFilesCount: hotFilesList.length,
            reason: 'Hot files identified but no message generated',
          });
        }
      } else {
        logger.warn('conversation.history.hot_files.skipped', {
          appId,
          agentId,
          hasStrategy: !!hotFileStrategy,
          hasAppPath: !!appPath,
        });
      }
      
      logger.info('conversation.history.compression.applied', {
        appId,
        agentId,
        originalMessages: compressionResult.stats.totalMessages,
        compressedMessages: compressionResult.stats.compressedMessages,
        originalLength: compressionResult.stats.originalTotalLength,
        compressedLength: compressionResult.stats.compressedTotalLength,
        compressionRatio: compressionResult.stats.compressionRatio,
        savedBytes: compressionResult.stats.originalTotalLength - compressionResult.stats.compressedTotalLength,
        strategiesUsed: compressionResult.stats.strategiesUsed,
      });
    }
    
    return this.applyTokenLimit(llmMessages, maxTokens, modelName);
  }

  /**
   * Load messages with compression and token limit applied for a specific app
   * This loads history across all conversations for the app, ensuring continuity
   * @param appId - ID of the app
   * @param maxTokens - Maximum tokens to include (default: 40000)
   * @param modelName - Model name for accurate token counting
   * @param enableCompression - Whether to apply compression (default: true)
   * @param appPath - Path to the app for hot file loading
   * @returns Token-limited array of LLM messages
   */
  async loadMessagesWithTokenLimitByAppId(
    appId: string,
    maxTokens: number = 40000,
    modelName?: string,
    enableCompression: boolean = true,
    appPath?: string
  ): Promise<LLMMessage[]> {
    const conversations = await this.conversationRepo.getByAppId(appId);
    
    logger.debug('conversation.history.loader.load_by_app_begin', {
      appId,
      conversationsCount: conversations.length,
    });

    const allMessages: DatabaseMessage[] = [];

    for (const conversation of conversations) {
      const messages = await this.conversationRepo.getMessagesForHistory(conversation.id);
      allMessages.push(
        ...messages.map((msg) => ({
          ...msg,
          conversationId: conversation.id,
        }))
      );
    }

    allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    logger.debug('conversation.history.loader.load_by_app_complete', {
      appId,
      totalMessages: allMessages.length,
    });

    let llmMessages = this.convertToLLMMessages(allMessages);
    
    if (enableCompression) {
      const hotFileStrategy = this.getStrategy('hot-file-inclusion');
      
      logger.debug('conversation.history.hot_files.strategy_check', {
        appId,
        hasStrategy: !!hotFileStrategy,
        hasAppPath: !!appPath,
        appPath,
      });
      
      if (hotFileStrategy && appPath) {
        (hotFileStrategy as any).setAppPath(appPath);
      }

      const compressionResult = this.compressor.compressMessages(llmMessages);
      llmMessages = compressionResult.messages;
      
      if (hotFileStrategy && appPath) {
        await (hotFileStrategy as any).loadHotFilesContent();
        const hotFilesList = (hotFileStrategy as any).getHotFilesList();
        const hotFilesMessage = (hotFileStrategy as any).getHotFilesMessage();
        
        logger.debug('conversation.history.hot_files.load_result', {
          appId,
          totalHotFiles: hotFilesList.length,
          hasMessage: !!hotFilesMessage,
          messageLength: hotFilesMessage?.length || 0,
        });
        
        if (hotFilesMessage) {
          llmMessages.unshift({
            role: 'user',
            content: hotFilesMessage,
          });
          
          logger.info('conversation.history.hot_files.injected', {
            appId,
            hotFiles: hotFilesList.length,
            messageLength: hotFilesMessage.length,
          });
        } else if (hotFilesList.length > 0) {
          logger.warn('conversation.history.hot_files.no_message', {
            appId,
            hotFilesCount: hotFilesList.length,
            reason: 'Hot files identified but no message generated',
          });
        }
      } else {
        logger.warn('conversation.history.hot_files.skipped', {
          appId,
          hasStrategy: !!hotFileStrategy,
          hasAppPath: !!appPath,
        });
      }
      
      logger.info('conversation.history.compression.applied', {
        appId,
        originalMessages: compressionResult.stats.totalMessages,
        compressedMessages: compressionResult.stats.compressedMessages,
        originalLength: compressionResult.stats.originalTotalLength,
        compressedLength: compressionResult.stats.compressedTotalLength,
        compressionRatio: compressionResult.stats.compressionRatio,
        savedBytes: compressionResult.stats.originalTotalLength - compressionResult.stats.compressedTotalLength,
        strategiesUsed: compressionResult.stats.strategiesUsed,
      });
    }
    
    return this.applyTokenLimit(llmMessages, maxTokens, modelName);
  }

  /**
   * Load messages with compression and token limit applied for a specific conversation
   * This should be used when you have a conversationId (e.g., during agent handoffs)
   * @param conversationId - ID of the conversation
   * @param maxTokens - Maximum tokens to include (default: 40000)
   * @param modelName - Model name for accurate token counting
   * @param enableCompression - Whether to apply compression (default: true)
   * @param appPath - Path to the app for hot file loading
   * @returns Token-limited array of LLM messages
   */
  async loadMessagesWithTokenLimitByConversationId(
    conversationId: string,
    maxTokens: number = 40000,
    modelName?: string,
    enableCompression: boolean = true,
    appPath?: string
  ): Promise<LLMMessage[]> {
    const dbMessages = await this.loadDatabaseMessagesByConversationId(conversationId);
    let llmMessages = this.convertToLLMMessages(dbMessages);
    
    if (enableCompression) {
      const hotFileStrategy = this.getStrategy('hot-file-inclusion');
      
      logger.debug('conversation.history.hot_files.strategy_check', {
        conversationId,
        hasStrategy: !!hotFileStrategy,
        hasAppPath: !!appPath,
        appPath,
      });
      
      if (hotFileStrategy && appPath) {
        (hotFileStrategy as any).setAppPath(appPath);
      }

      const compressionResult = this.compressor.compressMessages(llmMessages);
      llmMessages = compressionResult.messages;
      
      if (hotFileStrategy && appPath) {
        await (hotFileStrategy as any).loadHotFilesContent();
        const hotFilesList = (hotFileStrategy as any).getHotFilesList();
        const hotFilesMessage = (hotFileStrategy as any).getHotFilesMessage();
        
        logger.debug('conversation.history.hot_files.load_result', {
          conversationId,
          totalHotFiles: hotFilesList.length,
          hasMessage: !!hotFilesMessage,
          messageLength: hotFilesMessage?.length || 0,
        });
        
        if (hotFilesMessage) {
          llmMessages.unshift({
            role: 'user',
            content: hotFilesMessage,
          });
          
          logger.info('conversation.history.hot_files.injected', {
            conversationId,
            hotFiles: hotFilesList.length,
            messageLength: hotFilesMessage.length,
          });
        } else if (hotFilesList.length > 0) {
          logger.warn('conversation.history.hot_files.no_message', {
            conversationId,
            hotFilesCount: hotFilesList.length,
            reason: 'Hot files identified but no message generated',
          });
        }
      } else {
        logger.warn('conversation.history.hot_files.skipped', {
          conversationId,
          hasStrategy: !!hotFileStrategy,
          hasAppPath: !!appPath,
        });
      }
      
      logger.info('conversation.history.compression.applied', {
        conversationId,
        originalMessages: compressionResult.stats.totalMessages,
        compressedMessages: compressionResult.stats.compressedMessages,
        originalLength: compressionResult.stats.originalTotalLength,
        compressedLength: compressionResult.stats.compressedTotalLength,
        compressionRatio: compressionResult.stats.compressionRatio,
        savedBytes: compressionResult.stats.originalTotalLength - compressionResult.stats.compressedTotalLength,
        strategiesUsed: compressionResult.stats.strategiesUsed,
      });
    }
    
    return this.applyTokenLimit(llmMessages, maxTokens, modelName);
  }

  /**
   * Format LLM messages for AI SDK ConversationMessage format
   * AI SDK uses OpenAI format internally and converts to provider format
   * Injects tool results inline as user messages with summaries
   * @param llmMessages - Array of LLM messages from loadMessagesWithTokenLimit
   * @param appId - App ID for logging
   * @param agentId - Agent ID for logging
   * @returns Array formatted for AI SDK
   */
  formatMessagesForAISDK(
    llmMessages: LLMMessage[],
    appId: string,
    agentId: string
  ): Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }> {
    const formattedMessages: any[] = [];
    
    for (let i = 0; i < llmMessages.length; i++) {
      const msg = llmMessages[i];
      if (!msg) continue;
      
      if (msg.role === 'tool') {
        const toolResult = msg.content || '';
        const isSuccess = !toolResult.toLowerCase().includes('error') && 
                         !toolResult.toLowerCase().includes('failed');
        const status = isSuccess ? '✅' : '❌';
        const preview = toolResult.length > 200 ? toolResult.substring(0, 200) + '...' : toolResult;
        
        formattedMessages.push({
          role: 'user',
          content: `[Tool Result: ${msg.name}] ${status}\n${preview}`
        });
        continue;
      }
      
      const result: any = {
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content || ''
      };
      
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        result.tool_calls = msg.tool_calls;
        
        logger.debug('conversation.history.loader.tool_calls_preserved', {
          appId,
          agentId,
          toolCallsCount: msg.tool_calls.length,
          toolNames: msg.tool_calls.map((tc: any) => tc.function.name)
        });
      }
      
      formattedMessages.push(result);
    }
    
    const messagesWithToolCalls = formattedMessages.filter(msg => msg.tool_calls);
    const toolResultCount = formattedMessages.filter(msg => 
      msg.role === 'user' && msg.content.startsWith('[Tool Result:')
    ).length;
    
    if (messagesWithToolCalls.length > 0) {
      logger.info('conversation.history.loader.formatted_for_ai_sdk', {
        appId,
        agentId,
        totalMessages: formattedMessages.length,
        messagesWithToolCalls: messagesWithToolCalls.length,
        totalToolCalls: messagesWithToolCalls.reduce((sum, msg) => sum + (msg.tool_calls?.length || 0), 0),
        toolResultMessages: toolResultCount
      });
    }
    
    return formattedMessages;
  }

  /**
   * Convert a single tool call to LLM API format
   */
  private convertSingleToolCall(toolCall: {
    id: string;
    tool_name: string;
    tool_args: any;
    tool_result?: any;
    error?: string;
    status?: 'running' | 'success' | 'error';
  }): {
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  } {
    return {
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.tool_name,
        arguments: typeof toolCall.tool_args === 'string' ? toolCall.tool_args : JSON.stringify(toolCall.tool_args),
      },
    };
  }
}
