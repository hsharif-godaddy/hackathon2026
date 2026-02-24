/**
 * App Download Configuration
 *
 * Defines which files and directories are included when users download their app.
 * Uses an ALLOWLIST approach for security - only explicitly listed items are included.
 *
 * @see agents/src/server/routes/apps.ts for usage
 */

/**
 * Directories to include in the download
 * These contain user-created code and assets
 */
export const ALLOWED_DIRECTORIES = [
  'src',    // User source code
  'public', // User assets
] as const;

/**
 * Configuration files to include in the download
 * Only files that exist will be included - missing files are silently skipped
 *
 * Categories:
 * - Package Management: Dependencies and lock files
 * - TypeScript: Type checking and compilation
 * - Build Tools: Bundlers and build configuration
 * - Testing: Test framework configuration
 * - Styling: CSS framework configuration
 * - Linting/Formatting: Code quality tools
 * - Database: ORM and schema configuration
 * - UI Components: Component library configuration
 * - Entry Points: Application entry files
 * - Build Scripts: Custom build scripts
 * - Environment: Environment configuration templates
 * - Documentation: Project documentation
 */
export const ALLOWED_CONFIG_FILES = [
  // Package management
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',

  // TypeScript
  'tsconfig.json',
  'tsconfig.node.json',

  // Build tools
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.js',
  'vite.config.ts',
  'vite.config.mjs',

  // Testing
  'vitest.config.js',
  'vitest.config.ts',
  'jest.config.js',
  'jest.config.ts',

  // Styling
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'postcss.config.mjs',

  // Linting/Formatting
  'eslint.config.js',
  'eslint.config.mjs',
  '.eslintrc.js',
  '.eslintrc.json',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',

  // Database
  'drizzle.config.ts',
  'drizzle.config.js',

  // UI Components
  'components.json',

  // Entry points
  'index.html',

  // Build scripts
  'bundle.js',

  // Environment & Git
  'env.example',
  '.env.example',
  '.gitignore',
  '.npmrc',

  // Documentation
  'README.md',
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
