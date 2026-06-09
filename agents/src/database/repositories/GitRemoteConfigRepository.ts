import { getDatabase } from '../connection.js';
import type { GitRemoteConfig } from '../schema.js';
import type {
  CreateGitRemoteConfigParams,
  UpdateGitRemoteConfigParams
} from '../../types/git-remote.js';
import { Logger } from '../../logging/index.js';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const logger = Logger.create({ component: 'git-remote-config-repository' });

/**
 * Repository for managing git remote configurations
 *
 * Handles CRUD operations for git remote metadata (repo URL, branch, provider, etc.)
 * Tokens are NOT stored here - they're managed via secrets API
 */
export class GitRemoteConfigRepository {
  private db = getDatabase();

  /**
   * Find git remote configuration by app ID and remote name
   *
   * @param appId - Application ID
   * @param remoteName - Remote name (e.g., 'origin')
   * @returns Git remote config or null if not found
   */
  findByAppAndRemote(appId: string, remoteName: string): GitRemoteConfig | null {
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM git_remote_config WHERE app_id = ? AND remote_name = ?`
        )
        .get(appId, remoteName) as any;

      if (!row) {
        return null;
      }

      return this.mapRowToConfig(row);
    } catch (error) {
      logger.error('git-remote.find-by-app-and-remote.error', {
        appId,
        remoteName,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find all git remote configurations for an app
   *
   * @param appId - Application ID
   * @returns Array of git remote configs
   */
  findByAppId(appId: string): GitRemoteConfig[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM git_remote_config WHERE app_id = ?`)
        .all(appId) as any[];

      return rows.map(row => this.mapRowToConfig(row));
    } catch (error) {
      logger.error('git-remote.find-by-app.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Create or update git remote configuration
   *
   * @param params - Configuration parameters
   * @returns Created or updated git remote config
   */
  upsert(params: CreateGitRemoteConfigParams): GitRemoteConfig {
    try {
      // Check if config exists
      const existing = this.findByAppAndRemote(params.appId, params.remoteName);

      if (existing) {
        // Update existing config - only include fields that are explicitly provided
        const updateParams: UpdateGitRemoteConfigParams = {};

        if (params.repoUrl !== undefined) {
          updateParams.repoUrl = params.repoUrl;
        }
        if (params.defaultBranch !== undefined) {
          updateParams.defaultBranch = params.defaultBranch;
        }
        if (params.syncEnabled !== undefined) {
          updateParams.syncEnabled = params.syncEnabled;
        }
        if (params.syncStrategy !== undefined) {
          updateParams.syncStrategy = params.syncStrategy;
        }

        return this.update(existing.id, updateParams);
      }

      // Create new config
      const id = `gitcfg-${nanoid()}`;

      this.db
        .prepare(
          `INSERT INTO git_remote_config
           (id, app_id, remote_name, provider, repo_url, default_branch, sync_enabled, sync_strategy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.appId,
          params.remoteName,
          params.provider,
          params.repoUrl,
          params.defaultBranch,
          params.syncEnabled !== false ? 1 : 0,
          params.syncStrategy ?? 'manual'
        );

      logger.info('git-remote.create.success', {
        id,
        appId: params.appId,
        remoteName: params.remoteName,
        provider: params.provider
      });

      const config = this.findByAppAndRemote(params.appId, params.remoteName);
      if (!config) {
        throw new Error('Failed to retrieve created config');
      }

      return config;
    } catch (error) {
      logger.error('git-remote.upsert.error', {
        appId: params.appId,
        remoteName: params.remoteName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update existing git remote configuration
   *
   * @param id - Config ID
   * @param params - Update parameters
   * @returns Updated git remote config
   */
  update(id: string, params: UpdateGitRemoteConfigParams): GitRemoteConfig {
    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (params.repoUrl !== undefined) {
        updates.push('repo_url = ?');
        values.push(params.repoUrl);
      }

      if (params.defaultBranch !== undefined) {
        updates.push('default_branch = ?');
        values.push(params.defaultBranch);
      }

      if (params.lastSyncAt !== undefined) {
        updates.push('last_sync_at = ?');
        values.push(params.lastSyncAt);
      }

      if (params.syncEnabled !== undefined) {
        updates.push('sync_enabled = ?');
        values.push(params.syncEnabled ? 1 : 0);
      }

      if (params.syncStrategy !== undefined) {
        updates.push('sync_strategy = ?');
        values.push(params.syncStrategy);
      }

      if (updates.length === 0) {
        throw new Error('No fields to update');
      }

      values.push(id);

      this.db
        .prepare(
          `UPDATE git_remote_config SET ${updates.join(', ')} WHERE id = ?`
        )
        .run(...values);

      logger.info('git-remote.update.success', {
        id,
        updatedFields: Object.keys(params)
      });

      const row = this.db
        .prepare(`SELECT * FROM git_remote_config WHERE id = ?`)
        .get(id) as any;

      if (!row) {
        throw new Error('Config not found after update');
      }

      return this.mapRowToConfig(row);
    } catch (error) {
      logger.error('git-remote.update.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Delete git remote configuration
   *
   * @param id - Config ID
   * @returns True if deleted, false if not found
   */
  delete(id: string): boolean {
    try {
      const result = this.db
        .prepare(`DELETE FROM git_remote_config WHERE id = ?`)
        .run(id);

      const deleted = result.changes > 0;

      if (deleted) {
        logger.info('git-remote.delete.success', { id });
      }

      return deleted;
    } catch (error) {
      logger.error('git-remote.delete.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Delete all git remote configurations for an app
   *
   * @param appId - Application ID
   * @returns Number of configs deleted
   */
  deleteByAppId(appId: string): number {
    try {
      const result = this.db
        .prepare(`DELETE FROM git_remote_config WHERE app_id = ?`)
        .run(appId);

      logger.info('git-remote.delete-by-app.success', {
        appId,
        count: result.changes
      });

      return result.changes;
    } catch (error) {
      logger.error('git-remote.delete-by-app.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Map database row to GitRemoteConfig
   */
  private mapRowToConfig(row: any): GitRemoteConfig {
    return {
      id: row.id,
      appId: row.app_id,
      remoteName: row.remote_name,
      provider: row.provider,
      repoUrl: row.repo_url,
      defaultBranch: row.default_branch,
      lastSyncAt: row.last_sync_at,
      syncEnabled: row.sync_enabled === 1,
      syncStrategy: row.sync_strategy ?? 'manual',
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
