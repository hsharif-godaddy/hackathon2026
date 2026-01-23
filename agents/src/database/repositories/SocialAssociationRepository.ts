import { getDatabase } from '../connection.js';
import type { SocialAssociation } from '../schema.js';
import { Logger } from '../../logging/index.js';
import { customAlphabet } from 'nanoid';
import { SocialPlatform } from '../../types/social.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const logger = Logger.create({ service: 'social-association-repository' });

export interface CreateSocialAssociationParams {
  appId: string;
  socialId: string;
  platform: SocialPlatform;
}

interface SocialAssociationRow {
  id: string;
  app_id: string;
  social_id: string;
  platform: string;
  created_at: string;
}

/**
 * Repository for managing social platform associations
 * Handles CRUD operations for social media account connections
 */
export class SocialAssociationRepository {
  private db = getDatabase();

  /**
   * Find social association by ID
   */
  findById(id: string): SocialAssociation | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM social_associations WHERE id = ?`)
        .get(id) as any;

      if (!row) {
        return null;
      }

      return this.mapRowToAssociation(row);
    } catch (error) {
      logger.error('social-association.find-by-id.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find all social associations for an app
   */
  findByAppId(appId: string): SocialAssociation[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM social_associations WHERE app_id = ? ORDER BY created_at DESC`)
        .all(appId) as any[];

      return rows.map(row => this.mapRowToAssociation(row));
    } catch (error) {
      logger.error('social-association.find-by-app.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Find social association by app and social ID
   */
  findByAppAndSocialId(appId: string, socialId: string): SocialAssociation | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM social_associations WHERE app_id = ? AND social_id = ?`)
        .get(appId, socialId) as any;

      if (!row) {
        return null;
      }

      return this.mapRowToAssociation(row);
    } catch (error) {
      logger.error('social-association.find-by-app-and-social-id.error', {
        appId,
        socialId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find social associations by app and platform
   */
  findByAppAndPlatform(appId: string, platform: SocialPlatform): SocialAssociation[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM social_associations WHERE app_id = ? AND platform = ? ORDER BY created_at DESC`)
        .all(appId, platform) as any[];

      return rows.map(row => this.mapRowToAssociation(row));
    } catch (error) {
      logger.error('social-association.find-by-app-and-platform.error', {
        appId,
        platform,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Create a new social association
   */
  create(params: CreateSocialAssociationParams): SocialAssociation {
    try {
      const id = `soc-${nanoid()}`;

      this.db
        .prepare(
          `INSERT INTO social_associations (id, app_id, social_id, platform)
           VALUES (?, ?, ?, ?)`
        )
        .run(id, params.appId, params.socialId, params.platform);

      logger.info('social-association.create.success', {
        id,
        appId: params.appId,
        socialId: params.socialId,
        platform: params.platform
      });

      const association = this.findById(id);
      if (!association) {
        throw new Error('Failed to retrieve created association');
      }

      return association;
    } catch (error) {
      logger.error('social-association.create.error', {
        appId: params.appId,
        socialId: params.socialId,
        platform: params.platform,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Delete a social association by ID
   */
  delete(id: string): boolean {
    try {
      const result = this.db
        .prepare(`DELETE FROM social_associations WHERE id = ?`)
        .run(id);

      const deleted = result.changes > 0;

      if (deleted) {
        logger.info('social-association.delete.success', { id });
      }

      return deleted;
    } catch (error) {
      logger.error('social-association.delete.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Delete all social associations for an app
   */
  deleteByAppId(appId: string): number {
    try {
      const result = this.db
        .prepare(`DELETE FROM social_associations WHERE app_id = ?`)
        .run(appId);

      logger.info('social-association.delete-by-app.success', {
        appId,
        count: result.changes
      });

      return result.changes;
    } catch (error) {
      logger.error('social-association.delete-by-app.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Map database row to SocialAssociation
   */
  private mapRowToAssociation(row: SocialAssociationRow): SocialAssociation {
    return {
      id: row.id,
      appId: row.app_id,
      socialId: row.social_id,
      platform: row.platform as SocialPlatform,
      createdAt: new Date(row.created_at)
    };
  }
}
