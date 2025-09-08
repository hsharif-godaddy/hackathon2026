import DatabaseManager from './database-manager';

// Legacy wrapper for backward compatibility
class LegacyDatabaseManager {
  private static instance: LegacyDatabaseManager;
  private manager: DatabaseManager;

  private constructor() {
    this.manager = DatabaseManager.getInstance();
  }

  public static getInstance(): LegacyDatabaseManager {
    if (!LegacyDatabaseManager.instance) {
      LegacyDatabaseManager.instance = new LegacyDatabaseManager();
    }
    return LegacyDatabaseManager.instance;
  }

  // Legacy compatibility - schema initialization is now handled by DatabaseManager

  public getDb() {
    return this.manager.getDb();
  }

  public async close(): Promise<void> {
    return this.manager.close();
  }

  // Helper methods that wrap the async database manager methods
  public async run(sql: string, params: unknown[] = []) {
    const result = await this.manager.run(sql, params);
    // Convert to legacy format for backward compatibility
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid
    };
  }

  public async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.manager.get<T>(sql, params);
  }

  public async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.manager.all<T>(sql, params);
  }

  // Legacy compatibility - migrations are now handled by DatabaseManager
}

export default LegacyDatabaseManager;
