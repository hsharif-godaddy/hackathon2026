import path from 'node:path';

/**
 * Get the public subdirectory for persistent asset storage (server-side writes by agent).
 *
 * - When SHARED_STORAGE_DIR is set (future): returns {SHARED_STORAGE_DIR}/public/assets
 * - Container mode (appPath is /app): returns {appPath}/public/assets (container mount point)
 * - Host mode (local dev): returns {appPath}/../assets/public (host assets directory)
 */
export function getPersistentPublicDir(appPath: string): string {
  if (process.env.SHARED_STORAGE_DIR) {
    return path.join(process.env.SHARED_STORAGE_DIR, 'public', 'assets');
  }

  // Container mode: appPath is /app, write to container mount point
  if (appPath === '/app' || appPath.startsWith('/app/')) {
    return path.join(appPath, 'public', 'assets');
  }

  // Host mode (local dev): agents run on host, write to host assets directory
  // appPath is /tmp/airo-app-builder/{appId}/preview
  // assets dir is /tmp/airo-app-builder/{appId}/assets
  return path.join(path.dirname(appPath), 'assets', 'public');
}

/**
 * Get the private subdirectory for persistent asset storage.
 *
 * - Container mode (appPath is /app): returns /private (container mount point)
 * - Host mode (local dev): returns {appPath}/../assets/private (host path)
 *
 * Note: Private assets are mounted at /private (not under SHARED_STORAGE_DIR).
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
 * Files are stored in the /assets subdirectory to match Vite's static serving:
 * - URL /assets/foo.png maps to {publicDir}/assets/foo.png
 *
 * In the current v4 layout (without SHARED_STORAGE_DIR):
 * - Public assets are at /app/public/assets (bound to preview/publish containers)
 * - Private assets are at /private
 *
 * When SHARED_STORAGE_DIR is set (future shared storage):
 * - Public assets are at {SHARED_STORAGE_DIR}/public/assets
 * - Private assets remain at /private
 */
export function getPersistentAssetPaths(): { persistentPublicPath: string; persistentPrivatePath: string } {
  if (process.env.SHARED_STORAGE_DIR) {
    return {
      persistentPublicPath: path.join(process.env.SHARED_STORAGE_DIR, 'public', 'assets'),
      persistentPrivatePath: '/private',
    };
  }

  // V4 default layout: public assets mounted at /app/public/assets
  return {
    persistentPublicPath: '/app/public/assets',
    persistentPrivatePath: '/private',
  };
}
