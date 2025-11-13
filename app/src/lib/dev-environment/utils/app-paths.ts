/**
 * Centralized utility for constructing app directory paths
 * Ensures consistent path construction across all dev environment services
 */

import path from 'path';

/**
 * Get the base directory for all apps
 */
export function getAppsBaseDir(): string {
	return process.env.APPS_BASE_DIR || '/tmp/apps';
}

/**
 * Get the base path for a given appId
 * Example: /tmp/apps/{appId}
 */
export function getBasePath(appId: string): string {
	return path.join(getAppsBaseDir(), appId);
}

/**
 * Get the app code path for a given appId
 * This is where the application code and template files are stored
 * Example: /tmp/apps/{appId}/app
 */
export function getAppPath(appId: string): string {
	return path.join(getBasePath(appId), 'app');
}

/**
 * Get the alloc path for a given appId
 * This is where configuration and secrets are stored
 * Example: /tmp/apps/{appId}/alloc
 */
export function getAllocPath(appId: string): string {
	return path.join(getBasePath(appId), 'alloc');
}
