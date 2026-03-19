import { nanoid } from 'nanoid';
import { getDatabase } from '../connection.js';
import type { OAuthToken } from '../schema.js';

/**
 * Database row structure for oauth_tokens table
 * Represents the snake_case column names from SQLite
 */
interface OAuthTokenRow {
    id: string;
    app_id: string;
    provider: string;
    scopes: string;
    access_token_encrypted: string;
    access_token_iv: string;
    access_token_tag: string;
    refresh_token_encrypted: string | null;
    refresh_token_iv: string | null;
    refresh_token_tag: string | null;
    expires_at: number;
    created_at: string;
    updated_at: string;
}

/**
 * Repository for managing OAuth tokens in SQLite database
 *
 * Handles CRUD operations for encrypted OAuth access and refresh tokens.
 * Tokens are stored with AES-256-GCM encryption metadata (IV and auth tag).
 */
export class OAuthTokenRepository {
    private db = getDatabase();

    /**
     * Find a token by app ID and provider
     *
     * @param appId - Unique app identifier
     * @param provider - OAuth provider name (e.g., 'godaddy')
     * @returns Token record if found, null otherwise
     *
     * @example
     * ```typescript
     * const token = repo.findOne('app-123', 'godaddy');
     * if (token && token.expiresAt > Date.now()) {
     *   // Token is valid
     * }
     * ```
     */
    findOne(appId: string, provider: string): OAuthToken | null {
        const stmt = this.db.prepare(`
          SELECT * FROM oauth_tokens 
          WHERE app_id = ? AND provider = ?
        `);

        const row = stmt.get(appId, provider) as OAuthTokenRow | undefined;
        if (!row) {return null;}

        return {
            id: row.id,
            appId: row.app_id,
            provider: row.provider,
            scopes: row.scopes,
            accessTokenEncrypted: row.access_token_encrypted,
            accessTokenIv: row.access_token_iv,
            accessTokenTag: row.access_token_tag,
            ...(row.refresh_token_encrypted && {
                refreshTokenEncrypted: row.refresh_token_encrypted,
            }),
            ...(row.refresh_token_iv && { refreshTokenIv: row.refresh_token_iv }),
            ...(row.refresh_token_tag && { refreshTokenTag: row.refresh_token_tag }),
            expiresAt: row.expires_at,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }

    /**
     * Insert or update a token using UPSERT pattern
     *
     * Uses SQLite's ON CONFLICT clause to handle duplicate keys.
     * The unique constraint is on (app_id, provider).
     * Each app has only ONE token per provider, which is replaced on each new OAuth flow.
     *
     * @param token - Token data without id, createdAt, updatedAt (auto-generated)
     * @returns Newly created or updated token record
     *
     * @example
     * ```typescript
     * const token = repo.upsert({
     *   appId: 'session-123',
     *   provider: 'godaddy',
     *   scopes: 'commerce.product:read commerce.product:write',
     *   accessTokenEncrypted: '...',
     *   accessTokenIv: '...',
     *   accessTokenTag: '...',
     *   expiresAt: Date.now() + 3600000
     * });
     * ```
     */
    upsert(token: Omit<OAuthToken, 'id' | 'createdAt' | 'updatedAt'>): OAuthToken {
        const id = nanoid();
        const now = new Date().toISOString();

        const stmt = this.db.prepare(`
        INSERT INTO oauth_tokens (
          id, app_id, provider, scopes,
          access_token_encrypted, access_token_iv, access_token_tag,
          refresh_token_encrypted, refresh_token_iv, refresh_token_tag,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(app_id, provider) DO UPDATE SET
          scopes = excluded.scopes,
          access_token_encrypted = excluded.access_token_encrypted,
          access_token_iv = excluded.access_token_iv,
          access_token_tag = excluded.access_token_tag,
          refresh_token_encrypted = excluded.refresh_token_encrypted,
          refresh_token_iv = excluded.refresh_token_iv,
          refresh_token_tag = excluded.refresh_token_tag,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `);

        stmt.run(
            id,
            token.appId,
            token.provider,
            token.scopes,
            token.accessTokenEncrypted,
            token.accessTokenIv,
            token.accessTokenTag,
            token.refreshTokenEncrypted || null,
            token.refreshTokenIv || null,
            token.refreshTokenTag || null,
            token.expiresAt,
            now,
            now,
        );

        return this.findOne(token.appId, token.provider)!;
    }

    /**
     * Delete a specific token
     *
     * @param appId - Unique session identifier
     * @param provider - OAuth provider name
     *
     * @example
     * ```typescript
     * repo.delete('session-123', 'godaddy');
     * ```
     */
    delete(appId: string, provider: string): void {
        const stmt = this.db.prepare(`
        DELETE FROM oauth_tokens 
        WHERE app_id = ? AND provider = ?
      `);
        stmt.run(appId, provider);
    }

    /**
     * Find all expired tokens
     *
     * Useful for cleanup jobs that periodically remove stale tokens.
     * Compares expires_at against the current timestamp.
     *
     * @returns Array of expired token records
     *
     * @example
     * ```typescript
     * const expired = repo.findExpired();
     * expired.forEach(token => {
     *   repo.delete(token.appId, token.provider);
     * });
     * ```
     */
    findExpired(): OAuthToken[] {
        const stmt = this.db.prepare(`
        SELECT * FROM oauth_tokens 
        WHERE expires_at < ?
      `);

        const rows = stmt.all(Date.now()) as OAuthTokenRow[];
        return rows.map((row) => ({
            id: row.id,
            appId: row.app_id,
            provider: row.provider,
            scopes: row.scopes,
            accessTokenEncrypted: row.access_token_encrypted,
            accessTokenIv: row.access_token_iv,
            accessTokenTag: row.access_token_tag,
            ...(row.refresh_token_encrypted && {
                refreshTokenEncrypted: row.refresh_token_encrypted,
            }),
            ...(row.refresh_token_iv && { refreshTokenIv: row.refresh_token_iv }),
            ...(row.refresh_token_tag && { refreshTokenTag: row.refresh_token_tag }),
            expiresAt: row.expires_at,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        }));
    }

    /**
     * Delete all tokens for a specific session
     *
     * Used when a user logs out or session is invalidated.
     * Removes all tokens across all providers and scopes for the session.
     *
     * @param appId - Unique session identifier to clear
     *
     * @example
     * ```typescript
     * repo.deleteBySession('session-123');
     * ```
     */
    deleteBySession(appId: string): void {
        const stmt = this.db.prepare(`
        DELETE FROM oauth_tokens 
        WHERE app_id = ?
      `);
        stmt.run(appId);
    }

    /**
     * Find all tokens for a specific session
     *
     * Useful for debugging or displaying all active OAuth connections for a user.
     *
     * @param appId - Unique session identifier
     * @returns Array of token records for the session
     *
     * @example
     * ```typescript
     * const tokens = repo.findBySession('session-123');
     * tokens.forEach(token => {
     *   console.log(`${token.provider}: ${token.scopes}`);
     * });
     * ```
     */
    findBySession(appId: string): OAuthToken[] {
        const stmt = this.db.prepare(`
        SELECT * FROM oauth_tokens 
        WHERE app_id = ?
      `);

        const rows = stmt.all(appId) as OAuthTokenRow[];
        return rows.map((row) => ({
            id: row.id,
            appId: row.app_id,
            provider: row.provider,
            scopes: row.scopes,
            accessTokenEncrypted: row.access_token_encrypted,
            accessTokenIv: row.access_token_iv,
            accessTokenTag: row.access_token_tag,
            ...(row.refresh_token_encrypted && {
                refreshTokenEncrypted: row.refresh_token_encrypted,
            }),
            ...(row.refresh_token_iv && { refreshTokenIv: row.refresh_token_iv }),
            ...(row.refresh_token_tag && { refreshTokenTag: row.refresh_token_tag }),
            expiresAt: row.expires_at,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        }));
    }
}
