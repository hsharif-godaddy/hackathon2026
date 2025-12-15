import type { LLMMessage } from '../ConversationHistoryLoader.js';

/**
 * Context for summarization operations
 */
export interface SummarizationContext {
  /** ID of the app */
  appId: string;
  /** Messages to summarize */
  messages: LLMMessage[];
  /** Existing summary to update (for incremental summarization) */
  existingSummary?: string;
  /** Range of message IDs being summarized */
  messageRange: { startId: string; endId: string };
  /** Original token count before summarization */
  originalTokenCount: number;
}

/**
 * Result of a summarization operation
 */
export interface SummarizationResult {
  /** The generated summary text */
  summaryText: string;
  /** Token count of the summary */
  summaryTokenCount: number;
  /** Model used for summarization */
  modelUsed: string;
  /** Range of message IDs that were summarized */
  messageRange: { startId: string; endId: string };
  /** Number of messages summarized */
  messageCount: number;
  /** Original token count before summarization */
  originalTokenCount: number;
}

/**
 * Interface for summarization strategies
 * Allows pluggable summarization implementations (LLM-based, test, etc.)
 */
export interface SummarizationStrategy {
  /**
   * Name of the strategy for logging/debugging
   */
  readonly name: string;

  /**
   * Summarize messages according to this strategy
   * 
   * @param context - Context containing messages and metadata
   * @returns Promise resolving to summarization result
   */
  summarize(context: SummarizationContext): Promise<SummarizationResult>;
}

