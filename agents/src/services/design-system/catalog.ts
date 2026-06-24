import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../../logging/index.js'
import {
  DesignSystemCatalogEntrySchema,
  DesignSystemCatalogEnvelopeSchema,
  type DesignSystemCatalog,
  type DesignSystemCatalogEntry,
} from './types.js'

const DEFAULT_CACHE_PATH = 'agents/data/design-system-catalog.json'
const DEFAULT_TTL_MS = 10 * 60 * 1000

let memCache: { at: number; data: DesignSystemCatalog } | null = null

export function _resetCacheForTest(): void { memCache = null }

export function resolveDesignSystemBaseUrl(): string {
  const override = process.env.BRAND_KIT_BASE_URL
  if (override && override.trim().length > 0) return override
  return 'https://blobby.wsimg.com/brand-kits'
}

/**
 * Resolve a catalog thumbnail/image path to an absolute URL. The live catalog stores
 * these relative to the brand-kit base (e.g. `thumbnails/<id>/<hash>.webp`); an
 * already-absolute URL is returned unchanged.
 */
export function resolveDesignSystemAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = resolveDesignSystemBaseUrl().replace(/\/+$/, '')
  return `${base}/${path.replace(/^\/+/, '')}`
}

export interface FetchOptions {
  cachePath?: string
  ttlMs?: number
}

/**
 * Validate the catalog entry-by-entry so one malformed kit drops out instead of
 * failing the whole catalog. The install path gates on `slug`/`tarball`, and the
 * tracking fields (`id`/`displayName`/`kitId`) are required at the entry level —
 * so without this, a single bad remote entry would throw on the up-front array
 * parse and break *every* install. The envelope (version/generatedAt/kits-array)
 * is still strict: a structurally broken document throws as before.
 */
export function parseCatalog(raw: unknown): DesignSystemCatalog {
  const { version, generatedAt, kits: rawKits } = DesignSystemCatalogEnvelopeSchema.parse(raw)
  const kits: DesignSystemCatalogEntry[] = []
  for (const entry of rawKits) {
    const result = DesignSystemCatalogEntrySchema.safeParse(entry)
    if (result.success) {
      kits.push(result.data)
    } else {
      // Log each dropped kit with its slug (untouched on the entry) so a future
      // catalog regression that omits required id/displayName is traceable to the
      // offending kit — otherwise it silently vanishes from install availability
      // and the agent's "use the slug verbatim" instruction resolves to "not found".
      logger.warn('design_system.catalog.entry_dropped', {
        slug: (entry as { slug?: unknown })?.slug,
        issues: result.error.issues,
      })
    }
  }
  return { version, generatedAt, kits }
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
    const parsed = parseCatalog(raw)
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
        const parsed = parseCatalog(onDisk)
        memCache = { at: now, data: parsed }
        return parsed
      } catch (diskErr) {
        logger.warn('design_system.catalog.disk_cache_corrupt', { cachePath, err: String(diskErr) })
      }
    }
    throw err
  }
}
