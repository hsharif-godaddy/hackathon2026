import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'nomad-config' });

const NEGATIVE_CACHE_TTL_MS = 5_000;

let cachedConfig: Record<string, { VALUE: string }> | null | undefined;
let negativeCacheExpiry = 0;

/**
 * Reads configuration from Nomad alloc directory if it exists.
 * Successful reads are cached permanently (memoized).
 * Missing/invalid config is negative-cached for 5s so that late-arriving
 * config.json (normal Nomad startup race) gets picked up on retry without
 * hitting the filesystem on every call.
 */
export function getNomadAllocConfig(): Record<string, { VALUE: string }> | null {
  if (cachedConfig !== undefined) return cachedConfig; // memoized successful read
  if (Date.now() < negativeCacheExpiry) return null; // negative cache still valid

  const allocConfigPath = join(env.NOMAD_ALLOC_DIR || '/alloc', 'config.json');
  if (!existsSync(allocConfigPath)) {
    negativeCacheExpiry = Date.now() + NEGATIVE_CACHE_TTL_MS;
    return null;
  }

  try {
    const raw = readFileSync(allocConfigPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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

  negativeCacheExpiry = Date.now() + NEGATIVE_CACHE_TTL_MS;
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

