import { mkdirSync, writeFileSync, rmSync, readdirSync, cpSync, existsSync, readFileSync } from 'fs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, normalize, resolve, basename, relative, sep } from 'path'
import { createHash } from 'crypto'
import { x as extractTar } from 'tar'
import { logger } from '../../logging/index.js'
import type { WorkspaceClient } from '../../workspace/index.js'
import { fetchDesignSystemCatalog, resolveDesignSystemBaseUrl } from './catalog.js'
import { createForWorkspace } from '../../workspace/index.js'
import { AppMetadataRepository } from '../../database/index.js'
import type { DesignKitRef } from '../../types/design-kit.js'
import type { DesignSystemCatalogEntry, DesignKitDesign } from './types.js'
import { extractKitTokens } from './kit-tokens.js'
import type { BrandKitTokens } from '@airo/shared/brand-data'

const UPLOAD_CONCURRENCY = 8

export interface InstallDesignSystemInput {
  workspace: WorkspaceClient
  entry: DesignSystemCatalogEntry
  baseUrl: string
}

export interface InstallDesignSystemResult {
  slug: string
  written: number
  /** Element shape tokens parsed from the kit's anchor.json (if present). */
  tokens?: BrandKitTokens
}

function isSafeRel(rel: string): boolean {
  if (!rel) return false
  if (rel.includes('\0')) return false
  if (rel.startsWith('/')) return false
  const norm = normalize(rel)
  if (norm.startsWith('..') || norm.includes(`${'/'}..${'/'}`)) return false
  return true
}

function isAppleDouble(entryPath: string): boolean {
  return basename(entryPath).startsWith('._')
}

/** Recursively collect all file paths under a directory (relative to root). */
function collectFiles(dir: string, root: string = dir): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath: string = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, root))
    } else {
      results.push(relative(root, fullPath))
    }
  }
  return results
}

/** Run async work over items with bounded parallelism. */
async function withConcurrency<T>(
  items: readonly T[],
  cap: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue: T[] = [...items]
  await Promise.all(
    Array.from({ length: Math.min(cap, queue.length) }, async () => {
      while (queue.length > 0) {
        const item: T | undefined = queue.shift()
        if (item === undefined) break
        await worker(item)
      }
    }),
  )
}

export type InstallDesignKitResult =
  | { slug: string; written: number; message: string; displayName: string; design?: DesignKitDesign; questions: string[] }
  | { error: 'slug_not_found' | 'workspace_unavailable' }

/**
 * Canonical install sequence used by both the AI tool and the forced-install preflight.
 * Encapsulates: catalog fetch → slug lookup → workspace resolve → install → success message.
 * Returns a structured result; never throws for expected error cases.
 */
export async function installDesignKitForApp(appId: string, slug: string): Promise<InstallDesignKitResult> {
  const catalog = await fetchDesignSystemCatalog()
  // Resolve against id/slug/displayName, case-insensitively. `slug` is being
  // deprecated and its casing now tracks `displayName` (e.g. "Terra", not
  // "terra"), so an exact slug match is brittle — the agent or a manual entry
  // routinely passes a normalized-case value. `id` is the stable join key.
  const needle = slug.trim().toLowerCase()
  // Match with explicit field precedence — id (the stable join key) over slug,
  // slug over displayName — so an ambiguous catalog (two different kits sharing a
  // normalized value across fields) resolves deterministically instead of by
  // array order. If more than one DISTINCT kit matches, warn: that signals bad
  // catalog data, not a normal slug==displayName overlap on a single kit.
  const byId = catalog.kits.find(k => k.id.toLowerCase() === needle)
  const bySlug = catalog.kits.find(k => k.slug.toLowerCase() === needle)
  const byDisplayName = catalog.kits.find(k => k.displayName.toLowerCase() === needle)
  const entry = byId ?? bySlug ?? byDisplayName
  if (!entry) return { error: 'slug_not_found' }

  const matchedIds = [...new Set([byId, bySlug, byDisplayName].filter(Boolean).map(k => k!.id))]
  if (matchedIds.length > 1) {
    logger.warn('design_system.install.ambiguous_match', { needle, matchedIds, chosenId: entry.id })
  }

  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) return { error: 'workspace_unavailable' }

  const result = await installDesignSystem({ workspace, entry, baseUrl: resolveDesignSystemBaseUrl() })

  try {
    // Record the matched catalog entry's stable identity (id + displayName),
    // plus kitId when the kit has one. This is the single source of truth for
    // the chosen kit: the brand-data route reads `designKit` to surface the
    // wizard's "Design kit" row, and it doubles as provenance/instrumentation.
    const designKit: DesignKitRef = {
      source: 'catalog',
      id: entry.id,
      displayName: entry.displayName,
      ...(entry.kitId ? { kitId: entry.kitId } : {}),
    }
    new AppMetadataRepository().merge(appId, { designKit })
  } catch (metaErr) {
    // Metadata is best-effort instrumentation — never fail the install over it.
    logger.warn('design_system.install.metadata_failed', { appId, slug: result.slug, err: String(metaErr) })
  }

  const message = `Installed design system \`${result.slug}\` (${result.written} files extracted to docs/ui-kit/). Call \`loadUiKit\` next to read the design system primitives and components.`
  return { slug: result.slug, written: result.written, message, displayName: entry.displayName, design: entry.design, questions: entry.questions ?? [] }
}

export async function installDesignSystem(input: InstallDesignSystemInput): Promise<InstallDesignSystemResult> {
  const { workspace, entry, baseUrl } = input
  const url = `${baseUrl.replace(/\/$/, '')}/${entry.tarball}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`design-system download ${response.status}`)
  const buf = Buffer.from(await response.arrayBuffer())

  const expected = entry.tarballHash.replace(/^sha256-/i, '').toLowerCase()
  const actual = createHash('sha256').update(buf).digest('hex').toLowerCase()
  if (!actual.startsWith(expected)) {
    throw new Error(`design-system hash mismatch for ${entry.slug}: expected sha256-${expected}, got sha256-${actual}`)
  }

  const stage = mkdtempSync(join(tmpdir(), 'design-system-dl-'))
  const tarPath = join(stage, 'kit.tar.gz')
  const extractDir = join(stage, 'extracted')
  const assembledDir = join(stage, 'assembled')
  mkdirSync(extractDir, { recursive: true })
  mkdirSync(assembledDir, { recursive: true })
  writeFileSync(tarPath, buf)

  const assembledResolved = resolve(assembledDir)

  try {
    await extractTar({
      file: tarPath,
      cwd: extractDir,
      filter: (path: string) => {
        if (isAppleDouble(path)) return false
        if (!isSafeRel(path)) {
          logger.warn('design_system.install.unsafe_entry_skipped', { path, slug: entry.slug })
          return false
        }
        return true
      },
    })

    // The tarball may have content nested under kits/<uuid>/.
    // Flatten: copy kits/<uuid>/* to assembled dir, then copy any root-level files.
    const kitsDir = join(extractDir, 'kits')
    if (existsSync(kitsDir)) {
      const kitDirs = readdirSync(kitsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      for (const kitDir of kitDirs) {
        const kitSrc = join(kitsDir, kitDir.name)
        cpSync(kitSrc, assembledDir, { recursive: true })
      }
    }

    // Copy root-level files (like anchor.json) excluding kits/ dir
    for (const extractedEntry of readdirSync(extractDir, { withFileTypes: true })) {
      if (extractedEntry.name === 'kits') continue
      if (extractedEntry.name.startsWith('._')) continue
      const src = join(extractDir, extractedEntry.name)
      const dest = join(assembledDir, extractedEntry.name)
      const destResolved = resolve(dest)
      if (destResolved !== assembledResolved && !normalize(destResolved).startsWith(assembledResolved + sep)) {
        logger.warn('design_system.install.escape_attempt_skipped', { path: extractedEntry.name, slug: entry.slug })
        continue
      }
      cpSync(src, dest, { recursive: true })
    }

    // Upload assembled files to workspace via dev-supervisor.
    // Note: unlike the old atomic cpSync, per-file upload means a mid-way failure
    // leaves docs/ui-kit/ partially written. The tool surfaces the error so the
    // agent won't call loadUiKit, and a retry overwrites existing files.
    const filePaths = collectFiles(assembledDir)
    await withConcurrency(filePaths, UPLOAD_CONCURRENCY, async (relPath) => {
      const data = readFileSync(join(assembledDir, relPath))
      await workspace.files.upload({ path: `docs/ui-kit/${relPath}`, data })
    })

    // Parse the kit's anchor.json (if present) into compact element shape tokens
    // for the wizard's Elements preview. Best-effort + non-fatal.
    let tokens: BrandKitTokens | undefined
    try {
      const anchorPath = join(assembledDir, 'anchor.json')
      if (existsSync(anchorPath)) {
        tokens = extractKitTokens(JSON.parse(readFileSync(anchorPath, 'utf-8')))
      }
    } catch (err) {
      logger.warn('design_system.install.anchor_parse_failed', { slug: entry.slug, err: String(err) })
    }

    return { slug: entry.slug, written: filePaths.length, tokens }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}
