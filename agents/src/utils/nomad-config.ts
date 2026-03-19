import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'nomad-config' });

let cachedConfig: Record<string, { VALUE: string }> | null | undefined;

/**
 * Reads configuration from Nomad alloc directory if it exists.
 * Results are memoized.
 */
export function getNomadAllocConfig(): Record<string, { VALUE: string }> | null {
  if (cachedConfig !== undefined) {return cachedConfig;} // memoized: null means "no config"

  const allocConfigPath = join(env.NOMAD_ALLOC_DIR || '/alloc', 'config.json');
  if (!existsSync(allocConfigPath)) {
    cachedConfig = null;
    return cachedConfig;
  }

  try {
    const raw = readFileSync(allocConfigPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const config = parsed as Record<string, { VALUE: string }>;
      cachedConfig = config;
      return config;
    }
    logger.error('nomad-config.invalid-structure', { path: allocConfigPath });
  } catch (err) {
    logger.error('nomad-config.read-failed', {
      path: allocConfigPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  cachedConfig = null;
  return cachedConfig;
}
