import type { ModelMessage, ToolModelMessage, UserModelMessage, AssistantModelMessage, SystemModelMessage } from 'ai';
import type { ToolCall, ConversationSummary } from '../database/schema.js';
import type { DatabaseMessage } from '../types/conversation-messages.js';
import { ConversationRepository } from '../database/repositories/ConversationRepository.js';
import { SummaryRepository } from '../database/repositories/SummaryRepository.js';
import { logger } from '../logging/index.js';
import { countTokens } from '../utils/token-counter.js';

// Default model for token counting when no specific model is provided
const DEFAULT_TOKEN_COUNTING_MODEL = 'claude-sonnet-4-5';
import { MessageCompressor } from './compression/MessageCompressor.js';
import type { CompressionStrategy } from './compression/MessageCompressor.js';
import type { SummarizationStrategy } from './summarization/SummarizationStrategy.js';
import { LLMSummarizationStrategy } from './summarization/LLMSummarizationStrategy.js';

/**
 * Tool result part in AI SDK v6 format
 */
export interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: { type: 'text'; value: string } | unknown;
}

/**
 * Tool message in AI SDK v6 format
 */
export interface AIToolMessage {
  role: 'tool';
  content: ToolResultPart[];
}

/**
 * OpenAI-style message format (used for user/assistant/system messages)
 */
export interface OpenAIMessage {
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
  metadata?: {
    isSummary?: boolean;
    isOperationLog?: boolean;
  };
  /**
   * Cache control for Anthropic prompt caching.
   * Per Anthropic's docs, caching is effective for user and assistant messages.
   * This implementation uses it specifically on user messages for summary caching.
   */
  cachePoint?: { type: 'ephemeral' };
}

/**
 * LLM message format - union of OpenAI format and AI SDK v6 tool format
 * Tool messages at runtime use AIToolMessage format, others use OpenAIMessage
 */
export type LLMMessage = OpenAIMessage | AIToolMessage;

export interface ConversationHistorySummary {
  text: string;
  operationLog?: string;
  tokenCount: number;
  originalTokenCount: number;
  summaryId?: string;
  messagesCovered?: number;
  messagesRemaining?: number;
}

export interface ConversationHistoryWithSummary {
  messages: LLMMessage[];
  summary?: ConversationHistorySummary;
}

/**
 * Type guard for AI SDK v6 tool messages
 */
export function isAIToolMessage(message: LLMMessage): message is AIToolMessage {
  return message.role === 'tool' &&
    Array.isArray(message.content) &&
    message.content.length > 0 &&
    message.content[0]?.type === 'tool-result';
}

/**
 * Type guard for tool-result parts
 */
export function isToolResultPart(part: unknown): part is ToolResultPart {
  return typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'tool-result';
}

/**
 * Type guard for OpenAI-style messages (non-tool or legacy tool format)
 */
export function isOpenAIMessage(message: LLMMessage): message is OpenAIMessage {
  return typeof message.content === 'string';
}

/**
 * Get content as string from either message format
 */
export function getMessageContent(message: LLMMessage): string {
  if (isOpenAIMessage(message)) {
    return message.content;
  }
  // For AI tool messages, extract text from first tool result
  const firstResult = message.content[0];
  if (firstResult?.output && typeof firstResult.output === 'object' && 'type' in firstResult.output && firstResult.output.type === 'text') {
    return (firstResult.output as { type: 'text'; value: string }).value;
  }
  return '';
}

// Re-export DatabaseMessage for backwards compatibility
export type { DatabaseMessage };

/**
 * Loads conversation messages from database and converts them to LLM format
 * Uses segments-based approach for proper message reconstruction
 */
export class ConversationHistoryLoader {
  private compressor = new MessageCompressor();
  private summaryRepo: SummaryRepository;
  private summarizationStrategy?: SummarizationStrategy;

  constructor(
    private conversationRepo: ConversationRepository,
    summarizationStrategy?: SummarizationStrategy
  ) {
    this.summaryRepo = new SummaryRepository();
    this.summarizationStrategy = summarizationStrategy || new LLMSummarizationStrategy();
  }

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
   * Set the summarization strategy
   * 
   * @param strategy - Summarization strategy to use
   */
  setSummarizationStrategy(strategy: SummarizationStrategy): void {
    this.summarizationStrategy = strategy;
  }

  /**
   * Get the summarization strategy
   * 
   * @returns Current summarization strategy or undefined
   */
  getSummarizationStrategy(): SummarizationStrategy | undefined {
    return this.summarizationStrategy;
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
          continue;
        }

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
          content: ' ',  // Use space instead of empty string to avoid empty text blocks
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
            name: segment.tool_call.tool_name === 'textEditor' ? 'str_replace_based_edit_tool' : segment.tool_call.tool_name,
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
  async applyTokenLimit(llmMessages: LLMMessage[], maxTokens: number, modelName?: string): Promise<LLMMessage[]> {
    logger.debug('conversation.history.loader.token_limit_begin', {
      totalMessages: llmMessages.length,
      maxTokens,
      modelName: modelName || 'estimation',
    });

    // Separate summary messages from regular messages
    // Check metadata first, fall back to content prefix for backward compatibility
    const summaryMessages: LLMMessage[] = [];
    const regularMessages: LLMMessage[] = [];

    for (const message of llmMessages) {
      const isSummary =
        (isOpenAIMessage(message) && (message.metadata?.isSummary || message.metadata?.isOperationLog)) ||
        (message.role === 'user' &&
         typeof message.content === 'string' &&
         (message.content.startsWith('[CONVERSATION SUMMARY]') || message.content.startsWith('[OPERATION LOG')));

      if (isSummary) {
        summaryMessages.push(message);
      } else {
        regularMessages.push(message);
      }
    }

    const limitedMessages: LLMMessage[] = [];
    let currentTokenCount = 0;

    // Resolve the token model once for use throughout the function
    const tokenModel = modelName || DEFAULT_TOKEN_COUNTING_MODEL;

    // First, always include all summary messages (they're highly compressed)
    for (const message of summaryMessages) {
      const messageContent = this.serializeMessageForTokenCount(message);
      const messageTokens = (await countTokens(messageContent, tokenModel)).tokenCount;

      // SAFETY CHECK: Warn if summary exceeds 50% of token limit
      if (messageTokens > maxTokens * 0.5) {
        logger.warn('conversation.history.summary_too_large', {
          summaryTokens: messageTokens,
          maxTokens,
          percentageOfLimit: Math.round((messageTokens / maxTokens) * 100),
          recommendation: 'Consider increasing maxTokens or forcing full re-summarization',
        });
      }

      limitedMessages.push(message);
      currentTokenCount += messageTokens;
    }

    logger.debug('conversation.history.loader.token_limit_summaries_included', {
      summaryCount: summaryMessages.length,
      summaryTokens: currentTokenCount,
    });

    // Then, add recent messages from the end until we hit the token limit
    for (let i = regularMessages.length - 1; i >= 0; i--) {
      const message = regularMessages[i];
      if (!message) continue;
      const messageContent = this.serializeMessageForTokenCount(message);
      const messageTokens = (await countTokens(messageContent, tokenModel)).tokenCount;

      if (currentTokenCount + messageTokens > maxTokens && limitedMessages.length > summaryMessages.length) {
        logger.info('conversation.history.loader.token_limit_reached', {
          processedMessages: limitedMessages.length,
          summaryMessages: summaryMessages.length,
          regularMessages: limitedMessages.length - summaryMessages.length,
          currentTokens: currentTokenCount,
          maxTokens,
          droppedMessages: i + 1,
        });
        break;
      }

      limitedMessages.push(message);
      currentTokenCount += messageTokens;
    }

    // Sort to maintain chronological order (summaries first, then recent messages)
    // Summary messages stay at the beginning, regular messages are added at the end
    const finalMessages = [
      ...summaryMessages,
      ...limitedMessages.slice(summaryMessages.length).reverse()
    ];

    logger.debug('conversation.history.loader.token_limit_complete', {
      inputMessages: llmMessages.length,
      outputMessages: finalMessages.length,
      summaryMessages: summaryMessages.length,
      regularMessages: finalMessages.length - summaryMessages.length,
      estimatedTokens: currentTokenCount,
      maxTokens,
    });

    return finalMessages;
  }

  /**
   * Serialize an LLM message to string for token counting
   * Includes content, tool calls, and tool results
   */
  private serializeMessageForTokenCount(message: LLMMessage): string {
    let serialized = getMessageContent(message);

    if (isOpenAIMessage(message) && message.tool_calls && message.tool_calls.length > 0) {
      serialized += '\n[Tool Calls]\n';
      for (const toolCall of message.tool_calls) {
        serialized += `${toolCall.function.name}: ${toolCall.function.arguments}\n`;
      }
    }

    if (message.role === 'tool') {
      if (isAIToolMessage(message)) {
        const toolResult = message.content[0];
        serialized += `\n[Tool Result: ${toolResult?.toolName}]\n${getMessageContent(message)}`;
      } else if (isOpenAIMessage(message)) {
        serialized += `\n[Tool Result: ${message.name}]\n${message.content}`;
      }
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
      const compressionResult = this.compressor.compressMessages(llmMessages);
      llmMessages = compressionResult.messages;

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

    return await this.applyTokenLimit(llmMessages, maxTokens, modelName);
  }

  /**
   * Load messages with compression and token limit applied for a specific app
   * This loads history across all conversations for the app, ensuring continuity
   * @param appId - ID of the app
   * @param maxTokens - Maximum tokens to include (default: 40000)
   * @param modelName - Model name for accurate token counting
   * @param enableCompression - Whether to apply compression (default: true)
   * @returns Token-limited array of LLM messages
   */
  async loadMessagesWithTokenLimitByAppId(
    appId: string,
    maxTokens: number = 40000,
    modelName?: string,
    enableCompression: boolean = true
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
      const compressionResult = this.compressor.compressMessages(llmMessages);
      llmMessages = compressionResult.messages;

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

    return await this.applyTokenLimit(llmMessages, maxTokens, modelName);
  }

  /**
   * Load messages with summarization, compression, and token limit applied
   * Checks for existing summaries and replaces message ranges with summary messages
   *
   * @param appId - ID of the app
   * @param maxTokens - Maximum tokens to include (default: 40000)
   * @param modelName - Model name for accurate token counting
   * @param enableCompression - Whether to apply compression (default: true)
   * @param enableSummarization - Whether to use summaries (default: true)
   * @returns Token-limited array of LLM messages with summaries injected
   */
  async loadMessagesWithSummarization(
    appId: string,
    maxTokens: number = 40000,
    modelName?: string,
    enableCompression: boolean = true,
    enableSummarization: boolean = true
  ): Promise<ConversationHistoryWithSummary> {
    logger.debug('conversation.history.loader.load_with_summarization.begin', {
      appId,
      enableSummarization,
    });

    // OPTIMIZATION: Check for summary FIRST before loading messages
    // If summary exists, only load messages after the summary's end point
    // This avoids loading potentially thousands of old messages from the database
    let latestSummary: ConversationSummary | null = null;
    let messagesAfterSummary: DatabaseMessage[] = [];

    if (enableSummarization && this.summarizationStrategy) {
      latestSummary = await this.summaryRepo.findLatestForApp(appId);

      if (latestSummary) {
        // Only load messages AFTER the summary's end point
        messagesAfterSummary = await this.conversationRepo.getMessagesAfterMessageId(
          appId,
          latestSummary.messageRangeEnd
        );

        // STALE SUMMARY DETECTION: If no messages returned, verify the reference still exists
        // This handles edge cases where conversation messages were deleted/migrated but summary remains
        // The extra getMessageById call only happens when messagesAfterSummary is empty, which is
        // the less common case (most loads have new messages since the last summary)
        if (messagesAfterSummary.length === 0) {
          const refExists = await this.conversationRepo.getMessageById(latestSummary.messageRangeEnd);
          if (!refExists) {
            // Reference message missing - summary is stale, fall back to loading all
            logger.warn('conversation.history.loader.summary_ref_missing', {
              appId,
              summaryId: latestSummary.id,
              messageRangeEnd: latestSummary.messageRangeEnd,
            });
            latestSummary = null;
          }
          // If refExists but no new messages, that's fine - we just have summary + 0 new messages
        }

        if (latestSummary) {
          logger.debug('conversation.history.loader.summary_optimized_load', {
            appId,
            summaryId: latestSummary.id,
            messagesAfterSummary: messagesAfterSummary.length,
            skippedMessages: latestSummary.messageCount ?? 'unknown',
          });
        }
      }
    }

    // Fall back to loading all messages if no valid summary
    let allMessages: DatabaseMessage[];
    if (latestSummary) {
      // Use only messages after summary
      allMessages = messagesAfterSummary;
    } else {
      // No summary - load all messages
      const conversations = await this.conversationRepo.getByAppId(appId);
      allMessages = [];

      for (const conversation of conversations) {
        const messages = await this.conversationRepo.getMessagesForHistory(conversation.id);
        allMessages.push(
          ...messages.map((msg) => ({
            ...msg,
            conversationId: conversation.id,
          }))
        );
      }

      logger.debug('conversation.history.loader.full_load', {
        appId,
        conversationsCount: conversations.length,
        totalMessages: allMessages.length,
      });
    }

    allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Build LLM messages for conversation history
    // Summary is injected as cacheable user messages (NOT system prompt) for security
    // User-derived content should never be elevated to system prompt privilege
    const llmMessages: LLMMessage[] = [];

    if (latestSummary) {
      // Add operation log first (if available) - provides cumulative record of all operations
      // This survives compression and ensures the agent sees what files were touched
      // SECURITY: Injected as user message to prevent prompt injection via system prompt
      if (latestSummary.operationLog) {
        llmMessages.push({
          role: 'user',
          content: `[OPERATION LOG - Cumulative record of all work done]\n${latestSummary.operationLog}`,
          metadata: { isOperationLog: true },
        });
      }

      // Add summary as user message with cache control
      // SECURITY: User-derived summaries must remain as user messages, not system prompts
      // System prompts have higher privilege and could enable prompt injection attacks
      // The latest summary contains the full cumulative summary text. Incremental summarization
      // updates this summary by including only new messages since the last summary, so the latest
      // summary alone provides complete historical context without duplication.
      llmMessages.push({
        role: 'user',
        content: `[CONVERSATION SUMMARY]\n${latestSummary.summaryText}`,
        metadata: { isSummary: true },
        cachePoint: { type: 'ephemeral' },
      });

      logger.debug('conversation.history.loader.summary_applied', {
        appId,
        summaryId: latestSummary.id,
        summaryTokens: latestSummary.summaryTokenCount,
        originalTokens: latestSummary.originalTokenCount,
        messagesAfterSummary: allMessages.length,
      });
    }

    // Add all messages (when no summary) or messages after summary (when summary exists)
    // allMessages already contains only the relevant messages based on summary check above
    for (const dbMsg of allMessages) {
      const converted = this.convertToLLMMessages([dbMsg]);
      llmMessages.push(...converted);
    }

    logger.debug('conversation.history.loader.load_with_summarization.complete', {
      appId,
      hasSummary: !!latestSummary,
      totalMessages: allMessages.length,
      llmMessagesCount: llmMessages.length,
    });

    let compressedMessages = llmMessages;

    // Apply compression strategies based on summarization status
    if (latestSummary) {
      // When summarization is active, only run removal strategies for correctness
      // (removes stale app context, todoList entries, etc.)
      const removalResult = this.compressor.compressMessages(llmMessages, 'removal');
      compressedMessages = removalResult.messages;

      logger.info('conversation.history.removal_only.applied', {
        appId,
        reason: 'summarization_active',
        originalMessages: removalResult.stats.totalMessages,
        afterRemoval: removalResult.messages.length,
        removedMessages: removalResult.stats.totalMessages - removalResult.messages.length,
        strategiesUsed: removalResult.stats.strategiesUsed,
      });
    } else if (enableCompression) {
      // When summarization is not active, run all compression strategies
      const compressionResult = this.compressor.compressMessages(llmMessages);
      compressedMessages = compressionResult.messages;

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

    const limitedMessages = await this.applyTokenLimit(compressedMessages, maxTokens, modelName);
    // Summary is now injected as user messages in the history, not returned separately
    // This prevents user-derived content from being elevated to system prompt privilege
    return { messages: limitedMessages };
  }

  /**
   * Load messages with compression and token limit applied for a specific conversation
   * This should be used when you have a conversationId (e.g., during agent handoffs)
   * @param conversationId - ID of the conversation
   * @param maxTokens - Maximum tokens to include (default: 40000)
   * @param modelName - Model name for accurate token counting
   * @param enableCompression - Whether to apply compression (default: true)
   * @returns Token-limited array of LLM messages
   */
  async loadMessagesWithTokenLimitByConversationId(
    conversationId: string,
    maxTokens: number = 40000,
    modelName?: string,
    enableCompression: boolean = true
  ): Promise<LLMMessage[]> {
    const dbMessages = await this.loadDatabaseMessagesByConversationId(conversationId);
    let llmMessages = this.convertToLLMMessages(dbMessages);

    if (enableCompression) {
      const compressionResult = this.compressor.compressMessages(llmMessages);
      llmMessages = compressionResult.messages;

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

    return await this.applyTokenLimit(llmMessages, maxTokens, modelName);
  }

  /**
   * Format LLM messages for AI SDK ConversationMessage format
   * AI SDK v6 supports ModelMessage union type including ToolModelMessage
   * Converts tool results to AI SDK v6 format with tool-result parts
   * @param llmMessages - Array of LLM messages from loadMessagesWithTokenLimit
   * @param appId - App ID for logging
   * @param agentId - Agent ID for logging
   * @returns Array formatted for AI SDK with tool messages in v6 ModelMessage format
   */
  formatMessagesForAISDK(
    llmMessages: LLMMessage[],
    appId: string,
    agentId: string
  ): Array<ModelMessage> {
    let formattedMessages: ModelMessage[] = [];
    
    for (let i = 0; i < llmMessages.length; i++) {
      const msg = llmMessages[i];
      if (!msg) continue;

      // Convert tool messages to AI SDK v6 ToolModelMessage format
      if (msg.role === 'tool') {
        // Normalize AI SDK v6 tool message into canonical ToolModelMessage format for type safety
        if (isAIToolMessage(msg)) {
          const toolResult = msg.content[0];
          const content = getMessageContent(msg);
          if (!content || content.trim() === '') {
            logger.warn('conversation.history.loader.skipping_empty_tool_message', {
              appId,
              agentId,
              toolCallId: toolResult?.toolCallId,
              toolName: toolResult?.toolName
            });
            continue;
          }
          // Convert to AI SDK ToolModelMessage to ensure type compatibility
          const toolMessage: ToolModelMessage = {
            role: 'tool',
            content: [{
              type: 'tool-result',
              toolCallId: toolResult?.toolCallId ?? '',
              toolName: toolResult?.toolName ?? '',
              output: {
                type: 'text',
                value: content
              }
            }]
          };
          formattedMessages.push(toolMessage);
          continue;
        }

        // Handle OpenAI format tool messages
        if (isOpenAIMessage(msg)) {
          // Skip tool messages with empty content
          if (!msg.content || msg.content.trim() === '') {
            logger.warn('conversation.history.loader.skipping_empty_tool_message', {
              appId,
              agentId,
              toolCallId: msg.tool_call_id,
              toolName: msg.name
            });
            continue;
          }

          // Skip tool messages without required IDs
          if (!msg.tool_call_id || !msg.name) {
            logger.warn('conversation.history.loader.skipping_tool_message_missing_ids', {
              appId,
              agentId,
              toolCallId: msg.tool_call_id,
              toolName: msg.name,
              reason: 'Tool message missing required tool_call_id or name'
            });
            continue;
          }

          const toolMessage: ToolModelMessage = {
            role: 'tool',
            content: [{
              type: 'tool-result',
              toolCallId: msg.tool_call_id,
              toolName: msg.name,
              output: {
                type: 'text',
                value: msg.content
              }
            }]
          };
          formattedMessages.push(toolMessage);
          continue;
        }
      }
      
      // Handle system messages
      if (msg.role === 'system') {
        // Skip empty system messages
        if (!msg.content || msg.content.trim() === '') {
          continue;
        }
        const systemMessage: SystemModelMessage = {
          role: 'system',
          content: msg.content,
          ...(msg.cachePoint ? {
            providerOptions: {
              anthropic: { cacheControl: { type: msg.cachePoint.type } },
              bedrock: { cachePoint: msg.cachePoint.type }
            }
          } : {})
        };
        formattedMessages.push(systemMessage);
        continue;
      }
      
      // Handle assistant messages with tool calls
      if (msg.role === 'assistant') {
        // Skip empty assistant messages without tool calls
        if ((!msg.content || msg.content.trim() === '') && (!msg.tool_calls || msg.tool_calls.length === 0)) {
          continue;
        }
        
        // Convert tool_calls to content array format (AI SDK v6)
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const contentParts: any[] = [];
          
          // Add text content if present
          if (msg.content && msg.content.trim()) {
            contentParts.push({
              type: 'text',
              text: msg.content
            });
          }
          
          // Add tool calls as ToolCallPart objects
          for (const toolCall of msg.tool_calls) {
            let parsedArgs;
            try {
              parsedArgs = JSON.parse(toolCall.function.arguments);
            } catch (error) {
              logger.warn('conversation.history.loader.tool_call_parse_error', {
                appId,
                agentId,
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
                arguments: toolCall.function.arguments,
                error: error instanceof Error ? error.message : String(error)
              });
              parsedArgs = {};
            }
            
            contentParts.push({
              type: 'tool-call',
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              input: parsedArgs  // ← Must be 'input', not 'args' (per AI SDK v6 ToolCallPart specification)
            });
          }
          
          const assistantMessage: AssistantModelMessage = {
            role: 'assistant',
            content: contentParts,
            ...(msg.cachePoint ? {
              providerOptions: {
                anthropic: { cacheControl: { type: msg.cachePoint.type } },
                bedrock: { cachePoint: msg.cachePoint.type }
              }
            } : {})
          };
          formattedMessages.push(assistantMessage);
          continue;
        }
        
        // Assistant message without tool calls - just text
        const content = (msg.content && msg.content.trim()) ? msg.content : ' ';
        const assistantMessage: AssistantModelMessage = {
          role: 'assistant',
          content,
          ...(msg.cachePoint ? {
            providerOptions: {
              anthropic: { cacheControl: { type: msg.cachePoint.type } },
              bedrock: { cachePoint: msg.cachePoint.type }
            }
          } : {})
        };
        formattedMessages.push(assistantMessage);
        continue;
      }
      
      // Handle user messages
      if (msg.role === 'user') {
        // Skip empty user messages
        if (!msg.content || msg.content.trim() === '') {
          continue;
        }
        const userMessage: UserModelMessage = {
          role: 'user',
          content: msg.content,
          ...(msg.cachePoint ? {
            providerOptions: {
              anthropic: { cacheControl: { type: msg.cachePoint.type } },
              bedrock: { cachePoint: msg.cachePoint.type }
            }
          } : {})
        };
        formattedMessages.push(userMessage);
        continue;
      }
    }
    
    // Strip out tool calls that don't have corresponding tool results
    // This handles failed tool calls that never got a result saved
    const toolResultIds = new Set<string>();
    for (const msg of formattedMessages) {
      if (msg.role === 'tool') {
        const content = (msg as ToolModelMessage).content;
        if (Array.isArray(content) && content[0]) {
          const firstPart = content[0];
          if ('toolCallId' in firstPart) {
            toolResultIds.add(firstPart.toolCallId);
          }
        }
      }
    }
    
    // Filter out tool calls without matching results
    let strippedToolCallCount = 0;
    for (let i = 0; i < formattedMessages.length; i++) {
      const msg = formattedMessages[i];
      if (!msg || msg.role !== 'assistant') continue;
      
      const content = (msg as AssistantModelMessage).content;
      if (Array.isArray(content)) {
        const originalLength = content.length;
        const filteredContent = content.filter((part: any) => {
          if (part.type === 'tool-call') {
            const hasResult = toolResultIds.has(part.toolCallId);
            if (!hasResult) {
              strippedToolCallCount++;
              logger.warn('conversation.history.loader.stripping_tool_call_without_result', {
                appId,
                agentId,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                reason: 'Tool call has no corresponding tool result (likely failed execution)'
              });
            }
            return hasResult;
          }
          return true;
        });
        
        // Update the message content if we filtered out any tool calls
        if (filteredContent.length !== originalLength) {
          (msg as AssistantModelMessage).content = filteredContent;
        }
      }
    }
    
    if (strippedToolCallCount > 0) {
      logger.info('conversation.history.loader.stripped_orphaned_tool_calls', {
        appId,
        agentId,
        count: strippedToolCallCount,
        reason: 'Removed tool calls without matching results to maintain message validity'
      });
    }

    // Filter out assistant messages with empty content arrays (can happen after stripping orphaned tool calls)
    formattedMessages = formattedMessages.filter(msg => {
      if (msg.role !== 'assistant') return true;
      const content = (msg as AssistantModelMessage).content;
      if (Array.isArray(content) && content.length === 0) {
        logger.warn('conversation.history.loader.skipping_empty_assistant_message', {
          appId,
          agentId,
          reason: 'Assistant message has empty content array after stripping orphaned tool calls'
        });
        return false;
      }
      return true;
    });

    // Strip out tool results that don't have corresponding tool calls
    // This handles cases where token limiting dropped the assistant tool-call message
    // but kept the tool result message (because token limiting processes backwards)
    const toolCallIds = new Set<string>();
    for (const msg of formattedMessages) {
      if (msg.role === 'assistant') {
        const content = (msg as AssistantModelMessage).content;
        if (Array.isArray(content)) {
          content.forEach((part: any) => {
            if (part.type === 'tool-call') {
              toolCallIds.add(part.toolCallId);
            }
          });
        }
      }
    }

    // Filter out orphaned tool results
    const validMessages = formattedMessages.filter(msg => {
      if (msg.role !== 'tool') return true;
      const content = (msg as ToolModelMessage).content;
      if (Array.isArray(content) && content[0]) {
        const firstPart = content[0];
        if ('toolCallId' in firstPart) {
          const hasToolCall = toolCallIds.has(firstPart.toolCallId);
          if (!hasToolCall) {
            logger.warn('conversation.history.loader.stripping_orphaned_tool_result', {
              appId,
              agentId,
              toolCallId: firstPart.toolCallId,
              toolName: 'toolName' in firstPart ? firstPart.toolName : 'unknown',
              reason: 'Tool result has no corresponding tool call (likely dropped during token limiting)'
            });
          }
          return hasToolCall;
        }
      }
      return true;
    });

    const strippedToolResultCount = formattedMessages.length - validMessages.length;
    if (strippedToolResultCount > 0) {
      logger.info('conversation.history.loader.stripped_orphaned_tool_results', {
        appId,
        agentId,
        count: strippedToolResultCount,
        reason: 'Removed tool results without matching tool calls to prevent AI SDK errors'
      });
    }

    // Replace formattedMessages with validMessages
    formattedMessages = validMessages;

    // Count messages with tool calls by checking content array for ToolCallPart objects
    const messagesWithToolCalls = formattedMessages.filter(msg => {
      if (msg.role !== 'assistant') return false;
      const content = (msg as AssistantModelMessage).content;
      if (Array.isArray(content)) {
        return content.some((part: any) => part.type === 'tool-call');
      }
      return false;
    });
    
    // Count total tool calls from content arrays
    const totalToolCalls = messagesWithToolCalls.reduce((sum, msg) => {
      const content = (msg as AssistantModelMessage).content;
      if (Array.isArray(content)) {
        return sum + content.filter((part: any) => part.type === 'tool-call').length;
      }
      return sum;
    }, 0);
    
    const toolResultCount = formattedMessages.filter(msg => msg.role === 'tool').length;
    
    if (messagesWithToolCalls.length > 0 || toolResultCount > 0) {
      logger.info('conversation.history.loader.formatted_for_ai_sdk', {
        appId,
        agentId,
        totalMessages: formattedMessages.length,
        messagesWithToolCalls: messagesWithToolCalls.length,
        totalToolCalls,
        toolResultMessages: toolResultCount
      });
      
      // Debug: Log tool call and result IDs to verify matching
      if (messagesWithToolCalls.length > 0 || toolResultCount > 0) {
        const assistantToolCallIds = messagesWithToolCalls.flatMap(msg => {
          const content = (msg as AssistantModelMessage).content;
          if (Array.isArray(content)) {
            return content
              .filter((part: any) => part.type === 'tool-call')
              .map((part: any) => part.toolCallId);
          }
          return [];
        });
        
        const toolResultIds = formattedMessages
          .filter(msg => msg.role === 'tool')
          .map((msg: any) => {
            if (Array.isArray(msg.content) && msg.content[0]) {
              return msg.content[0].toolCallId;
            }
            return undefined;
          })
          .filter(Boolean);
        
        logger.info('conversation.history.loader.tool_messages_summary', {
          appId,
          agentId,
          assistantWithToolCalls: messagesWithToolCalls.length,
          toolMessages: toolResultCount,
          assistantToolCallIds,
          toolResultIds
        });
      }
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
        name: toolCall.tool_name === 'textEditor' ? 'str_replace_based_edit_tool' : toolCall.tool_name,
        arguments: typeof toolCall.tool_args === 'string' ? toolCall.tool_args : JSON.stringify(toolCall.tool_args),
      },
    };
  }
}
