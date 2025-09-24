import DatabaseManager from './database-manager';

// Legacy wrapper for backward compatibility
class LegacyDatabaseManager {
  private static instance: LegacyDatabaseManager;
  private manager: DatabaseManager | null = null;

  private constructor() {
    // Lazy initialization - don't create DatabaseManager until first use
  }

  public static getInstance(): LegacyDatabaseManager {
    if (!LegacyDatabaseManager.instance) {
      LegacyDatabaseManager.instance = new LegacyDatabaseManager();
    }
    return LegacyDatabaseManager.instance;
  }

  private getManager(): DatabaseManager {
    if (!this.manager) {
      this.manager = DatabaseManager.getInstance();
    }
    return this.manager;
  }

  // Legacy compatibility - schema initialization is now handled by DatabaseManager

  public getDb() {
    return this.getManager().getDb();
  }

  public async close(): Promise<void> {
    return this.getManager().close();
  }

  // Helper methods that wrap the async database manager methods
  public async run(sql: string, params: unknown[] = []) {
    const result = await this.getManager().run(sql, params);
    // Convert to legacy format for backward compatibility
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid
    };
  }

  public async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.getManager().get<T>(sql, params);
  }

  public async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.getManager().all<T>(sql, params);
  }

  // Legacy compatibility - migrations are now handled by DatabaseManager
}

export default LegacyDatabaseManager;
