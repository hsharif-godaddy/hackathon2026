import type { ConversationMessage, ToolCall, MessageSegment } from '../database/schema.js';
import { ConversationRepository } from '../database/repositories/ConversationRepository.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { AppContextManager } from './AppContextManager.js';
import { TodoContextManager } from './TodoContextManager.js';
import type { AgentExecutionContext } from '../base/agent.interface.js';
import { ToolCallRenderer } from './ToolCallRenderer.js';
import { logger } from '../logging/index.js';
import { conversationContextEvents, conversationHistoryEvents, conversationTokenLimitEvents } from '../logging/events/index.js';
import { countTokens, estimateTokens } from '../utils/token-counter.js';
import { ConversationHistoryLoader } from './ConversationHistoryLoader.js';
import {
  HotFileInclusionStrategy,
  FileEditCompressionStrategy,
  FileEditInputCompressionStrategy,
  DuplicateFileReadStrategy,
  TodoListRemovalStrategy,
} from './compression/strategies/index.js';
import { CssSuggestCompressionStrategy } from './compression/strategies/CssSuggestCompressionStrategy.js';
import { ContextFormatter } from './helpers/ContextFormatter.js';

/**
 * LLM message format for OpenAI-style APIs
 */
interface LLMMessage {
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
 * Manages conversation context for LLM interactions
 * Handles loading and formatting conversation history with configurable limits
 */
export class ConversationContextManager {
  private conversationRepo: ConversationRepository;
  private readonly maxMessages: number;
  private appContextManager: AppContextManager;
  private todoContextManager: TodoContextManager;
  private historyLoader: ConversationHistoryLoader;

  constructor(conversationRepo: ConversationRepository, maxMessages: number = 10) {
    this.conversationRepo = conversationRepo;
    this.maxMessages = maxMessages;
    this.appContextManager = new AppContextManager();
    this.todoContextManager = new TodoContextManager();
    
    this.historyLoader = new ConversationHistoryLoader(conversationRepo);
    
    const hotFileStrategy = new HotFileInclusionStrategy();
    const fileEditStrategy = new FileEditCompressionStrategy(hotFileStrategy);
    const fileEditInputStrategy = new FileEditInputCompressionStrategy(hotFileStrategy);
    const duplicateFileReadStrategy = new DuplicateFileReadStrategy(hotFileStrategy);
    
    this.historyLoader.registerCompressionStrategy(hotFileStrategy);
    this.historyLoader.registerCompressionStrategy(duplicateFileReadStrategy);
    this.historyLoader.registerCompressionStrategy(fileEditStrategy);
    this.historyLoader.registerCompressionStrategy(fileEditInputStrategy);
    // Remove all todoList entries from history - persistent [Current Todo List] section is the single source of truth
    this.historyLoader.registerCompressionStrategy(new TodoListRemovalStrategy());
    // Compress cssSuggest results to only show palette names
    this.historyLoader.registerCompressionStrategy(new CssSuggestCompressionStrategy());
  }

  /**
   * Get the ConversationHistoryLoader instance for direct access
   * @returns ConversationHistoryLoader instance
   */
  getHistoryLoader(): ConversationHistoryLoader {
    return this.historyLoader;
  }


  /**
   * Build LLM messages array with conversation history
   * @param systemPrompt - The system prompt to include
   * @param currentUserMessage - The current user message
   * @param conversationId - ID of the conversation to load history from
   * @param aiEditContext - Optional AI edit context for selected elements
   * @param executionContext - Optional execution context for app context generation
   * @param selectedTodoListId - Optional ID of the currently selected todo list
   * @returns Array of messages formatted for LLM API
   */
  async buildMessages(
    systemPrompt: string,
    currentUserMessage: string,
    conversationId?: string,
    aiEditContext?: any,
    executionContext?: AgentExecutionContext,
    selectedTodoListId?: string
  ): Promise<LLMMessage[]> {
    // Validate inputs
    if (!systemPrompt || systemPrompt.trim() === '') {
      throw new Error('System prompt cannot be empty');
    }
    if (!currentUserMessage || currentUserMessage.trim() === '') {
      throw new Error('Current user message cannot be empty');
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt.trim() }
    ];

    // Load conversation history if we have a conversation ID
    // Use compressed token-limited loader for efficiency
    if (conversationId) {
      const historyMessages = await this.loadConversationHistoryCompressed(conversationId, executionContext);
      messages.push(...historyMessages);
    }

    // Add app context (directory listing) before AI edit context if execution context is available
    if (executionContext) {
      const appContextMessage = await this.appContextManager.generateContextMessage(executionContext);
      if (appContextMessage) {
        messages.push({ role: 'user', content: appContextMessage });
      }
    }

    // Add todo list context as a separate message (always, even if no list selected)
    if (executionContext) {
      const todoContextMessage = await this.todoContextManager.generateTodoContext(
        executionContext,
        selectedTodoListId
      );
      if (todoContextMessage) {
        messages.push({ role: 'user', content: todoContextMessage });
      }
    }

    // Add AI edit context as a separate user message if available
    if (aiEditContext) {
      const formatted = ContextFormatter.formatAiEditContext(aiEditContext);
      if (formatted) {
        messages.push({ role: 'user', content: formatted.content });
      }
    }

    // Add visual context as a separate user message if available
    if (executionContext?.metadata?.visualContext) {
      const formatted = ContextFormatter.formatVisualContext(executionContext.metadata.visualContext);
      if (formatted) {
        messages.push({ role: 'user', content: formatted.content });
      }
    }

    // Add selected assets context as a separate user message if available
    if (executionContext?.metadata?.selectedAssets) {
      const formatted = await ContextFormatter.formatSelectedAssets(executionContext.metadata.selectedAssets);
      if (formatted) {
        messages.push({ role: 'user', content: formatted.content });
      }
    }

    // Add the current user message
    messages.push({ role: 'user', content: currentUserMessage.trim() });

    // Final validation - ensure no message has empty content
    const validatedMessages = messages.filter(msg => {
      if (!msg.content || msg.content.trim() === '') {
        logger.warn('conversation.context.empty_message_filtered', {
          role: msg.role,
          hasToolCalls: !!(msg as any).tool_calls,
          hasToolCallId: !!(msg as any).tool_call_id
        });
        return false;
      }
      return true;
    });

    if (validatedMessages.length === 0) {
      throw new Error('All messages filtered out due to empty content');
    }

    // Structured logging
    const hasAppContext = executionContext && validatedMessages.some(msg => msg.content?.startsWith('[Current Project Structure]'));
    const hasTodoContext = !!(executionContext && validatedMessages.some(msg => msg.content?.startsWith('[Current Todo List]')));
    conversationContextEvents.buildSuccess(logger, {
      conversationId,
      totalMessages: validatedMessages.length,
      systemPromptLength: systemPrompt.length,
      currentMessageLength: currentUserMessage.length,
      hasHistory: !!conversationId && validatedMessages.length > 2,
      hasAppContext,
      hasTodoContext,
      hasAiEditContext: !!aiEditContext,
      hasVisualContext: !!executionContext?.metadata?.visualContext,
      hasSelectedAssets: !!(executionContext?.metadata?.selectedAssets && (executionContext.metadata.selectedAssets as any[]).length > 0)
    });

    return validatedMessages;
  }

  /**
   * Load conversation history with compression and token limiting
   * @param conversationId - ID of the conversation
   * @param executionContext - Execution context containing appId for app path lookup
   * @returns Array of LLMMessage messages from conversation history
   */
  private async loadConversationHistoryCompressed(
    conversationId: string,
    executionContext?: AgentExecutionContext
  ): Promise<LLMMessage[]> {
    const appId = executionContext?.metadata?.appId as string | undefined;
    
    if (!appId) {
      logger.warn('conversation.history.missing_app_id', { 
        conversationId, 
        message: 'Cannot load compressed history without appId for app path lookup'
      });
      return [];
    }
    
    const appRepo = new AppRepository();
    const app = appRepo.findById(appId);
    const appPath = app?.path;

    const maxTokens = 40000;
    
    try {
      const llmMessages = await this.historyLoader.loadMessagesWithTokenLimitByAppId(
        appId,
        maxTokens,
        undefined,
        true,
        appPath
      );
      
      logger.debug('conversation.history.compressed.loaded', {
        appId,
        messageCount: llmMessages.length,
      });
      
      return llmMessages;
    } catch (error) {
      logger.error('conversation.history.compressed.load_failure', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get conversation summary for debugging
   */
  async getConversationSummary(conversationId: string): Promise<{
    totalMessages: number;
    recentMessages: number;
    messageTypes: Record<string, number>;
  }> {
    const allMessages = await this.conversationRepo.getMessages(conversationId);
    const recentMessages = allMessages.slice(-(this.maxMessages * 2));

    const messageTypes: Record<string, number> = {};
    for (const message of allMessages) {
      messageTypes[message.sender] = (messageTypes[message.sender] || 0) + 1;
    }

    return {
      totalMessages: allMessages.length,
      recentMessages: recentMessages.length,
      messageTypes
    };
  }
}