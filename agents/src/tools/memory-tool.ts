import { logger } from '../logging/index.js';
import { toolMemoryEvents } from '../logging/events/index.js';
import { AppRepository } from '../database/index.js';
import { getKvMemoryStore } from '../memory/adapters/index.js';
import type { KvMemoryStore } from '../memory/interfaces/index.js';
import { workspaceScopeFromAppId } from '../memory/interfaces/scope.js';

export interface MemorySetOptions {
  /** Dot-delimited hierarchical key (e.g., 'user.preferences.theme' or 'app.config.database.host') */
  key: string;
  /** Value to store - can be JSON object/array or plain text string */
  value: unknown;
}

export interface MemoryReadOptions {
  /** Dot-delimited hierarchical key to read */
  key: string;
}

export interface MemorySearchOptions {
  /** Search query for semantic similarity */
  query: string;
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum similarity score threshold (0-1, default: 0.7) */
  score_threshold?: number;
}

export interface MemorySetResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The key that was set */
  key: string;
  /** Error message if operation failed */
  error?: string;
}

export interface MemoryReadResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The key that was requested */
  key: string;
  /** The value retrieved (parsed JSON if it was JSON, otherwise string) */
  value?: unknown;
  /** Whether the key exists */
  exists: boolean;
  /** Error message if operation failed */
  error?: string;
}

export interface MemorySearchResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Search results with similarity scores */
  results?: Array<{
    key: string;
    value: unknown;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Tool for hierarchical key-value memory storage within an app context
 * Supports dot-delimited keys and both JSON and plain text values
 * Now uses SQLite database for persistence instead of filesystem
 */
export class MemoryTool {
  private readonly logger = logger.child({ module: 'MemoryTool' });
  private readonly appRepository = new AppRepository();

  constructor(private kvMemoryStore: KvMemoryStore = getKvMemoryStore()) {}

  private mapValueType(value: unknown): 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    const jsType = typeof value;
    if (jsType === 'object') return 'object';
    if (jsType === 'string' || jsType === 'number' || jsType === 'boolean') return jsType;
    return 'string'; // fallback for bigint, symbol, etc.
  }

  /**
   * Get the appId from the appPath using AppRepository
   */
  private getAppIdFromPath(appPath: string): string | null {
    const app = this.appRepository.findByPath(appPath);
    return app?.id || null;
  }

  /**
   * Validate key format and security
   */
  private validateKey(key: string): { valid: boolean; error?: string } {
    // Basic format validation
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      return { valid: false, error: 'Key must be a non-empty string' };
    }

    // Character validation - only allow alphanumeric, dots, underscores, hyphens
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
      return { valid: false, error: 'Key can only contain letters, numbers, dots, underscores, and hyphens' };
    }

    // Security check: prevent path traversal patterns
    if (key.includes('..') || key.includes('/') || key.includes('\\')) {
      return { valid: false, error: 'Key contains invalid path traversal characters' };
    }

    // Ensure key doesn't start or end with dots (could be problematic)
    if (key.startsWith('.') || key.endsWith('.')) {
      return { valid: false, error: 'Key cannot start or end with a dot' };
    }

    return { valid: true };
  }


  /**
   * Set a value in memory with a hierarchical key
   */
  async setMemory(options: MemorySetOptions, appPath: string, appId?: string, customerId?: string): Promise<MemorySetResult> {
    const startTime = Date.now();
    const { key, value } = options;

    // Resolve appId if not provided
    const resolvedAppId = appId || this.getAppIdFromPath(appPath);
    if (!resolvedAppId) {
      return {
        success: false,
        key,
        error: 'App not found for the given path'
      };
    }
    
    // Log operation start
    toolMemoryEvents.setBegin(this.logger, {
      toolName: 'memory',
      appId: resolvedAppId,
      key,
      valueType: this.mapValueType(value),
    });

    try {
      // Validate key format and security
      const keyValidation = this.validateKey(key);
      if (!keyValidation.valid) {
        return {
          success: false,
          key: key || '',
          error: keyValidation.error || 'Invalid key format',
        };
      }

      // Store in SQLite database
      const dbResult = await this.kvMemoryStore.set(workspaceScopeFromAppId(resolvedAppId, customerId), key, value);
      if (!dbResult.success) {
        return {
          success: false,
          key,
          error: dbResult.error || 'Failed to store in database'
        };
      }

      const duration = Date.now() - startTime;
      const resultData = {
        toolName: 'memory',
        appId: resolvedAppId,
        key,
        operation: 'set' as const,
        valueType: this.mapValueType(value),
        resultStats: {
          success: true,
          executionTime: duration,
        },
      };

      // Log successful operation
      toolMemoryEvents.setSuccess(this.logger, resultData);

      return {
        success: true,
        key,
      };
    } catch (error) {
      // Log failed operation
      toolMemoryEvents.setFailure(this.logger, error instanceof Error ? error : new Error(String(error)), {
        toolName: 'memory',
        appId: resolvedAppId,
        key,
        operation: 'set',
      });

      return {
        success: false,
        key: options.key || '',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Read a value from memory using a hierarchical key
   */
  async readMemory(options: MemoryReadOptions, appPath: string, appId?: string, customerId?: string): Promise<MemoryReadResult> {
    const startTime = Date.now();
    const { key } = options;

    // Resolve appId if not provided
    const resolvedAppId = appId || this.getAppIdFromPath(appPath);
    if (!resolvedAppId) {
      return {
        success: false,
        key,
        exists: false,
        error: 'App not found for the given path'
      };
    }
    
    // Log operation start
    toolMemoryEvents.readBegin(this.logger, {
      toolName: 'memory',
      appId: resolvedAppId,
      key,
    });

    try {
      // Validate key format and security
      const keyValidation = this.validateKey(key);
      if (!keyValidation.valid) {
        return {
          success: false,
          key: key || '',
          exists: false,
          error: keyValidation.error || 'Invalid key format',
        };
      }

      // Read from SQLite database
      const dbResult = await this.kvMemoryStore.get(workspaceScopeFromAppId(resolvedAppId, customerId), key);
      if (!dbResult.success) {
        return {
          success: false,
          key,
          exists: false,
          error: dbResult.error || 'Failed to read from database'
        };
      }

      const duration = Date.now() - startTime;
      const resultData = {
        toolName: 'memory',
        appId: resolvedAppId,
        key,
        operation: 'read' as const,
        ...(dbResult.exists && { valueType: this.mapValueType(dbResult.value) }),
        keyExists: dbResult.exists,
        resultStats: {
          success: true,
          executionTime: duration,
        },
      };

      toolMemoryEvents.readSuccess(this.logger, resultData);

      return {
        success: true,
        key,
        value: dbResult.value,
        exists: dbResult.exists,
      };
    } catch (error) {
      // Log failed operation
      toolMemoryEvents.readFailure(this.logger, error instanceof Error ? error : new Error(String(error)), {
        toolName: 'memory',
        appId: resolvedAppId,
        key,
        operation: 'read',
      });

      return {
        success: false,
        key: options.key || '',
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * List all keys in memory (optional: with a key prefix filter)
   */
  async listKeys(appPath: string, prefix?: string, appId?: string, customerId?: string): Promise<{ success: boolean; keys: string[]; error?: string }> {
    const startTime = Date.now();

    // Resolve appId if not provided
    const resolvedAppId = appId || this.getAppIdFromPath(appPath);
    if (!resolvedAppId) {
      return {
        success: false,
        keys: [],
        error: 'App not found for the given path'
      };
    }
    
    // Log operation start
    toolMemoryEvents.listBegin(this.logger, {
      toolName: 'memory',
      appId: resolvedAppId,
      ...(prefix && { prefix }),
    });

    try {
      // List keys from SQLite database
      const dbResult = await this.kvMemoryStore.listKeys(workspaceScopeFromAppId(resolvedAppId, customerId), prefix);
      if (!dbResult.success) {
        return {
          success: false,
          keys: [],
          error: dbResult.error || 'Failed to list keys from database'
        };
      }

      const duration = Date.now() - startTime;
      const resultData = {
        toolName: 'memory',
        appId: resolvedAppId,
        key: prefix || '',
        operation: 'list' as const,
        resultStats: {
          keyCount: dbResult.keys.length,
          success: true,
          executionTime: duration,
        },
      };

      toolMemoryEvents.listSuccess(this.logger, resultData);

      return {
        success: true,
        keys: dbResult.keys,
      };
    } catch (error) {
      // Log failed operation
      toolMemoryEvents.listFailure(this.logger, error instanceof Error ? error : new Error(String(error)), {
        toolName: 'memory',
        appId: resolvedAppId,
        ...(prefix && { prefix }),
        operation: 'list',
      });

      return {
        success: false,
        keys: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Search memory using semantic similarity and text search
   */
  async searchMemory(options: MemorySearchOptions, appPath: string, appId?: string, customerId?: string): Promise<MemorySearchResult> {
    const startTime = Date.now();
    const { query, limit = 10, score_threshold = 0.7 } = options;

    // Resolve appId if not provided
    const resolvedAppId = appId || this.getAppIdFromPath(appPath);
    if (!resolvedAppId) {
      return {
        success: false,
        error: 'App not found for the given path'
      };
    }
    
    // Log operation start
    toolMemoryEvents.searchBegin(this.logger, {
      toolName: 'memory',
      appId: resolvedAppId,
      query,
      limit,
      scoreThreshold: score_threshold,
    });

    try {
      // Validate query
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return {
          success: false,
          error: 'Query must be a non-empty string',
        };
      }

      let results: Array<{ key: string; value: unknown; score: number; metadata?: Record<string, unknown> }> = [];

      const dbResult = await this.kvMemoryStore.search(workspaceScopeFromAppId(resolvedAppId, customerId), query, limit);
      if (dbResult.success) {
        results = dbResult.results.map(result => ({
          ...result,
          score: result.score || 0.5
        }));
      }

      const duration = Date.now() - startTime;
      const resultData = {
        toolName: 'memory',
        appId: resolvedAppId,
        query,
        operation: 'search' as const,
        resultStats: {
          resultCount: results.length,
          success: true,
          executionTime: duration,
        },
      };

      toolMemoryEvents.searchSuccess(this.logger, resultData);

      return {
        success: true,
        results: results.slice(0, limit), // Ensure we don't exceed the limit
      };
    } catch (error) {
      // Log failed operation
      toolMemoryEvents.searchFailure(this.logger, error instanceof Error ? error : new Error(String(error)), {
        toolName: 'memory',
        appId: resolvedAppId,
        query,
        operation: 'search',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}