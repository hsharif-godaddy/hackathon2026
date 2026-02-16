/**
 * Centralized utility for constructing app directory paths
 * Ensures consistent path construction across all dev environment services
 */

import path from 'path';

/**
 * Validates that appId is safe and doesn't contain path traversal sequences
 * @throws Error if appId contains dangerous characters
 */
function validateAppId(appId: string): void {
	if (!appId || typeof appId !== 'string') {
		throw new Error('Invalid appId: must be a non-empty string');
	}

	// Check for path traversal attempts
	if (appId.includes('..') || appId.includes('/') || appId.includes('\\')) {
		throw new Error(`Invalid appId: contains path traversal characters: ${appId}`);
	}

	// Check for null bytes (can bypass security checks)
	if (appId.includes('\0')) {
		throw new Error(`Invalid appId: contains null byte: ${appId}`);
	}

	// Ensure it's a valid UUID or nanoID format (alphanumeric and hyphens only)
	if (!/^[a-zA-Z0-9-]+$/.test(appId)) {
		throw new Error(`Invalid appId: must contain only alphanumeric characters and hyphens: ${appId}`);
	}
}

/**
 * Get the base directory for all apps
 * Defaults to /tmp/airo-app-builder for stable, cross-process access
 *
 * Uses /tmp instead of os.tmpdir() because:
 * - /tmp is stable across restarts and processes
 * - os.tmpdir() returns session-specific paths on macOS (/var/folders/...)
 * - Both app and agents services need the same path
 *
 * For Windows or custom locations, set APPS_BASE_DIR environment variable
 */
export function getAppsBaseDir(): string {
	return process.env.APPS_BASE_DIR || '/tmp/airo-app-builder';
}

/**
 * Get the base path for a given appId
 * Example: /tmp/apps/{appId}
 */
export function getBasePath(appId: string): string {
	validateAppId(appId);
	return path.join(getAppsBaseDir(), appId);
}

/**
 * Get the app code path for a given appId
 * This is where the application code and template files are stored
 * Example: /tmp/apps/{appId}/preview
 *
 * V4 Architecture: Returns preview workspace path (agent writes here)
 */
export function getAppPath(appId: string): string {
	return path.join(getBasePath(appId), 'preview');
}

/**
 * Get the preview workspace path for a given appId
 * This is where the agent service writes application code
 * Example: /tmp/apps/{appId}/preview
 */
export function getPreviewPath(appId: string): string {
	return path.join(getBasePath(appId), 'preview');
}

/**
 * Get the publish workspace path for a given appId
 * This is where published app tarballs are extracted
 * Example: /tmp/apps/{appId}/publish
 */
export function getPublishPath(appId: string): string {
	return path.join(getBasePath(appId), 'publish');
}

/**
 * Get the git repository path for a given appId
 * Contains the .git directory, symlinked to preview/.git
 * Example: /tmp/apps/{appId}/git-repo
 */
export function getGitRepoPath(appId: string): string {
	return path.join(getBasePath(appId), 'git-repo');
}

/**
 * Get the assets path for a given appId
 * Contains public and private assets, symlinked to preview/assets
 * Example: /tmp/apps/{appId}/assets
 */
export function getAssetsPath(appId: string): string {
	return path.join(getBasePath(appId), 'assets');
}

/**
 * Get the agent database path for a given appId
 * Example: /tmp/apps/{appId}/agent
 */
export function getAgentPath(appId: string): string {
	return path.join(getBasePath(appId), 'agent');
}

/**
 * Get the distribution archives path for a given appId
 * Example: /tmp/apps/{appId}/dist
 */
export function getDistPath(appId: string): string {
	return path.join(getBasePath(appId), 'dist');
}

/**
 * Get the alloc path for a given appId
 * This is where configuration and secrets are stored
 * Example: /tmp/apps/{appId}/alloc
 */
export function getAllocPath(appId: string): string {
	return path.join(getBasePath(appId), 'alloc');
}
