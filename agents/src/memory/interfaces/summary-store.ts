import type { ConversationSummary } from '../../database/schema.js';
import type { SummarizationResult } from '../../services/summarization/SummarizationStrategy.js';
import type { WorkspaceScope } from './scope.js';

/**
 * Store for conversation summaries used by the summarization pipeline.
 */
export interface SummaryStore {
  create(scope: WorkspaceScope, summary: SummarizationResult, conversationId?: string): Promise<ConversationSummary>;
  findByAppId(scope: WorkspaceScope): Promise<ConversationSummary[]>;
  findById(summaryId: string): Promise<ConversationSummary | null>;
  findByMessageRange(startId: string, endId: string): Promise<ConversationSummary | null>;
  findLatestForApp(scope: WorkspaceScope): Promise<ConversationSummary | null>;
  deleteByAppId(scope: WorkspaceScope): Promise<void>;
  deleteById(summaryId: string): Promise<void>;
}
