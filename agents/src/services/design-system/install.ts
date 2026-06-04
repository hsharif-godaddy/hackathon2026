import { mkdirSync, writeFileSync, rmSync, readdirSync, cpSync, existsSync, readFileSync } from 'fs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, normalize, resolve, basename, relative } from 'path'
import { createHash } from 'crypto'
import { x as extractTar } from 'tar'
import { logger } from '../../logging/index.js'
import type { WorkspaceClient } from '../../workspace/index.js'
import type { DesignSystemCatalogEntry } from './types.js'

const UPLOAD_CONCURRENCY = 8

export interface InstallDesignSystemInput {
  workspace: WorkspaceClient
  entry: DesignSystemCatalogEntry
  baseUrl: string
}

export interface InstallDesignSystemResult {
  slug: string
  written: number
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
      if (!normalize(destResolved).startsWith(assembledResolved)) {
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

    return { slug: entry.slug, written: filePaths.length }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}
