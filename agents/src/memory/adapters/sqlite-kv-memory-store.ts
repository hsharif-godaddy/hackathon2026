import { MemoryRepository } from '../../database/repositories/MemoryRepository.js';
import type { KvMemoryStore } from '../interfaces/kv-memory-store.js';
import type { WorkspaceScope } from '../interfaces/scope.js';

/**
 * SQLite-backed KvMemoryStore adapter.
 * Delegates to MemoryRepository, resolving WorkspaceScope → appId.
 */
export class SqliteKvMemoryStore implements KvMemoryStore {
  constructor(private repo = new MemoryRepository()) {}

  async set(scope: WorkspaceScope, key: string, value: unknown) {
    return this.repo.set(scope.appId, key, value);
  }

  async get(scope: WorkspaceScope, key: string) {
    return this.repo.get(scope.appId, key);
  }

  async listKeys(scope: WorkspaceScope, prefix?: string) {
    return this.repo.listKeys(scope.appId, prefix);
  }

  async delete(scope: WorkspaceScope, key: string) {
    return this.repo.delete(scope.appId, key);
  }

  async search(scope: WorkspaceScope, searchTerm: string, limit?: number) {
    return this.repo.search(scope.appId, searchTerm, limit);
  }

  async getAll(scope: WorkspaceScope) {
    return this.repo.getAll(scope.appId);
  }
}
