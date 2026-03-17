import type { LLMMessage } from '../ConversationHistoryLoader.js';
import type { BudgetOverride } from '@airo/ai-grants';

/**
 * Context for summarization operations
 */
export interface SummarizationContext {
  /** ID of the app */
  appId: string;
  /** Session ID (optional, for Langfuse tracking) */
  sessionId?: string;
  /** Budget override from triggering session (E2S care or test-accounts) */
  budgetOverride?: BudgetOverride;
  /**
   * New/unsummarized messages to process.
   * Used for incremental fallbacks when caching isn't available.
   */
  messages: LLMMessage[];
  /**
   * Complete message history (excluding the most recent turns) when available.
   * Enables full-regeneration summaries that rely on prompt caching.
   */
  fullMessageHistory?: LLMMessage[];
  /** Existing summary to update (for incremental summarization) */
  existingSummary?: string;
  /** Range of message IDs being summarized */
  messageRange: { startId: string; endId: string };
  /** Token count for the full message history represented by the summary */
  originalTokenCount: number;
  /** Token count for the newly added messages (incremental delta) */
  incrementalTokenCount?: number;
  /**
   * Structured operation log extracted from all messages (including compressed ones).
   * This provides a cumulative record of operations that survives compression.
   */
  operationLog?: string;
  /** Number of times the summary has been incrementally updated */
  incrementalUpdateCount?: number;
  /** ISO timestamp when summary was last fully regenerated from scratch */
  lastFullSummarizationAt?: string;
  /** When true, strategies must not enter the full-regeneration codepath */
  disableFullRegeneration?: boolean;
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
  /**
   * Cumulative operation log extracted from all messages.
   * This survives compression and provides visibility into what was done.
   */
  operationLog?: string;
  /** Number of times the summary has been incrementally updated */
  incrementalUpdateCount?: number;
  /** ISO timestamp when summary was last fully regenerated from scratch */
  lastFullSummarizationAt?: string;
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
