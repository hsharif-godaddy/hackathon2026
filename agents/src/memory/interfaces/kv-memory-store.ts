import type { Memory } from '../../database/schema.js';
import type { WorkspaceScope } from './scope.js';

/**
 * Hierarchical key-value store for per-app agent memory.
 *
 * All methods accept a WorkspaceScope so that remote adapters
 * can resolve tenancy from customerId when available.
 */
export interface KvMemoryStore {
  set(scope: WorkspaceScope, key: string, value: unknown): Promise<{ success: boolean; error?: string }>;

  get(scope: WorkspaceScope, key: string): Promise<{ success: boolean; value?: unknown; exists: boolean; error?: string }>;

  listKeys(scope: WorkspaceScope, prefix?: string): Promise<{ success: boolean; keys: string[]; error?: string }>;

  delete(scope: WorkspaceScope, key: string): Promise<{ success: boolean; error?: string }>;

  search(
    scope: WorkspaceScope,
    searchTerm: string,
    limit?: number
  ): Promise<{
    success: boolean;
    results: Array<{ key: string; value: unknown; score?: number }>;
    error?: string;
  }>;

  getAll(scope: WorkspaceScope): Promise<{ success: boolean; memories: Memory[]; error?: string }>;
}
