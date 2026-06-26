import { getDatabase } from '../connection.js';
import type { SocialPost } from '../schema.js';
import { Logger } from '../../logging/index.js';
import { customAlphabet } from 'nanoid';
import { PostState } from '../../types/social.js';
import { assertEnumValue } from '../../utils/enum-guard.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const logger = Logger.create({ component: 'social-post-repository' });

export interface CreateSocialPostParams {
  appId: string;
  associationId?: string | null;
  platform: string | null;
  state: PostState;
  payload: Record<string, any>;
  externalResponse?: Record<string, any> | null;
  externalId?: string | null;
  scheduledAt?: Date | null;
  completedAt?: Date | null;
  campaignId?: string | null;
}

export interface UpdateSocialPostParams {
  state?: PostState;
  payload?: Record<string, any>;
  externalResponse?: Record<string, any> | null;
  externalId?: string | null;
  scheduledAt?: Date | null;
  completedAt?: Date | null;
}

interface SocialPostRow {
  id: string;
  app_id: string;
  association_id: string | null;
  platform: string | null;
  state: string;
  payload: string;
  external_response: string | null;
  external_id: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  campaign_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Repository for managing social media posts
 * Handles CRUD operations for social post publish records
 */
export class SocialPostRepository {
  private db = getDatabase();

  /**
   * Find social post by ID
   */
  findById(id: string): SocialPost | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM social_posts WHERE id = ?`)
        .get(id) as any;

      if (!row) {
        return null;
      }

      return this.mapRowToPost(row);
    } catch (error) {
      logger.error('social-post.find-by-id.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find all social posts for an app
   */
  findByAppId(appId: string, limit?: number): SocialPost[] {
    try {
      const sql = limit
        ? `SELECT * FROM social_posts WHERE app_id = ? ORDER BY created_at DESC LIMIT ?`
        : `SELECT * FROM social_posts WHERE app_id = ? ORDER BY created_at DESC`;

      const rows = limit
        ? this.db.prepare(sql).all(appId, limit) as any[]
        : this.db.prepare(sql).all(appId) as any[];

      return rows.map(row => this.mapRowToPost(row));
    } catch (error) {
      logger.error('social-post.find-by-app.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Find social posts by app and state
   */
  findByAppAndState(appId: string, state: PostState): SocialPost[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM social_posts WHERE app_id = ? AND state = ? ORDER BY created_at DESC`)
        .all(appId, state) as any[];

      return rows.map(row => this.mapRowToPost(row));
    } catch (error) {
      logger.error('social-post.find-by-app-and-state.error', {
        appId,
        state,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Find social posts by app and platform
   */
  findByAppAndPlatform(appId: string, platform: string): SocialPost[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM social_posts WHERE app_id = ? AND platform = ? ORDER BY created_at DESC`)
        .all(appId, platform) as any[];

      return rows.map(row => this.mapRowToPost(row));
    } catch (error) {
      logger.error('social-post.find-by-app-and-platform.error', {
        appId,
        platform,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Find social posts by association ID
   */
  findByAssociationId(associationId: string): SocialPost[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM social_posts WHERE association_id = ? ORDER BY created_at DESC`)
        .all(associationId) as any[];

      return rows.map(row => this.mapRowToPost(row));
    } catch (error) {
      logger.error('social-post.find-by-association.error', {
        associationId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Find social posts by campaign ID
   */
  findByCampaignId(campaignId: string): SocialPost[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM social_posts WHERE campaign_id = ? ORDER BY created_at DESC`)
        .all(campaignId) as any[];

      return rows.map(row => this.mapRowToPost(row));
    } catch (error) {
      logger.error('social-post.find-by-campaign.error', {
        campaignId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Find scheduled posts that are due
   */
  findScheduledDue(beforeDate: Date = new Date()): SocialPost[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM social_posts WHERE state = 'SCHEDULED' AND scheduled_at <= ? ORDER BY scheduled_at ASC`)
        .all(beforeDate.toISOString()) as any[];

      return rows.map(row => this.mapRowToPost(row));
    } catch (error) {
      logger.error('social-post.find-scheduled-due.error', {
        beforeDate: beforeDate.toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Create a new social post
   */
  create(params: CreateSocialPostParams): SocialPost {
    try {
      // The DB no longer enforces a state CHECK (dropped in RUBICON-436 to admit DRAFT), so
      // validate the enum here before inserting an out-of-range state.
      assertEnumValue(PostState, params.state, 'social post state');
      const id = `post-${nanoid()}`;

      this.db
        .prepare(
          `INSERT INTO social_posts
           (id, app_id, association_id, platform, state, payload, external_response, external_id, scheduled_at, completed_at, campaign_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.appId,
          params.associationId || null,
          params.platform || null,
          params.state,
          JSON.stringify(params.payload),
          params.externalResponse ? JSON.stringify(params.externalResponse) : null,
          params.externalId || null,
          params.scheduledAt ? params.scheduledAt.toISOString() : null,
          params.completedAt ? params.completedAt.toISOString() : null,
          params.campaignId || null
        );

      logger.info('social-post.create.success', {
        id,
        appId: params.appId,
        platform: params.platform,
        state: params.state
      });

      const post = this.findById(id);
      if (!post) {
        throw new Error('Failed to retrieve created post');
      }

      return post;
    } catch (error) {
      logger.error('social-post.create.error', {
        appId: params.appId,
        platform: params.platform,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update an existing social post
   */
  update(id: string, params: UpdateSocialPostParams): SocialPost {
    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (params.state !== undefined) {
        assertEnumValue(PostState, params.state, 'social post state');
        updates.push('state = ?');
        values.push(params.state);
      }

      if (params.payload !== undefined) {
        updates.push('payload = ?');
        values.push(JSON.stringify(params.payload));
      }

      if (params.externalResponse !== undefined) {
        updates.push('external_response = ?');
        values.push(params.externalResponse ? JSON.stringify(params.externalResponse) : null);
      }

      if (params.externalId !== undefined) {
        updates.push('external_id = ?');
        values.push(params.externalId);
      }

      if (params.scheduledAt !== undefined) {
        updates.push('scheduled_at = ?');
        values.push(params.scheduledAt ? params.scheduledAt.toISOString() : null);
      }

      if (params.completedAt !== undefined) {
        updates.push('completed_at = ?');
        values.push(params.completedAt ? params.completedAt.toISOString() : null);
      }

      if (updates.length === 0) {
        throw new Error('No fields to update');
      }

      values.push(id);

      this.db
        .prepare(`UPDATE social_posts SET ${updates.join(', ')} WHERE id = ?`)
        .run(...values);

      logger.info('social-post.update.success', {
        id,
        updatedFields: Object.keys(params)
      });

      const post = this.findById(id);
      if (!post) {
        throw new Error('Post not found after update');
      }

      return post;
    } catch (error) {
      logger.error('social-post.update.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Delete a social post by ID
   */
  delete(id: string): boolean {
    try {
      const result = this.db
        .prepare(`DELETE FROM social_posts WHERE id = ?`)
        .run(id);

      const deleted = result.changes > 0;

      if (deleted) {
        logger.info('social-post.delete.success', { id });
      }

      return deleted;
    } catch (error) {
      // Re-throw on a genuine DB error (consistent with update() above) instead of
      // swallowing it as `false`. Callers in a cascade (deleteSocialDraft) run inside a
      // transaction and rely on the throw to roll back rather than reporting a false
      // success on an orphaned row. The boolean return now means only deleted/absent.
      logger.error('social-post.delete.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Delete all social posts for an app
   */
  deleteByAppId(appId: string): number {
    try {
      const result = this.db
        .prepare(`DELETE FROM social_posts WHERE app_id = ?`)
        .run(appId);

      logger.info('social-post.delete-by-app.success', {
        appId,
        count: result.changes
      });

      return result.changes;
    } catch (error) {
      logger.error('social-post.delete-by-app.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Map database row to SocialPost
   */
  private mapRowToPost(row: SocialPostRow): SocialPost {
    try {
      return {
        id: row.id,
        appId: row.app_id,
        associationId: row.association_id,
        platform: row.platform,
        state: row.state as PostState,
        payload: JSON.parse(row.payload),
        externalResponse: row.external_response ? JSON.parse(row.external_response) : null,
        externalId: row.external_id,
        scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
        completedAt: row.completed_at ? new Date(row.completed_at) : null,
        campaignId: row.campaign_id,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      };
    } catch (error) {
      logger.error('social-post.map-row.json-parse-error', {
        id: row.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Failed to parse social post data for ID ${row.id}`);
    }
  }
}
