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

/**
 * Get the private subdirectory for persistent asset storage.
 *
 * - Container mode (appPath is /app): returns /private (container mount point)
 * - Host mode (local dev): returns {appPath}/../assets/private (host path)
 *
 * Note: Private assets are mounted at /private (not under PERSISTENT_ASSETS_DIR).
 *
 * TODO: This function is currently unused in production code. When implementing tools
 * that need to write private files (e.g., PDF generation, private document storage),
 * use this function to get the correct path instead of hardcoding '/private'.
 */
export function getPersistentPrivateDir(appPath: string): string {
  // Container mode: appPath is /app, write to container mount point
  if (appPath === '/app' || appPath.startsWith('/app/')) {
    return '/private';
  }

  // Host mode (local dev): agents run on host, write to host assets directory
  // appPath is /tmp/airo-app-builder/{appId}/preview
  // assets dir is /tmp/airo-app-builder/{appId}/assets
  return path.join(path.dirname(appPath), 'assets', 'private');
}

/**
 * Get persistent asset paths for agent prompt context.
 * Returns the container-side mount paths that agents should use in generated code.
 *
 * Uses PERSISTENT_ASSETS_DIR if set (defaults to '/shared-storage').
 * Public assets are at {base}/public, private assets remain at /private.
 */
export function getPersistentAssetPaths(): { persistentPublicPath: string; persistentPrivatePath: string } {
  const baseDir = process.env.PERSISTENT_ASSETS_DIR || '/shared-storage';

  return {
    persistentPublicPath: path.join(baseDir, 'public'),
    persistentPrivatePath: '/private',
  };
}
