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
import { updateCssRadius } from './radius-css.js'
import type { BrandKitTokens } from '@airo/shared/brand-data'

const UPLOAD_CONCURRENCY = 8

/** AIROBUILD-2845: bound the transient-install retry to one extra attempt on the
 *  turn-1 critical path; a short backoff covers the workspace-bind / download race
 *  without hurting time-to-first-token. */
const MAX_INSTALL_ATTEMPTS = 2
const INSTALL_RETRY_BACKOFF_MS = 300

/** A transient tarball-download failure thrown by installDesignSystem — an HTTP
 *  status response (`design-system download <status>`) or a normalized socket-level
 *  rejection (`design-system download network: …`). Both are retryable. The
 *  deterministic `design-system hash mismatch …` throw deliberately does NOT match
 *  this prefix, and upload failures (different message) are likewise excluded. */
function isTransientDownloadError(err: unknown): boolean {
  return err instanceof Error && /^design-system download /.test(err.message)
}

/** Internal marker so the download try/catch can tell a non-OK HTTP response
 *  apart from a socket-level rejection and normalize each to its own message. */
class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`http status ${status}`)
  }
}

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

  // Bounded retry for TRANSIENT install failures only (AIROBUILD-2845): the
  // workspace bind races dev-supervisor registration (`workspace_unavailable`),
  // and the tarball download can hit a transient 5xx or socket-level blip. Both
  // clear on a quick retry. Deterministic failures — `slug_not_found` (handled
  // above, never reaches here) and a tarball hash mismatch (a real integrity/config
  // bug) — are NOT retried: retrying only burns turn-1 latency/budget. The retried
  // section (resolve workspace → installDesignSystem) is idempotent: it runs before
  // any token-apply/metadata side effects, and a re-upload overwrites prior files.
  for (let attempt = 1; attempt <= MAX_INSTALL_ATTEMPTS; attempt++) {
    const isLastAttempt = attempt === MAX_INSTALL_ATTEMPTS
    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) {
      if (isLastAttempt) return { error: 'workspace_unavailable' }
      logger.warn('design_system.install.retry', { reason: 'workspace_unavailable', appId, attempt })
      await new Promise<void>((done: () => void) => setTimeout(done, INSTALL_RETRY_BACKOFF_MS))
      continue
    }

    let result: InstallDesignSystemResult
    try {
      result = await installDesignSystem({ workspace, entry, baseUrl: resolveDesignSystemBaseUrl() })
    } catch (err) {
      if (isTransientDownloadError(err) && !isLastAttempt) {
        logger.warn('design_system.install.retry', { reason: 'download_failed', appId, attempt, err: String(err) })
        await new Promise<void>((done: () => void) => setTimeout(done, INSTALL_RETRY_BACKOFF_MS))
        continue
      }
      throw err
    }

    try {
      // Record the matched catalog entry's stable identity (id + displayName),
      // plus kitId when the kit has one. This is the single source of truth for
      // the chosen kit: the brand-data route reads `designKit` to surface the
      // wizard's "Design kit" row, and it doubles as provenance/instrumentation.
      // AIROBUILD-3232 item 7: prefer the kit's full-page preview screenshot, but fall
      // back to its thumbnail so EVERY kit has a real screenshot for the build animation
      // to assemble — many catalog entries ship only a thumbnail (e.g. Ascent), and
      // without this the animation silently fell back to the generic skeleton.
      const previewPath = entry.images?.preview ?? entry.thumbnail ?? entry.images?.thumbnail
      const designKit: DesignKitRef = {
        source: 'catalog',
        id: entry.id,
        displayName: entry.displayName,
        ...(entry.kitId ? { kitId: entry.kitId } : {}),
        // Also stamp the kit's anchor.json shape tokens so the animation mirrors the
        // kit's radius/flatness/casing. Guarded — a kit missing tokens omits the field.
        ...(result.tokens ? { tokens: result.tokens } : {}),
        ...(previewPath ? { previewPath } : {}),
      }
      new AppMetadataRepository().merge(appId, { designKit })
    } catch (metaErr) {
      // Metadata is best-effort instrumentation — never fail the install over it.
      logger.warn('design_system.install.metadata_failed', { appId, slug: result.slug, err: String(metaErr) })
    }

    // Deterministically write the kit's base radius into the app's --radius CSS
    // variable: the v8 template derives every shadcn lg/md/sm border-radius from
    // --radius, so this one write carries the kit's roundedness into the build.
    // The model otherwise leaves --radius at the template default — the kit's
    // radius never reached the generated app (AIROBUILD-2976). updateCssRadius is
    // best-effort (never throws). This runs for BOTH the forced-attach and agent
    // auto-select paths, since both route through installDesignKitForApp.
    if (result.tokens?.radiusBase !== undefined) {
      await updateCssRadius(workspace.files, result.tokens.radiusBase)
    }

    const message = `Installed design system \`${result.slug}\` (${result.written} files extracted to docs/ui-kit/). Call \`loadUiKit\` next to read the design system primitives and components.`
    return { slug: result.slug, written: result.written, message, displayName: entry.displayName, design: entry.design, questions: entry.questions ?? [] }
  }

  // Unreachable: the final attempt always returns or throws inside the loop. Satisfies
  // the type checker's fall-through analysis without a live code path.
  return { error: 'workspace_unavailable' }
}

export async function installDesignSystem(input: InstallDesignSystemInput): Promise<InstallDesignSystemResult> {
  const { workspace, entry, baseUrl } = input
  const url = `${baseUrl.replace(/\/$/, '')}/${entry.tarball}`
  let buf: Buffer
  try {
    const response = await fetch(url)
    if (!response.ok) throw new HttpStatusError(response.status)
    buf = Buffer.from(await response.arrayBuffer())
  } catch (err) {
    // A non-OK HTTP response is a status failure (retryable, e.g. 503). Anything
    // else thrown here is a socket-level failure during connect OR body streaming
    // (DNS / connection reset / TLS / "terminated") — fetch / arrayBuffer reject
    // with a TypeError carrying no HTTP status. Normalize BOTH to the download-error
    // shape so the transient-retry classifier recognizes them (AIROBUILD-2845).
    if (err instanceof HttpStatusError) throw new Error(`design-system download ${err.status}`)
    throw new Error(`design-system download network: ${err instanceof Error ? err.message : String(err)}`)
  }

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

    const kitMetaPath = join(assembledDir, 'kit-meta.json')
    if (!existsSync(kitMetaPath)) {
      writeFileSync(kitMetaPath, JSON.stringify({
        id: entry.id,
        slug: entry.slug,
        displayName: entry.displayName,
      }))
    }

    // Upload assembled files to workspace via dev-supervisor.
    // kit-meta.json is the per-turn "kit installed" signal the swap gate stats
    // (MessageExecutionService.prepareForcedDesignKit). Upload every content file
    // FIRST, then write kit-meta.json LAST as a completeness barrier: a mid-way
    // content-upload failure throws before kit-meta lands, so kitMetaExists stays
    // false and the agent keeps the tool-bearing base variant instead of swapping
    // to the tool-less -attached variant on a partial kit (AIROBUILD-2845).
    const allPaths = collectFiles(assembledDir)
    const KIT_META = 'kit-meta.json'
    const contentPaths = allPaths.filter(p => p !== KIT_META)
    await withConcurrency(contentPaths, UPLOAD_CONCURRENCY, async (relPath) => {
      const data = readFileSync(join(assembledDir, relPath))
      await workspace.files.upload({ path: `docs/ui-kit/${relPath}`, data })
    })
    if (allPaths.includes(KIT_META)) {
      await workspace.files.upload({ path: `docs/ui-kit/${KIT_META}`, data: readFileSync(join(assembledDir, KIT_META)) })
    }

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

    return { slug: entry.slug, written: allPaths.length, tokens }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}
