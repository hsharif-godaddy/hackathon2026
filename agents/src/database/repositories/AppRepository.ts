import { nanoid } from 'nanoid';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import path from 'path';
import { getDatabase } from '../connection.js';
import type { App, CreateAppRequest, UpdateAppRequest } from '../schema.js';

export class AppRepository {
  private db = getDatabase();

  /**
   * Create a new app with a websafe short identifier and filesystem directory
   */
  create(data: CreateAppRequest): App {
    const id = nanoid(12); // 12 characters, websafe, URL-friendly
    const now = new Date().toISOString();
    
    // Get base directory from environment variable, default to /tmp/apps
    const baseDir = process.env.APPS_BASE_DIR || '/tmp/apps';
    const appPath = path.join(baseDir, id);
    
    // Get template directory from environment variable, default to app-templates/v1
    const templateDir = process.env.APP_TEMPLATE_DIR || 'app-templates/v1';
    const templatePath = path.isAbsolute(templateDir) 
      ? templateDir 
      : path.join(process.cwd(), '..', templateDir);
    
    // Create the directory for the app
    try {
      mkdirSync(appPath, { recursive: true });
      
      // Copy template contents if template directory exists
      if (existsSync(templatePath)) {
        try {
          // Copy all contents from template directory to app directory
          cpSync(templatePath, appPath, { recursive: true });
          console.log(`Copied template from ${templatePath} to ${appPath}`);
        } catch (templateError) {
          console.warn(`Failed to copy template from ${templatePath}:`, templateError);
          // Don't fail app creation if template copying fails
        }
      } else {
        console.warn(`Template directory not found: ${templatePath}`);
      }
    } catch (error) {
      console.error(`Failed to create directory for app ${id}:`, error);
      throw new Error(`Failed to create app directory: ${error}`);
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO apps (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, data.name, appPath, now, now);
    
    return this.findById(id)!;
  }

  /**
   * Find an app by ID
   */
  findById(id: string): App | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at, updated_at
      FROM apps
      WHERE id = ?
    `);
    
    const row = stmt.get(id) as any;
    if (!row) return null;
    
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * List all apps with optional pagination
   */
  findAll(limit = 50, offset = 0): App[] {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at, updated_at
      FROM apps
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    
    const rows = stmt.all(limit, offset) as any[];
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      path: row.path,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * Update an app
   */
  update(id: string, data: UpdateAppRequest): App | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }

    if (updates.length === 0) {
      return existing; // No changes
    }

    // Add updated_at
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    
    // Add WHERE clause
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE apps 
      SET ${updates.join(', ')}
      WHERE id = ?
    `);
    
    stmt.run(...values);
    
    return this.findById(id)!;
  }

  /**
   * Delete an app and its directory
   */
  delete(id: string): boolean {
    // Get the app first to retrieve its path
    const app = this.findById(id);
    if (!app) return false;

    const stmt = this.db.prepare('DELETE FROM apps WHERE id = ?');
    const result = stmt.run(id);
    
    if (result.changes > 0) {
      // Try to remove the app directory
      try {
        rmSync(app.path, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to remove directory for app ${id} at ${app.path}:`, error);
        // Don't fail the operation if directory cleanup fails
      }
    }
    
    return result.changes > 0;
  }

  /**
   * Count total apps
   */
  count(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM apps');
    const result = stmt.get() as { count: number };
    return result.count;
  }
}
