/**
 * App Download Configuration
 *
 * Defines which files and directories are included when users download their app.
 * Uses an ALLOWLIST approach for security - only explicitly listed items are included.
 *
 * The canonical list of directories and config files lives in @airo/shared/app-structure
 * and is shared with the app-import (upload) flow.
 *
 * @see agents/src/server/routes/apps.ts for usage
 */

import { APP_CONFIG_FILES, APP_DIRECTORIES } from '@airo/shared/app-structure'

/**
 * Directories to include in the download
 * These contain user-created code and assets
 */
export const ALLOWED_DIRECTORIES = APP_DIRECTORIES

/**
 * Configuration files to include in the download
 * Only files that exist will be included - missing files are silently skipped
 *
 * The download also includes lock files (not included in the shared list
 * since they are skipped on import to avoid conflicts).
 */
export const ALLOWED_CONFIG_FILES = [
  ...APP_CONFIG_FILES,
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
] as const;

/**
 * Files and directories that are EXCLUDED (our internal infrastructure)
 *
 * This is documented here for reference, but the allowlist approach means
 * anything not explicitly listed above is automatically excluded.
 *
 * Examples of what gets excluded:
 * - All .sh files (if any exist in customer code)
 * - airo-secrets/ folder
 * - dev-tools/ folder (Airo visual editor)
 * - Dockerfile and Dockerfile.dev
 * - fullstory-plugin.ts (analytics)
 * - .api/ folder (API tooling)
 * - .ssl/ folder (SSL certificates)
 * - source-mapper/ folder
 * - Any other Airo platform infrastructure
 */
