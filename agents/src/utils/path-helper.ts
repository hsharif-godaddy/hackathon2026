/**
 * Path utilities for handling Docker path translation and asset path resolution
 */

import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'path-helper' });

/**
 * Translate Docker container paths to relative paths for the agent environment.
 * Docker containers use /app/ as root, but agents use /tmp/apps/appid/ or similar.
 * 
 * @param path - The file path that might be a Docker absolute path
 * @returns The normalized relative path
 */
export function translateDockerPath(path: string): string {
  // Translate Docker paths to relative paths
  let normalizedPath = path;
  
  if (path.startsWith('/app/')) {
    // Strip /app/ prefix to make it relative
    normalizedPath = path.slice(5); // Remove '/app/' (5 characters)
    logger.debug('path-helper.docker-translation', {
      originalPath: path,
      normalizedPath,
    });
  } else if (path.startsWith('/')) {
    // Handle other absolute paths by making them relative
    // This shouldn't normally happen, but provides a fallback
    normalizedPath = path.slice(1);
    logger.warn('path-helper.absolute-to-relative', {
      originalPath: path,
      normalizedPath,
    });
  }
  
  return normalizedPath;
}

/**
 * Derive the assets base directory from the app path.
 *
 * - Local dev: appPath ends with /preview → assets at sibling {basePath}/assets
 * - Production: CEPH_STORAGE_DIR is set → assets at {ceph}/preview/assets
 */
export function deriveAssetsDir(appPath: string): string | null {
  if (appPath.endsWith('/preview')) {return appPath.replace(/\/preview$/, '/assets');}
  if (process.env.CEPH_STORAGE_DIR) {return `${process.env.CEPH_STORAGE_DIR}/preview/assets`;}
  return null;
}

/**
 * Check whether filePath is safely within appPath (no traversal, no escaping symlinks).
 * Allows symlinks to the known assets directory for bind mount compatibility.
 */
export function isPathSafe(filePath: string, appPath: string): boolean {
  try {
    const resolved = resolve(filePath);
    const rel = relative(appPath, resolved);
    if (rel === '..' || rel.startsWith(`..${sep}`)) {
      return false;
    }
    const assetsDir = deriveAssetsDir(appPath);
    validateNoEscapingSymlinks(resolved, appPath, assetsDir ? [assetsDir] : []);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that no symlinks in the path chain point outside the allowed directories.
 * The basePath is always allowed. Additional trusted directories (e.g. the assets
 * directory for the public/assets symlink) can be passed via allowedPaths.
 *
 * Uses realpathSync on basePath/allowedPaths to handle platform symlinks
 * (e.g. macOS /var → /private/var) consistently.
 */
export function validateNoEscapingSymlinks(
  targetPath: string,
  basePath: string,
  allowedPaths: string[] = []
): void {
  const resolvedBase = realpathSync(basePath);
  const resolvedAllowed = allowedPaths
    .filter(p => existsSync(p))
    .map(p => realpathSync(p));

  const pathParts = relative(basePath, targetPath).split('/').filter(Boolean);
  let currentPath = basePath;

  for (const part of pathParts) {
    currentPath = resolve(currentPath, part);

    if (existsSync(currentPath)) {
      try {
        const stats = lstatSync(currentPath);

        if (stats.isSymbolicLink()) {
          const realPath = realpathSync(currentPath);

          const rel = relative(resolvedBase, realPath);
          if (rel === '..' || rel.startsWith(`..${sep}`)) {
            const isAllowed = resolvedAllowed.some(
              allowed => {
                const allowedRel = relative(allowed, realPath);
                return allowedRel !== '..' && !allowedRel.startsWith(`..${sep}`);
              }
            );
            if (!isAllowed) {
              throw new Error(
                `Security violation: symlink points outside the app directory. ` +
                `Link: ${currentPath}, Target: ${realPath}, App path: ${basePath}`
              );
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Security violation')) {
          throw error;
        }
      }
    }
  }
}