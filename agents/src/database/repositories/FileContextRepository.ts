import type { Database } from 'better-sqlite3';
import { getDatabase } from '../connection.js';
import type { FileContext } from '../schema.js';
import { randomUUID } from 'crypto';

/**
 * Repository for file context persistence
 */
export class FileContextRepository {
  private db: Database;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * Find file context by app path and file path
   */
  findByPath(appPath: string, filePath: string): FileContext | null {
    const stmt = this.db.prepare(`
      SELECT * FROM file_context 
      WHERE app_path = ? AND file_path = ?
    `);
    
    const row = stmt.get(appPath, filePath) as any;
    if (!row) return null;

    return {
      id: row.id,
      appPath: row.app_path,
      filePath: row.file_path,
      lastModified: row.last_modified,
      lastRead: row.last_read,
      modificationCount: row.modification_count,
      readCount: row.read_count,
      fileSize: row.file_size,
      tokenCount: row.token_count,
      contentHash: row.content_hash,
      actualFileModTime: row.actual_file_mod_time,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Find all file contexts for an app, ordered by access score
   */
  findByAppPath(appPath: string, limit?: number): FileContext[] {
    let query = `
      SELECT * FROM file_context 
      WHERE app_path = ? 
      ORDER BY modification_count DESC, read_count DESC, last_read DESC
    `;
    
    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(appPath) as any[];

    return rows.map(row => ({
      id: row.id,
      appPath: row.app_path,
      filePath: row.file_path,
      lastModified: row.last_modified,
      lastRead: row.last_read,
      modificationCount: row.modification_count,
      readCount: row.read_count,
      fileSize: row.file_size,
      tokenCount: row.token_count,
      contentHash: row.content_hash,
      actualFileModTime: row.actual_file_mod_time,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  /**
   * Create or update file context
   */
  upsert(fileContext: Omit<FileContext, 'id' | 'createdAt' | 'updatedAt'>): FileContext {
    const existing = this.findByPath(fileContext.appPath, fileContext.filePath);
    
    if (existing) {
      // Update existing record
      const stmt = this.db.prepare(`
        UPDATE file_context 
        SET last_modified = ?, 
            last_read = ?, 
            modification_count = ?, 
            read_count = ?, 
            file_size = ?, 
            token_count = ?, 
            content_hash = ?,
            actual_file_mod_time = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      
      stmt.run(
        fileContext.lastModified,
        fileContext.lastRead,
        fileContext.modificationCount,
        fileContext.readCount,
        fileContext.fileSize,
        fileContext.tokenCount,
        fileContext.contentHash,
        fileContext.actualFileModTime || null,
        existing.id
      );
      
      return this.findByPath(fileContext.appPath, fileContext.filePath)!;
    } else {
      // Create new record
      const id = randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO file_context (
          id, app_path, file_path, last_modified, last_read, 
          modification_count, read_count, file_size, token_count, content_hash, actual_file_mod_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        id,
        fileContext.appPath,
        fileContext.filePath,
        fileContext.lastModified,
        fileContext.lastRead,
        fileContext.modificationCount,
        fileContext.readCount,
        fileContext.fileSize,
        fileContext.tokenCount,
        fileContext.contentHash,
        fileContext.actualFileModTime || null
      );
      
      return this.findByPath(fileContext.appPath, fileContext.filePath)!;
    }
  }

  /**
   * Delete file context records older than specified timestamp
   */
  deleteOlderThan(appPath: string, cutoffTimestamp: number): number {
    const stmt = this.db.prepare(`
      DELETE FROM file_context 
      WHERE app_path = ? AND last_read < ?
    `);
    
    const result = stmt.run(appPath, cutoffTimestamp);
    return result.changes;
  }

  /**
   * Delete all file context records for an app
   */
  deleteByAppPath(appPath: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM file_context WHERE app_path = ?
    `);
    
    const result = stmt.run(appPath);
    return result.changes;
  }

  /**
   * Get total token count for an app
   */
  getTotalTokenCount(appPath: string): number {
    const stmt = this.db.prepare(`
      SELECT SUM(token_count) as total FROM file_context WHERE app_path = ?
    `);
    
    const result = stmt.get(appPath) as { total: number | null };
    return result.total || 0;
  }

  /**
   * Get statistics for an app's file context
   */
  getStats(appPath: string): {
    totalFiles: number;
    totalTokens: number;
    lastAccessTime: Date | null;
  } {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total_files,
        SUM(token_count) as total_tokens,
        MAX(last_access_time) as last_access_time
      FROM file_context 
      WHERE app_path = ?
    `);
    
    const result = stmt.get(appPath) as {
      total_files: number;
      total_tokens: number | null;
      last_access_time: string | null;
    };
    
    return {
      totalFiles: result.total_files,
      totalTokens: result.total_tokens || 0,
      lastAccessTime: result.last_access_time ? new Date(result.last_access_time) : null
    };
  }
}