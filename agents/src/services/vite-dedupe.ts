/**
 * Ensure resolve.dedupe includes react and react-dom in the app's vite config.
 * Called by skill onInstall hooks when installing packages that may bundle
 * their own React copy (e.g. better-auth) to prevent dual-instance crashes.
 * Non-fatal: logs warnings on failure but never throws.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { processAndGenerateViteConfig } from './ViteConfigModifier.js';
import { logger } from '../logging/index.js';

/** Vite config file names to check */
const VITE_CONFIG_FILES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'] as const;

export function ensureViteResolveDedupe(appPath: string): void {
  try {
    // Find vite config file
    let configFile: string | null = null;
    for (const name of VITE_CONFIG_FILES) {
      const fullPath = join(appPath, name);
      if (existsSync(fullPath)) {
        configFile = name;
        break;
      }
    }

    if (!configFile) {
      logger.info('skill.vite-dedupe.no-config', { appPath });
      return;
    }

    const fullPath = join(appPath, configFile);
    const content = readFileSync(fullPath, 'utf8');
    const isTypeScript = configFile.endsWith('.ts') || configFile.endsWith('.mts') || configFile.endsWith('.cts');

    const result = processAndGenerateViteConfig(content, isTypeScript);

    if (result.error) {
      logger.warn('skill.vite-dedupe.process-error', { configFile, error: result.error });
      return;
    }

    if (!result.modified) {
      logger.info('skill.vite-dedupe.no-changes', { configFile });
      return;
    }

    writeFileSync(fullPath, result.code, 'utf8');
    logger.info('skill.vite-dedupe.patched', { configFile });
  } catch (error) {
    logger.warn('skill.vite-dedupe.failed', {
      appPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
