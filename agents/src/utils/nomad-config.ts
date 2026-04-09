import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'nomad-config' });

let cachedConfig: Record<string, { VALUE: string }> | null | undefined;

/**
 * Reads configuration from Nomad alloc directory if it exists.
 * Only caches successful reads — missing/invalid config is NOT cached so that
 * late-arriving config.json (normal Nomad startup race) gets picked up on retry.
 */
export function getNomadAllocConfig(): Record<string, { VALUE: string }> | null {
  if (cachedConfig !== undefined) return cachedConfig; // memoized successful read

  const allocConfigPath = join(env.NOMAD_ALLOC_DIR || '/alloc', 'config.json');
  if (!existsSync(allocConfigPath)) {
    return null;
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

  return null;
}

/**
 * Gets a specific config value from Nomad alloc config with a default fallback.
 * Internally uses getNomadAllocConfig() which is memoized.
 * @param key - The config key to retrieve (e.g., 'PRODUCT_ID', 'DATABASE')
 * @param defaultValue - Value to return if key doesn't exist, config is unavailable, or value is empty string
 * @returns The config value or the default value
 */
export function getNomadAllocConfigValue(key: string, defaultValue: string): string {
  const config = getNomadAllocConfig();
  const value = config?.[key]?.VALUE;
  // Guard against non-string VALUEs (e.g. DATABASE has an object VALUE)
  // Use || instead of ?? to treat empty strings as missing (consistent with Go implementation)
  return typeof value === 'string' && value ? value : defaultValue;
}

