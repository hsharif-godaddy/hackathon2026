import { getDatabase } from '../connection.js';
import type { AppMetadataRow } from '../schema.js';
import { Logger } from '../../logging/index.js';
import { mergeAppMetadata, type AppMetadata } from '@airo/shared';

// The bag is monotonic (merge never deletes keys) and the PATCH route accepts
// up to 10MB bodies — cap the *stored* blob cheaply at the write primitive.
export const MAX_METADATA_SERIALIZED_CHARS = 64 * 1024;

export class MetadataTooLargeError extends Error {
  constructor(actualSize: number, limit: number) {
    super(`Metadata blob is ${actualSize} chars, which exceeds the ${limit}-char limit`);
    this.name = 'MetadataTooLargeError';
  }
}

/**
 * Per-app metadata store. One JSON object per app, keyed by siteId.
 *
 * `merge()` is the single write primitive: agent tools call it in-process and
 * the HTTP PATCH route calls it for external producers. Writes are shallow,
 * last-writer-wins per top-level key, and emit an `app.metadata.set` log line.
 */
export class AppMetadataRepository {
  private db = getDatabase();
  private logger = Logger.create({ component: 'app-metadata-repository' });

  /** Read the metadata object for an app. Returns `{}` when none exists. */
  get(appId: string): AppMetadata {
    const row = this.db
      .prepare('SELECT metadata FROM app_metadata WHERE app_id = ?')
      .get(appId) as Pick<AppMetadataRow, 'metadata'> | undefined;

    if (!row) return {};

    try {
      return JSON.parse(row.metadata) as AppMetadata;
    } catch {
      // This column is only ever written by merge()'s own JSON.stringify, so
      // invalid JSON here is genuine corruption — surface it at error level.
      this.logger.error('app.metadata.parse.failed', { appId, preview: row.metadata.slice(0, 200) });
      return {};
    }
  }

  /**
   * Shallow-merge `patch` into the app's metadata and persist. Returns the
   * resulting object.
   */
  merge(appId: string, patch: Partial<AppMetadata>): AppMetadata {
    const current = this.get(appId);
    const next = mergeAppMetadata(current, patch);
    const serialized = JSON.stringify(next);

    if (serialized.length > MAX_METADATA_SERIALIZED_CHARS) {
      throw new MetadataTooLargeError(serialized.length, MAX_METADATA_SERIALIZED_CHARS);
    }

    this.db
      .prepare(
        `INSERT INTO app_metadata (app_id, metadata, created_at, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(app_id) DO UPDATE SET
           metadata = excluded.metadata,
           updated_at = CURRENT_TIMESTAMP`
      )
      .run(appId, serialized);

    this.logger.info('app.metadata.set', { appId, keys: Object.keys(patch) });

    return next;
  }
}
