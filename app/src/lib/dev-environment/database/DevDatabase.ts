import type { Database } from 'better-sqlite3';

export interface DevAppInfo {
  appId: string;
  port: number;
  appPath: string;
  templateVersion: string;
  status: 'creating' | 'created' | 'error' | 'running' | 'stopped';
  createdAt: Date;
  updatedAt: Date;
}

export interface RunningProcess {
  id: string;
  appId: string;
  pid: number;
  port: number;
  startedAt: string;
  status: 'running' | 'stopped';
}

/**
 * Database operations for dev environment
 * Uses separate dev-specific tables to avoid modifying production schema
 */
export class DevDatabase {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Initialize dev-specific database tables
   * These tables store development metadata without modifying production schema
   */
  initializeTables(): void {
    // Create dev_apps table for development-specific app metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dev_apps (
        app_id TEXT PRIMARY KEY,
        port INTEGER NOT NULL UNIQUE,
        app_path TEXT NOT NULL,
        template_version TEXT DEFAULT 'v3',
        status TEXT NOT NULL DEFAULT 'creating',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create running_processes table for process tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS running_processes (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        pid INTEGER NOT NULL,
        port INTEGER NOT NULL,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'running',
        FOREIGN KEY (app_id) REFERENCES dev_apps(app_id) ON DELETE CASCADE
      )
    `);
  }

  /**
   * Find dev app info by ID
   */
  findDevAppById(appId: string): DevAppInfo | null {
    const stmt = this.db.prepare(`
      SELECT app_id, port, app_path, template_version, status, created_at, updated_at
      FROM dev_apps
      WHERE app_id = ?
    `);
    
    const row = stmt.get(appId) as any;
    if (!row) return null;
    
    return {
      appId: row.app_id,
      port: row.port,
      appPath: row.app_path,
      templateVersion: row.template_version,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Create a new dev app record
   */
  createDevApp(devApp: Omit<DevAppInfo, 'createdAt' | 'updatedAt'>): DevAppInfo {
    // Check if app already exists to prevent duplicate creation
    const existing = this.findDevAppById(devApp.appId);
    if (existing) {
      console.log(`⚠️ Dev app ${devApp.appId} already exists, returning existing record`);
      return existing;
    }
    
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO dev_apps (app_id, port, app_path, template_version, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    try {
      stmt.run(
        devApp.appId,
        devApp.port,
        devApp.appPath,
        devApp.templateVersion || 'v3',
        devApp.status,
        now,
        now
      );
      
      return this.findDevAppById(devApp.appId)!;
    } catch (error) {
      // If we get a UNIQUE constraint error, check if the app was created by another process
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        console.log(`⚠️ UNIQUE constraint failed for app ${devApp.appId}, checking if it exists now`);
        const existingAfterError = this.findDevAppById(devApp.appId);
        if (existingAfterError) {
          console.log(`✅ App ${devApp.appId} was created by another process, returning existing record`);
          return existingAfterError;
        }
      }
      throw error;
    }
  }

  /**
   * Update dev app status
   */
  updateDevAppStatus(appId: string, status: DevAppInfo['status']): boolean {
    const stmt = this.db.prepare(`
      UPDATE dev_apps 
      SET status = ?, updated_at = ?
      WHERE app_id = ?
    `);
    
    const result = stmt.run(status, new Date().toISOString(), appId);
    return result.changes > 0;
  }

  /**
   * Delete a dev app
   */
  deleteDevApp(appId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM dev_apps WHERE app_id = ?');
    const result = stmt.run(appId);
    return result.changes > 0;
  }

  /**
   * Add a running process record
   */
  addProcessRecord(appId: string, pid: number, port: number): string {
    const processId = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const stmt = this.db.prepare(`
      INSERT INTO running_processes (id, app_id, pid, port, started_at, status)
      VALUES (?, ?, ?, ?, datetime('now'), 'running')
    `);
    
    stmt.run(processId, appId, pid, port);
    return processId;
  }

  /**
   * Remove process record by app ID
   */
  removeProcessRecord(appId: string): void {
    const stmt = this.db.prepare('DELETE FROM running_processes WHERE app_id = ?');
    stmt.run(appId);
  }

  /**
   * Get running processes
   */
  getRunningProcesses(): RunningProcess[] {
    const stmt = this.db.prepare('SELECT * FROM running_processes WHERE status = ?');
    const rows = stmt.all('running') as any[];
    
    return rows.map(row => ({
      id: row.id,
      appId: row.app_id,
      pid: row.pid,
      port: row.port,
      startedAt: row.started_at,
      status: row.status,
    }));
  }

  /**
   * Check if a dev app exists
   */
  devAppExists(appId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM dev_apps WHERE app_id = ? LIMIT 1');
    return !!stmt.get(appId);
  }

  /**
   * Get all allocated ports
   */
  getAllocatedPorts(): number[] {
    const stmt = this.db.prepare('SELECT port FROM dev_apps ORDER BY port ASC');
    return (stmt.all() as Array<{ port: number }>).map(row => row.port);
  }

  /**
   * Check if a specific port is allocated
   */
  isPortAllocated(port: number): boolean {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM dev_apps WHERE port = ?');
    const result = stmt.get(port) as { count: number };
    return result.count > 0;
  }

  /**
   * Get the app that owns a specific port
   */
  getAppByPort(port: number): { appId: string } | null {
    const stmt = this.db.prepare('SELECT app_id FROM dev_apps WHERE port = ?');
    const result = stmt.get(port) as { app_id: string } | undefined;
    return result ? { appId: result.app_id } : null;
  }
}