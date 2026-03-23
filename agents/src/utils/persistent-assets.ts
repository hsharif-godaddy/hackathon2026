import path from 'node:path';

/**
 * Get the public subdirectory for persistent asset storage.
 *
 * - Production (PERSISTENT_ASSETS_DIR set): returns {PERSISTENT_ASSETS_DIR}/public
 * - Local dev (no env var): falls back to {appPath}/public (standard workspace location)
 */
export function getPersistentPublicDir(appPath: string): string {
  if (process.env.PERSISTENT_ASSETS_DIR) {
    return path.join(process.env.PERSISTENT_ASSETS_DIR, 'public');
  }
  return path.join(appPath, 'public');
}
