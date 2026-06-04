import { getDatabase } from '../connection.js';
import type { Route, RouteType } from '../schema.js';
import { Logger } from '../../logging/index.js';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const logger = Logger.create({ component: 'route-repository' });

export interface CreateRouteParams {
  appId: string;
  routeType: RouteType; // 'blog', 'landing_page'
  pathPrefix: string; // "blog", "news", "articles", "work", "products"
  isDefault?: boolean;
}

export interface UpdateRouteParams {
  pathPrefix?: string;
  isDefault?: boolean;
}

interface RouteRow {
  id: string;
  app_id: string;
  route_type: string;
  path_prefix: string;
  is_default: number; // SQLite boolean (0 or 1)
  created_at: string;
}

/**
 * Repository for managing dynamic routes
 * Handles CRUD operations for route configuration across all content types
 */
export class RouteRepository {
  private db = getDatabase();

  /**
   * Find route by ID
   */
  findById(id: string): Route | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM routes WHERE id = ?`)
        .get(id) as RouteRow | undefined;

      if (!row) {
        return null;
      }

      return this.mapRowToRoute(row);
    } catch (error) {
      logger.error('route.find-by-id.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find route by type and path prefix
   */
  findByTypeAndPath(appId: string, routeType: RouteType, pathPrefix: string): Route | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM routes WHERE app_id = ? AND route_type = ? AND path_prefix = ?`)
        .get(appId, routeType, pathPrefix) as RouteRow | undefined;

      if (!row) {
        return null;
      }

      return this.mapRowToRoute(row);
    } catch (error) {
      logger.error('route.find-by-type-and-path.error', {
        appId,
        routeType,
        pathPrefix,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find all routes for an app (optionally filtered by type)
   */
  findByAppId(appId: string, routeType?: RouteType): Route[] {
    try {
      let sql = `SELECT * FROM routes WHERE app_id = ?`;
      const params: (string | RouteType)[] = [appId];

      if (routeType !== undefined) {
        sql += ` AND route_type = ?`;
        params.push(routeType);
      }

      sql += ` ORDER BY created_at ASC`;

      const rows = this.db
        .prepare(sql)
        .all(...params) as RouteRow[];

      return rows.map(row => this.mapRowToRoute(row));
    } catch (error) {
      logger.error('route.find-by-app.error', {
        appId,
        routeType,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Find default route for an app and route type
   */
  findDefault(appId: string, routeType: RouteType): Route | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM routes WHERE app_id = ? AND route_type = ? AND is_default = 1`)
        .get(appId, routeType) as RouteRow | undefined;

      if (!row) {
        return null;
      }

      return this.mapRowToRoute(row);
    } catch (error) {
      logger.error('route.find-default.error', {
        appId,
        routeType,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Create a new route
   * Uses transaction to ensure atomicity when unsetting previous default
   */
  create(params: CreateRouteParams): Route {
    try {
      const id = nanoid();
      const now = new Date().toISOString();

      // Wrap in transaction to ensure atomicity (unset + insert as one unit)
      const createRoute = this.db.transaction(() => {
        // If this is the default route for this type, unset any existing default
        if (params.isDefault) {
          this.db
            .prepare(`UPDATE routes SET is_default = 0 WHERE app_id = ? AND route_type = ? AND is_default = 1`)
            .run(params.appId, params.routeType);
        }

        this.db
          .prepare(
            `INSERT INTO routes (
              id, app_id, route_type, path_prefix, is_default, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            params.appId,
            params.routeType,
            params.pathPrefix,
            params.isDefault ? 1 : 0,
            now
          );
      });

      // Execute transaction
      createRoute();

      logger.info('route.create.success', {
        id,
        appId: params.appId,
        routeType: params.routeType,
        pathPrefix: params.pathPrefix,
        isDefault: params.isDefault
      });

      const route = this.findById(id);
      if (!route) {
        throw new Error('Failed to retrieve created route');
      }

      return route;
    } catch (error) {
      logger.error('route.create.error', {
        appId: params.appId,
        routeType: params.routeType,
        pathPrefix: params.pathPrefix,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update an existing route
   * Uses transaction to ensure atomicity when changing default
   */
  update(id: string, params: UpdateRouteParams): Route {
    try {
      const updates: string[] = [];
      const values: (string | number)[] = [];

      if (params.pathPrefix !== undefined) {
        updates.push('path_prefix = ?');
        values.push(params.pathPrefix);
      }

      // Check if setting as default (need transaction)
      const needsTransaction = params.isDefault !== undefined && params.isDefault;
      let routeAppId: string | undefined;
      let routeType: RouteType | undefined;

      if (needsTransaction) {
        const route = this.findById(id);
        if (!route) {
          throw new Error('Route not found');
        }
        routeAppId = route.appId;
        routeType = route.routeType;
        updates.push('is_default = ?');
        values.push(1);
      } else if (params.isDefault === false) {
        updates.push('is_default = ?');
        values.push(0);
      }

      if (updates.length === 0) {
        const route = this.findById(id);
        if (!route) {
          throw new Error('Route not found');
        }
        return route;
      }

      values.push(id);
      const sql = `UPDATE routes SET ${updates.join(', ')} WHERE id = ?`;

      // Wrap in transaction if setting as default (unset + update as one unit)
      if (needsTransaction) {
        const updateRoute = this.db.transaction(() => {
          // Unset other defaults first (for same app and route type)
          this.db
            .prepare(`UPDATE routes SET is_default = 0 WHERE app_id = ? AND route_type = ? AND is_default = 1 AND id != ?`)
            .run(routeAppId, routeType, id);

          // Then update this route
          this.db.prepare(sql).run(...values);
        });

        updateRoute();
      } else {
        // No transaction needed for non-default updates
        this.db.prepare(sql).run(...values);
      }

      logger.info('route.update.success', {
        id,
        updates: Object.keys(params)
      });

      const route = this.findById(id);
      if (!route) {
        throw new Error('Failed to retrieve updated route');
      }

      return route;
    } catch (error) {
      logger.error('route.update.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Delete a route
   * Auto-promotes next route to default if deleting current default
   * Uses transaction to ensure atomicity (promote + delete as one unit)
   */
  delete(id: string): void {
    try {
      const route = this.findById(id);
      if (!route) {
        logger.warn('route.delete.not-found', { id });
        return;
      }

      const routes = this.findByAppId(route.appId, route.routeType);

      // If deleting default route and other routes exist (of same type), wrap in transaction
      if (route.isDefault && routes.length > 1) {
        const nextRoute = routes.find(r => r.id !== id);
        if (nextRoute) {
          // Wrap promote + delete in transaction for atomicity
          const deleteWithPromotion = this.db.transaction(() => {
            // Promote next route to default
            this.db
              .prepare(`UPDATE routes SET is_default = 1 WHERE id = ?`)
              .run(nextRoute.id);

            // Delete current route
            this.db.prepare(`DELETE FROM routes WHERE id = ?`).run(id);
          });

          deleteWithPromotion();

          logger.info('route.delete.promoted-default', {
            deletedId: id,
            promotedId: nextRoute.id
          });
        }
      } else {
        // No promotion needed, simple delete
        this.db.prepare(`DELETE FROM routes WHERE id = ?`).run(id);
      }

      logger.info('route.delete.success', { id });
    } catch (error) {
      logger.error('route.delete.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Count routes for an app (optionally filtered by type)
   */
  count(appId: string, routeType?: RouteType): number {
    try {
      let sql = `SELECT COUNT(*) as count FROM routes WHERE app_id = ?`;
      const params: (string | RouteType)[] = [appId];

      if (routeType !== undefined) {
        sql += ` AND route_type = ?`;
        params.push(routeType);
      }

      const result = this.db
        .prepare(sql)
        .get(...params) as { count: number };

      return result.count;
    } catch (error) {
      logger.error('route.count.error', {
        appId,
        routeType,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Ensure app has at least one default route for given type
   * Creates a default route if none exist for that type
   */
  ensureDefault(appId: string, routeType: RouteType): Route {
    try {
      // Check if app has any routes for this type
      const routes = this.findByAppId(appId, routeType);

      if (routes.length === 0) {
        // Create default route based on type
        const defaultPrefix = routeType === 'blog' ? 'blog' : 'landing';
        return this.create({
          appId,
          routeType,
          pathPrefix: defaultPrefix,
          isDefault: true
        });
      }

      // Check if there's a default route for this type
      const defaultRoute = routes.find(r => r.isDefault);
      if (!defaultRoute) {
        // Set first route as default
        const firstRoute = routes[0];
        if (!firstRoute) {
          throw new Error('No routes found to set as default');
        }
        return this.update(firstRoute.id, { isDefault: true });
      }

      return defaultRoute;
    } catch (error) {
      logger.error('route.ensure-default.error', {
        appId,
        routeType,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Map database row to Route object
   */
  private mapRowToRoute(row: RouteRow): Route {
    return {
      id: row.id,
      appId: row.app_id,
      routeType: row.route_type as RouteType,
      pathPrefix: row.path_prefix,
      isDefault: row.is_default === 1,
      createdAt: new Date(row.created_at)
    };
  }
}
