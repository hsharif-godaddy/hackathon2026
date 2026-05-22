import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../../logging/index.js'
import { DesignSystemCatalogSchema, type DesignSystemCatalog } from './types.js'

const DEFAULT_CACHE_PATH = 'agents/data/design-system-catalog.json'
const DEFAULT_TTL_MS = 10 * 60 * 1000

let memCache: { at: number; data: DesignSystemCatalog } | null = null

export function _resetCacheForTest(): void { memCache = null }

export function resolveDesignSystemBaseUrl(): string {
  const override = process.env.BRAND_KIT_BASE_URL
  if (override && override.trim().length > 0) return override
  return 'https://blobby.wsimg.com/brand-kits'
}

export interface FetchOptions {
  cachePath?: string
  ttlMs?: number
}

export async function fetchDesignSystemCatalog(opts: FetchOptions = {}): Promise<DesignSystemCatalog> {
  const cachePath = opts.cachePath ?? DEFAULT_CACHE_PATH
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const now = Date.now()

  if (memCache && now - memCache.at < ttlMs) return memCache.data

  const url = `${resolveDesignSystemBaseUrl()}/catalog.json`
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`catalog fetch ${response.status}`)
    const raw = await response.json()
    const parsed = DesignSystemCatalogSchema.parse(raw)
    memCache = { at: now, data: parsed }
    try {
      mkdirSync(dirname(cachePath), { recursive: true })
      writeFileSync(cachePath, JSON.stringify(parsed), 'utf-8')
    } catch (err) {
      logger.warn('design_system.catalog.cache_write_failed', { cachePath, err: String(err) })
    }
    return parsed
  } catch (err) {
    const reason = err instanceof SyntaxError ? 'json_invalid'
      : (err as { name?: string }).name === 'ZodError' ? 'schema_invalid'
      : 'network_failed'
    logger.warn(`design_system.catalog.${reason}`, { url, err: String(err) })
    if (existsSync(cachePath)) {
      try {
        const onDisk = JSON.parse(readFileSync(cachePath, 'utf-8'))
        const parsed = DesignSystemCatalogSchema.parse(onDisk)
        memCache = { at: now, data: parsed }
        return parsed
      } catch (diskErr) {
        logger.warn('design_system.catalog.disk_cache_corrupt', { cachePath, err: String(diskErr) })
      }
    }
    throw err
  }
}
