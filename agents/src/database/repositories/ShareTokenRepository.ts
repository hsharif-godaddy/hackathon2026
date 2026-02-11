import { getDatabase } from '../connection.js';
import type { ShareToken } from '../schema.js';
import { generateShareToken } from '../../utils/share-token-generator.js';
import { Logger } from '../../logging/index.js';

const logger = Logger.create({ service: 'share-token-repository' });

interface ShareTokenRow {
  token: string;
  app_id: string;
  expires_at: number;
  created_at: string;
  first_used_at: string | null;
}

export interface CreateShareTokenParams {
  appId: string;
  expiresIn: number; // Duration in seconds (default: 7 days = 604800)
}

export class ShareTokenRepository {
  private db = getDatabase();

  /**
   * Create a new share token for an app
   * Generates a cryptographically secure token and stores it with expiration
   *
   * @param params appId and expiration duration in seconds
   * @returns Created ShareToken
   */
  create(params: CreateShareTokenParams): ShareToken {
    const token = generateShareToken(12);
    const now = Date.now();
    const expiresAt = now + params.expiresIn * 1000;

    logger.info('share.token.create.begin', {
      appId: params.appId,
      expiresIn: params.expiresIn,
      expiresAt,
    });

    try {
      const stmt = this.db.prepare(`
        INSERT INTO share_tokens (token, app_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run(token, params.appId, expiresAt, new Date(now).toISOString());

      logger.info('share.token.create.success', {
        appId: params.appId,
        token,
      });

      return {
        token,
        appId: params.appId,
        expiresAt,
        createdAt: new Date(now),
        firstUsedAt: null,
      };
    } catch (error) {
      logger.error('share.token.create.error', {
        appId: params.appId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all share tokens for an app
   * Returns all tokens (including expired) for management UI
   *
   * @param appId App ID to query
   * @returns Array of ShareTokens
   */
  findByAppId(appId: string): ShareToken[] {
    logger.debug('share.token.find_by_app.begin', { appId });

    const stmt = this.db.prepare(`
      SELECT token, app_id, expires_at, created_at, first_used_at
      FROM share_tokens
      WHERE app_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(appId) as ShareTokenRow[];

    logger.debug('share.token.find_by_app.success', {
      appId,
      count: rows.length,
    });

    return rows.map((row) => this.mapRowToToken(row));
  }

  /**
   * Find a share token by token value
   * Used for validation - checks existence but caller must check expiration
   *
   * @param token Token value to find
   * @returns ShareToken if found, null otherwise
   */
  findByToken(token: string): ShareToken | null {
    const stmt = this.db.prepare(`
      SELECT token, app_id, expires_at, created_at, first_used_at
      FROM share_tokens
      WHERE token = ?
    `);

    const row = stmt.get(token) as ShareTokenRow | undefined;

    if (!row) {
      return null;
    }

    return this.mapRowToToken(row);
  }

  /**
   * Mark a token as first used (idempotent)
   * Tracks when the token was first accessed for analytics
   *
   * @param token Token value to mark
   */
  markFirstUsed(token: string): void {
    const now = Date.now();

    logger.debug('share.token.mark_first_used.begin', { token });

    try {
      const stmt = this.db.prepare(`
        UPDATE share_tokens
        SET first_used_at = ?
        WHERE token = ? AND first_used_at IS NULL
      `);

      const result = stmt.run(new Date(now).toISOString(), token);

      if (result.changes > 0) {
        logger.info('share.token.mark_first_used.success', {
          token,
          firstUsedAt: now,
        });
      }
    } catch (error) {
      logger.error('share.token.mark_first_used.error', {
        token,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - marking first use is not critical
    }
  }

  /**
   * Delete a share token
   *
   * @param token Token value to delete
   */
  delete(token: string): void {
    logger.info('share.token.delete.begin', { token });

    try {
      const stmt = this.db.prepare(`
        DELETE FROM share_tokens WHERE token = ?
      `);

      const result = stmt.run(token);

      if (result.changes === 0) {
        logger.warn('share.token.delete.not_found', { token });
      } else {
        logger.info('share.token.delete.success', { token });
      }
    } catch (error) {
      logger.error('share.token.delete.error', {
        token,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete expired tokens (cleanup utility)
   * Can be called periodically to remove old tokens
   *
   * @returns Number of tokens deleted
   */
  deleteExpired(): number {
    const now = Date.now();

    logger.info('share.token.delete_expired.begin', { now });

    try {
      const stmt = this.db.prepare(`
        DELETE FROM share_tokens WHERE expires_at < ?
      `);

      const result = stmt.run(now);

      logger.info('share.token.delete_expired.success', {
        deletedCount: result.changes,
      });

      return result.changes;
    } catch (error) {
      logger.error('share.token.delete_expired.error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Map database row to ShareToken interface
   * Converts snake_case columns to camelCase properties
   */
  private mapRowToToken(row: ShareTokenRow): ShareToken {
    return {
      token: row.token,
      appId: row.app_id,
      expiresAt: row.expires_at,
      createdAt: new Date(row.created_at),
      firstUsedAt: row.first_used_at ? new Date(row.first_used_at) : null,
    };
  }
}
