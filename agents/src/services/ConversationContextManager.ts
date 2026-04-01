import { ConversationRepository } from '../database/repositories/ConversationRepository.js';
import { LLMSummarizationStrategy } from './summarization/index.js';
import { ConversationHistoryLoader } from './ConversationHistoryLoader.js';
import {
  DuplicateFileReadStrategy,
  AppContextRemovalStrategy,
  TodoListRemovalStrategy,
  SecretOperationCompressionStrategy,
  MediaSearchSummaryStrategy,
  ToolResultCompressionStrategy,
} from './compression/strategies/index.js';
import { CssSuggestCompressionStrategy } from './compression/strategies/CssSuggestCompressionStrategy.js';

/**
 * Manages conversation context for LLM interactions
 * Handles loading and formatting conversation history with configurable limits
 */
export class ConversationContextManager {
  private conversationRepo: ConversationRepository;
  private readonly maxMessages: number;
  private historyLoader: ConversationHistoryLoader;

  constructor(conversationRepo: ConversationRepository, maxMessages: number = 10) {
    this.conversationRepo = conversationRepo;
    this.maxMessages = maxMessages;

    // Initialize history loader with LLM summarization strategy
    const summarizationStrategy = new LLMSummarizationStrategy();
    this.historyLoader = new ConversationHistoryLoader(conversationRepo, summarizationStrategy);

    // Note: Background summarization is initialized centrally via initializeBackgroundSummarization()
    // in the server startup code to ensure it uses the singleton conversationRepository

    this.historyLoader.registerCompressionStrategy(new DuplicateFileReadStrategy());
    // Remove all app context entries from history - fresh context is injected before history on every turn
    this.historyLoader.registerCompressionStrategy(new AppContextRemovalStrategy());
    // Remove all todoList entries from history - persistent [Current Todo List] section is the single source of truth
    this.historyLoader.registerCompressionStrategy(new TodoListRemovalStrategy());
    // Annotate secret operation messages to prevent LLM from using stale secret info
    this.historyLoader.registerCompressionStrategy(new SecretOperationCompressionStrategy());
    // Compress verbose cssSuggest results to just palette names
    this.historyLoader.registerCompressionStrategy(new CssSuggestCompressionStrategy());
    // Transform deprecated mediaSearch tool calls to summary text (tool was replaced by media slot tool)
    this.historyLoader.registerCompressionStrategy(new MediaSearchSummaryStrategy());
    // Compress old edit tool results — keep only the most recent, summarize superseded failures
    this.historyLoader.registerCompressionStrategy(new ToolResultCompressionStrategy());
  }

  /**
   * Get the ConversationHistoryLoader instance for direct access
   * @returns ConversationHistoryLoader instance
   */
  getHistoryLoader(): ConversationHistoryLoader {
    return this.historyLoader;
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
