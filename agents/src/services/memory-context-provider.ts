import { MemoryService } from './memory-service.js';
import { MemorySchemaRegistry } from './memory-schema-registry.js';
import { MemoryEntry } from '../types/memory.js';
import { logger } from '../logging/index.js';

/**
 * Context cache entry
 */
interface ContextCacheEntry {
  data: Record<string, any>;
  timestamp: number;
}

/**
 * Memory Context Provider
 * 
 * Efficiently loads memory entries marked for context inclusion and formats them
 * for agent consumption. Includes caching to minimize file system operations.
 */
export class MemoryContextProvider {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  
  private memoryService: MemoryService;
  private schemaRegistry: MemorySchemaRegistry;
  private cache: Map<string, ContextCacheEntry> = new Map();

  /**
   * Create a new context provider
   * 
   * @param memoryService - Memory service instance
   * @param schemaRegistry - Schema registry instance
   */
  constructor(
    memoryService: MemoryService,
    schemaRegistry: MemorySchemaRegistry
  ) {
    this.memoryService = memoryService;
    this.schemaRegistry = schemaRegistry;
  }

  /**
   * Get context data for an app
   * 
   * Loads all memory entries marked with includeInContext: true
   * and returns them as a structured object.
   * 
   * @param appPath - Path to the app directory
   * @param appId - App ID for logging
   * @param useCache - Whether to use cached data (default: true)
   * @returns Object mapping keys to values
   */
  async getContextData(
    appPath: string,
    appId: string,
    useCache: boolean = true
  ): Promise<Record<string, any>> {
    const cacheKey = `${appId}:${appPath}`;

    if (useCache) {
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < MemoryContextProvider.CACHE_TTL_MS) {
        logger.info('memory.context.cache_hit', {
          appId,
        });
        return cached.data;
      }
    }

    const contextSchemas = this.schemaRegistry.getContextSchemas();
    const keys = contextSchemas.map(schema => schema.key);

    if (keys.length === 0) {
      logger.info('memory.context.no_keys', {
        appId,
      });
      return {};
    }

    logger.info('memory.context.batch_load.start', {
      appId,
      keyCount: keys.length,
    });

    const entries = await this.memoryService.batchGet(appPath, keys);
    const data: Record<string, any> = {};

    for (const [key, entry] of Object.entries(entries)) {
      data[key] = entry.value;
    }

    for (const schema of contextSchemas) {
      if (!data[schema.key] && schema.defaultValue !== undefined) {
        data[schema.key] = schema.defaultValue;
      }
    }

    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    logger.info('memory.context.batch_load.success', {
      appId,
      keyCount: keys.length,
      entriesFound: Object.keys(entries).length,
      defaultsApplied: keys.length - Object.keys(entries).length,
    });

    return data;
  }

  /**
   * Get formatted context string for agent
   * 
   * Converts context data into a human-readable markdown string
   * suitable for inclusion in agent prompts.
   * 
   * @param appPath - Path to the app directory
   * @param appId - App ID for logging
   * @param useCache - Whether to use cached data (default: true)
   * @returns Formatted markdown string
   */
  async getContextString(
    appPath: string,
    appId: string,
    useCache: boolean = true
  ): Promise<string> {
    const data = await this.getContextData(appPath, appId, useCache);

    if (Object.keys(data).length === 0) {
      return '';
    }

    const sections = this.groupByNamespace(data);
    const lines: string[] = ['# Memory Context', ''];

    for (const [namespace, entries] of Object.entries(sections)) {
      lines.push(`## ${this.formatNamespace(namespace)}`, '');

      for (const [key, value] of entries) {
        const schema = this.schemaRegistry.get(`${namespace}.${key}`);
        const description = schema?.description;

        if (description) {
          lines.push(`- **${this.formatKey(key)}**: ${value}`);
          lines.push(`  _${description}_`);
        } else {
          lines.push(`- **${this.formatKey(key)}**: ${value}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n').trim();
  }

  /**
   * Invalidate cache for an app
   * 
   * @param appId - App ID
   * @param appPath - Path to the app directory
   */
  invalidateCache(appId: string, appPath: string): void {
    const cacheKey = `${appId}:${appPath}`;
    const existed = this.cache.delete(cacheKey);

    if (existed) {
      logger.info('memory.context.cache_invalidated', {
        appId,
      });
    }
  }

  /**
   * Clear all cached context data
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('memory.context.cache_cleared', {
      message: 'All context cache cleared',
    });
  }

  /**
   * Group context data by namespace
   * 
   * @param data - Context data object
   * @returns Map of namespace to entries
   */
  private groupByNamespace(
    data: Record<string, any>
  ): Record<string, Array<[string, any]>> {
    const sections: Record<string, Array<[string, any]>> = {};

    for (const [fullKey, value] of Object.entries(data)) {
      const lastDotIndex = fullKey.lastIndexOf('.');
      const namespace = fullKey.substring(0, lastDotIndex);
      const key = fullKey.substring(lastDotIndex + 1);

      if (!sections[namespace]) {
        sections[namespace] = [];
      }

      sections[namespace].push([key, this.formatValue(value)]);
    }

    return sections;
  }

  /**
   * Format a namespace for display
   * 
   * @param namespace - Namespace string (e.g., "app")
   * @returns Formatted string (e.g., "Application")
   */
  private formatNamespace(namespace: string): string {
    const formatMap: Record<string, string> = {
      'app': 'Application',
      'database': 'Database',
      'user': 'User',
      'features': 'Features',
      'config': 'Configuration',
    };

    return formatMap[namespace] || this.toTitleCase(namespace);
  }

  /**
   * Format a key for display
   * 
   * @param key - Key string (e.g., "title")
   * @returns Formatted string (e.g., "Title")
   */
  private formatKey(key: string): string {
    return this.toTitleCase(key.replace(/_/g, ' ').replace(/-/g, ' '));
  }

  /**
   * Format a value for display
   * 
   * @param value - Value to format
   * @returns Formatted string
   */
  private formatValue(value: any): string {
    if (value === null) {
      return 'null';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    if (typeof value === 'number') {
      return value.toString();
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[]';
      }
      return value.map(v => this.formatValue(v)).join(', ');
    }

    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  /**
   * Convert a string to title case
   * 
   * @param str - String to convert
   * @returns Title case string
   */
  private toTitleCase(str: string): string {
    return str
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}
