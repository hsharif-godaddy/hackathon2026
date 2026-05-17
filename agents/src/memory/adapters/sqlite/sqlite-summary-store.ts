import { SummaryRepository } from '../../../database/repositories/SummaryRepository.js';
import type { SummaryStore } from '../../interfaces/summary-store.js';
import type { SummarizationResult } from '../../../services/summarization/SummarizationStrategy.js';
import type { WorkspaceScope } from '../../interfaces/scope.js';

/**
 * SQLite-backed SummaryStore adapter.
 * Delegates to SummaryRepository, resolving WorkspaceScope → appId.
 */
export class SqliteSummaryStore implements SummaryStore {
  constructor(private repo = new SummaryRepository()) {}

  async create(scope: WorkspaceScope, summary: SummarizationResult, conversationId?: string) {
    return this.repo.create(summary, scope.appId, conversationId);
  }

  async findByAppId(scope: WorkspaceScope) {
    return this.repo.findByAppId(scope.appId);
  }

  async findById(summaryId: string) {
    return this.repo.findById(summaryId);
  }

  async findByMessageRange(startId: string, endId: string) {
    return this.repo.findByMessageRange(startId, endId);
  }

  async findLatestForApp(scope: WorkspaceScope) {
    return this.repo.findLatestForApp(scope.appId);
  }

  async deleteByAppId(scope: WorkspaceScope) {
    return this.repo.deleteByAppId(scope.appId);
  }

  async deleteById(summaryId: string) {
    return this.repo.deleteById(summaryId);
  }
}
