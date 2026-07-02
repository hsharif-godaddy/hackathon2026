/**
 * JWT Regeneration Utility
 *
 * Provides helpers to regenerate JWT tokens before sensitive operations
 * to ensure permissions are fresh and prevent replay attacks.
 */

import { appFetch } from '@/lib/gasket-config';
import { getStoredStartProfile } from '@/lib/quick-create';
import { logger } from '@/lib/request-context';

export interface RegenerateTokenOptions {
  siteId: string;
  /**
   * Force regeneration even if cached token is valid
   * Default: true
   */
  force?: boolean;
}

export interface RegenerateTokenResult {
  token: string;
  expires: string;
  siteId: string;
  type: string;
}

/**
 * Regenerate JWT token for a site with fresh permissions
 *
 * This should be called before sensitive operations like publish or download
 * to ensure the user still has the required permissions.
 *
 * @param options - Token regeneration options
 * @returns Fresh JWT token with updated permissions
 * @throws Error if token generation fails
 */
export async function regenerateToken(
  options: RegenerateTokenOptions
): Promise<RegenerateTokenResult> {
  const { siteId, force = true } = options;

  try {
    logger.info('jwt.regenerate.start', { siteId, force });

    // Use standard 12-hour TTL (consistent with regular JWT tokens)
    // Permission checks happen at operation time, not token expiration
    const expiresInSeconds = 12 * 60 * 60; // 12 hours

    const response = await appFetch('/api/auth/agent-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteId,
        expiresInSeconds,
        // Internal-only "start-as" profile (?profile=); server ignores it unless internal.
        agentProfileOverride: getStoredStartProfile(siteId) ?? undefined,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: 'Failed to regenerate token',
      }));

      logger.error('jwt.regenerate.failed', {
        siteId,
        status: response.status,
        error: errorData.error,
      });

      throw new Error(errorData.error || 'Failed to regenerate token');
    }

    const result: RegenerateTokenResult = await response.json();

    logger.info('jwt.regenerate.success', {
      siteId,
      expires: result.expires,
    });

    return result;
  } catch (error) {
    logger.error('jwt.regenerate.error', {
      siteId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

/**
 * Regenerate token and return just the token string
 *
 * Convenience wrapper around regenerateToken() for simple use cases
 *
 * @param siteId - Site ID to generate token for
 * @returns JWT token string
 */
export async function getFreshToken(siteId: string): Promise<string> {
  const result = await regenerateToken({ siteId, force: true });
  return result.token;
}
