import { mkdirSync, writeFileSync, rmSync, readdirSync, cpSync, existsSync } from 'fs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, normalize, resolve, basename } from 'path'
import { createHash } from 'crypto'
import { x as extractTar } from 'tar'
import { logger } from '../../logging/index.js'
import type { DesignSystemCatalogEntry } from './types.js'

export interface InstallDesignSystemInput {
  appPath: string
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

function countFiles(dir: string): number {
  let count = 0
  if (!existsSync(dir)) return 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(join(dir, entry.name))
    } else {
      count++
    }
  }
  return count
}

export async function installDesignSystem(input: InstallDesignSystemInput): Promise<InstallDesignSystemResult> {
  const { appPath, entry, baseUrl } = input
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

  const target = join(appPath, 'docs', 'ui-kit')
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

    // Atomic swap: only write to target after assembly succeeds
    mkdirSync(target, { recursive: true })
    cpSync(assembledDir, target, { recursive: true })
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }

  const written = countFiles(target)
  return { slug: entry.slug, written }
}
