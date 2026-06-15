import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
// __tests__/ -> design-kit/ (the variant directory)
const variant = join(dir, '..')
// design-kit/ -> initial/ (where the base-version directories live, e.g. "3.0")
const initialRoot = join(variant, '..')

interface ManifestFile {
  src: string
  file: string
}

interface Manifest {
  base: string
  preflightTools?: string[]
  files: ManifestFile[]
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(variant, 'manifest.json'), 'utf-8')) as Manifest
}

describe('design-kit prompt variant manifest', () => {
  it('declares base 3.0', () => {
    expect(readManifest().base).toBe('3.0')
  })

  it('references variant files that all exist on disk', () => {
    const manifest = readManifest()
    const variantFiles = manifest.files.filter((f) => f.src === 'variant')
    // Guard: ensure we are actually checking something.
    expect(variantFiles.length).toBeGreaterThan(0)
    for (const f of variantFiles) {
      expect(existsSync(join(variant, f.file)), `missing variant file: ${f.file}`).toBe(true)
    }
  })

  it('references base files that all exist under the base-version directory', () => {
    const manifest = readManifest()
    const baseDir = join(initialRoot, manifest.base)
    const baseFiles = manifest.files.filter((f) => f.src === 'base')
    expect(baseFiles.length).toBeGreaterThan(0)
    for (const f of baseFiles) {
      expect(existsSync(join(baseDir, f.file)), `missing base file: ${manifest.base}/${f.file}`).toBe(true)
    }
  })

  it('every manifest file entry uses a known src ("base" or "variant")', () => {
    const manifest = readManifest()
    for (const f of manifest.files) {
      expect(['base', 'variant']).toContain(f.src)
    }
  })
})
