import { nanoid } from 'nanoid';
import { getDatabase } from '../connection.js';
import type { Memory } from '../schema.js';
import { Logger } from '../../logging/index.js';
import { toolMemoryEvents } from '../../logging/events/index.js';

export class MemoryRepository {
  private db = getDatabase();
  private logger = Logger.create({ service: 'memory-repository' });

  private mapValueType(value: unknown): 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' {
    if (value === null) {return 'null';}
    if (Array.isArray(value)) {return 'array';}
    const jsType = typeof value;
    if (jsType === 'object') {return 'object';}
    if (jsType === 'string' || jsType === 'number' || jsType === 'boolean') {return jsType;}
    return 'string'; // fallback for bigint, symbol, etc.
  }

  /**
   * Extract searchable text from a value for vector storage
   */
  private extractSearchableText(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    
    if (value === null || value === undefined) {
      return '';
    }
    
    if (typeof value === 'object') {
      try {
        // Extract text from object properties recursively
        const extractFromObject = (obj: any): string[] => {
          const texts: string[] = [];
          
          if (Array.isArray(obj)) {
            obj.forEach(item => texts.push(...extractFromObject(item)));
          } else if (obj && typeof obj === 'object') {
            Object.entries(obj).forEach(([key, val]) => {
              // Include property names as searchable text
              texts.push(key);
              texts.push(...extractFromObject(val));
            });
          } else {
            texts.push(String(obj));
          }
          
          return texts;
        };
        
        return extractFromObject(value).filter(text => text && text.length > 0).join(' ');
      } catch {
        return JSON.stringify(value);
      }
    }
    
    return String(value);
  }

  /**
   * Store or update a memory entry
   */
  async set(appId: string, key: string, value: unknown): Promise<{ success: boolean; error?: string }> {
    try {
      const id = nanoid();
      const valueType = this.mapValueType(value);
      const serializedValue = JSON.stringify(value);
      const searchText = this.extractSearchableText(value);

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO memory (id, app_id, key, value, value_type, search_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);

      stmt.run(id, appId, key, serializedValue, valueType, searchText || null);

      this.logger.info('memory.set.success', {
        appId,
        key,
        valueType,
        hasSearchText: !!searchText
      });

      return { success: true };
    } catch (error) {
      this.logger.error('memory.set.failed', {
        appId,
        key,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Retrieve a memory entry by key
   */
  async get(appId: string, key: string): Promise<{ success: boolean; value?: unknown; exists: boolean; error?: string }> {
    try {
      const stmt = this.db.prepare(`
        SELECT value, value_type FROM memory 
        WHERE app_id = ? AND key = ?
      `);

      const result = stmt.get(appId, key) as { value: string; value_type: string } | undefined;

      if (!result) {
        return { success: true, exists: false };
      }

      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(result.value);
      } catch {
        parsedValue = result.value; // fallback to raw string
      }

      this.logger.info('memory.get.success', {
        appId,
        key,
        valueType: result.value_type,
        exists: true
      });

      return {
        success: true,
        value: parsedValue,
        exists: true
      };
    } catch (error) {
      this.logger.error('memory.get.failed', {
        appId,
        key,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * List all keys for an app, optionally filtered by prefix
   */
  async listKeys(appId: string, prefix?: string): Promise<{ success: boolean; keys: string[]; error?: string }> {
    try {
      let stmt;
      let params: any[];

      if (prefix) {
        stmt = this.db.prepare(`
          SELECT key FROM memory 
          WHERE app_id = ? AND key LIKE ?
          ORDER BY key
        `);
        params = [appId, `${prefix}%`];
      } else {
        stmt = this.db.prepare(`
          SELECT key FROM memory 
          WHERE app_id = ?
          ORDER BY key
        `);
        params = [appId];
      }

      const results = stmt.all(...params) as { key: string }[];
      const keys = results.map(row => row.key);

      this.logger.info('memory.list.success', {
        appId,
        prefix,
        keyCount: keys.length
      });

      return { success: true, keys };
    } catch (error) {
      this.logger.error('memory.list.failed', {
        appId,
        prefix,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        keys: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Delete a memory entry
   */
  async delete(appId: string, key: string): Promise<{ success: boolean; error?: string }> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM memory 
        WHERE app_id = ? AND key = ?
      `);

      const result = stmt.run(appId, key);
      const deleted = result.changes > 0;

      this.logger.info('memory.delete.success', {
        appId,
        key,
        deleted
      });

      return { success: true };
    } catch (error) {
      this.logger.error('memory.delete.failed', {
        appId,
        key,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Search memory entries by text content
   */
  async search(appId: string, searchTerm: string, limit: number = 10): Promise<{ 
    success: boolean; 
    results: Array<{ key: string; value: unknown; score?: number }>; 
    error?: string 
  }> {
    try {
      const stmt = this.db.prepare(`
        SELECT key, value, value_type FROM memory 
        WHERE app_id = ? AND (
          key LIKE ? OR 
          search_text LIKE ? OR 
          value LIKE ?
        )
        ORDER BY 
          CASE 
            WHEN key LIKE ? THEN 1
            WHEN search_text LIKE ? THEN 2
            ELSE 3
          END,
          key
        LIMIT ?
      `);

      const searchPattern = `%${searchTerm}%`;
      const exactKeyPattern = `${searchTerm}%`;
      
      const results = stmt.all(
        appId, 
        searchPattern, 
        searchPattern, 
        searchPattern,
        exactKeyPattern,
        searchPattern,
        limit
      ) as Array<{ key: string; value: string; value_type: string }>;

      const formattedResults = results.map(row => {
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(row.value);
        } catch {
          parsedValue = row.value;
        }

        return {
          key: row.key,
          value: parsedValue,
          score: 1.0 // Simple text search doesn't provide real relevance scores
        };
      });

      this.logger.info('memory.search.success', {
        appId,
        searchTerm,
        resultCount: formattedResults.length,
        limit
      });

      return { success: true, results: formattedResults };
    } catch (error) {
      this.logger.error('memory.search.failed', {
        appId,
        searchTerm,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        results: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get all memory entries for an app (useful for migrations or debugging)
   */
  async getAll(appId: string): Promise<{ success: boolean; memories: Memory[]; error?: string }> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM memory 
        WHERE app_id = ?
        ORDER BY key
      `);

      const results = stmt.all(appId) as Array<{
        id: string;
        app_id: string;
        key: string;
        value: string;
        value_type: string;
        search_text: string | null;
        created_at: string;
        updated_at: string;
      }>;

      const memories: Memory[] = results.map(row => ({
        id: row.id,
        appId: row.app_id,
        key: row.key,
        value: row.value,
        valueType: row.value_type as any,
        searchText: row.search_text || undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      }));

      return { success: true, memories };
    } catch (error) {
      this.logger.error('memory.getAll.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        memories: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}