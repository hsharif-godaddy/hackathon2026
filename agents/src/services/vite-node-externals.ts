/**
 * Ensure Node.js-only packages are excluded from Vite's browser bundling.
 * Called by skill onInstall hooks (e.g. database) to add optimizeDeps.exclude
 * and ssr.external entries to the app's vite config.
 * Non-fatal: logs warnings on failure but never throws.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addNodePackageExclusions, VITE_CONFIG_FILES } from './ViteConfigModifier.js';
import { logger } from '../logging/index.js';

export function ensureViteNodePackagesExcluded(appPath: string, packages: readonly string[]): void {
  try {
    let configFile: string | null = null;
    for (const name of VITE_CONFIG_FILES) {
      const fullPath = join(appPath, name);
      if (existsSync(fullPath)) {
        configFile = name;
        break;
      }
    }

    if (!configFile) {
      logger.info('skill.vite-node-externals.no-config', { appPath });
      return;
    }

    const fullPath = join(appPath, configFile);
    const content = readFileSync(fullPath, 'utf8');
    const isTypeScript = configFile.endsWith('.ts') || configFile.endsWith('.mts') || configFile.endsWith('.cts');

    const result = addNodePackageExclusions(content, isTypeScript, packages);

    if (result.error) {
      logger.warn('skill.vite-node-externals.process-error', { configFile, error: result.error });
      return;
    }

    if (!result.modified) {
      logger.info('skill.vite-node-externals.no-changes', { configFile });
      return;
    }

    writeFileSync(fullPath, result.code, 'utf8');
    logger.info('skill.vite-node-externals.patched', { configFile, packages });
  } catch (error) {
    logger.warn('skill.vite-node-externals.failed', {
      appPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
