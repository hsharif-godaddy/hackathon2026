# Initial Brand-Kit Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `initial-brand-kit`, a named-manifest variant of the initial agent that asks kit-aware discovery questions, picks a brand kit from a remote catalog (env-aware blobby URL), installs it via tarball into `docs/ui-kit/`, and asks the catalog's per-kit customization questions.

**Architecture:** Reuse the existing 3.0 prompt modules via the manifest `src: "base"` mechanism; add three new prompt fragments (`kit-discovery-questions.md`, `kit-selection.md`, `kit-customization.md`, `no-kit-fallback.md`, `questioning-phase1.md`). Add a `brand-kit` service (catalog fetch with TTL + on-disk cache, install with sha256 verification + path-safe tar extraction). Register two new AI tools (`listBrandKits`, `installBrandKit`). Add a `preflightTools` field to the manifest + `AgentConfig.metadata.preflightTools`; in the ai-transport message-assembly path, when conversation history is empty and the active agent declares preflight tools, run them server-side and prepend a synthesized `assistant tool_call` + `tool result` pair to the model's message list.

**Tech Stack:** TypeScript, Vitest, zod, `tar` npm package (new), `undici` (already a dep), the existing `@airo/ai-lib` `createTool` helper, Express + AppRepository, `@airo/ai-transport` message assembly.

**Spec:** `docs/superpowers/specs/2026-05-18-initial-brand-kit-agent-design.md`

---

## File Inventory (Reference)

**New files**

- `agents/src/services/brand-kit/catalog.ts`
- `agents/src/services/brand-kit/install.ts`
- `agents/src/services/brand-kit/types.ts`
- `agents/src/services/brand-kit/__tests__/catalog.test.ts`
- `agents/src/services/brand-kit/__tests__/install.test.ts`
- `agents/src/tools/ai-lib-tools/list-brand-kits.ts`
- `agents/src/tools/ai-lib-tools/install-brand-kit.ts`
- `agents/src/tools/ai-lib-tools/__tests__/list-brand-kits.test.ts`
- `agents/src/tools/ai-lib-tools/__tests__/install-brand-kit.test.ts`
- `agents/src/prompts/initial/brand-kit/manifest.json`
- `agents/src/prompts/initial/brand-kit/questioning-phase1.md`
- `agents/src/prompts/initial/brand-kit/kit-discovery-questions.md`
- `agents/src/prompts/initial/brand-kit/kit-selection.md`
- `agents/src/prompts/initial/brand-kit/kit-customization.md`
- `agents/src/prompts/initial/brand-kit/no-kit-fallback.md`
- `packages/ai-transport/src/__tests__/preflight-tools.test.ts`

**Modified files**

- `agents/package.json` — add `tar` dep
- `agents/src/tools/ai-lib-tools/index.ts` — register two new tools
- `agents/src/agents/initial-agent.ts` — wire brand-kit tools when variant is `brand-kit`; expose `preflightTools` from manifest in agent metadata
- `packages/ai-transport/src/experimental-websocket-server.ts` — preflight injection in message assembly
- `agents/.env.example` — document `BRAND_KIT_BASE_URL`

---

## Task 1: Add `tar` dep + brand-kit types

**Files:**
- Modify: `agents/package.json`
- Create: `agents/src/services/brand-kit/types.ts`

- [ ] **Step 1: Add `tar` dep**

```bash
pnpm --filter @airo/agents add tar
pnpm --filter @airo/agents add -D @types/tar
```

- [ ] **Step 2: Create `agents/src/services/brand-kit/types.ts`**

```typescript
import { z } from 'zod'

export const BrandKitCatalogEntrySchema = z.object({
  slug: z.string().min(1),
  whenToUse: z.string().min(1),
  tags: z.array(z.string()),
  questions: z.array(z.string()),
  tarball: z.string().min(1),
  tarballHash: z.string().regex(/^sha256-[a-f0-9]+$/i),
})

export const BrandKitCatalogSchema = z.object({
  version: z.number().int(),
  generatedAt: z.string(),
  kits: z.array(BrandKitCatalogEntrySchema),
})

export type BrandKitCatalogEntry = z.infer<typeof BrandKitCatalogEntrySchema>
export type BrandKitCatalog = z.infer<typeof BrandKitCatalogSchema>
```

- [ ] **Step 3: Commit**

```bash
git add agents/package.json pnpm-lock.yaml agents/src/services/brand-kit/types.ts
git commit -m "feat(brand-kit): add tar dep and catalog zod schema"
```

---

## Task 2: Catalog service with env-aware URL + cache

**Files:**
- Create: `agents/src/services/brand-kit/catalog.ts`
- Test: `agents/src/services/brand-kit/__tests__/catalog.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// agents/src/services/brand-kit/__tests__/catalog.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SAMPLE = {
  version: 1,
  generatedAt: '2026-05-18T01:30:31.751Z',
  kits: [{
    slug: 'botanical-calligraphy',
    whenToUse: 'Use for wedding planners...',
    tags: ['wedding', 'florist'],
    questions: ['What kind of events?'],
    tarball: 'botanical-calligraphy-ff1f1a456ded.tar.gz',
    tarballHash: 'sha256-ff1f1a456ded',
  }],
}

describe('brand-kit/catalog', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'brand-kit-test-'))
    vi.resetModules()
    delete process.env.BRAND_KIT_BASE_URL
    delete process.env.GODADDY_API_BASE_URL
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('resolves prod URL by default', async () => {
    const { resolveBrandKitBaseUrl } = await import('../catalog.js')
    expect(resolveBrandKitBaseUrl()).toBe('https://blobby.wsimg.com/brand-kits')
  })

  it('resolves dev URL from GODADDY_API_BASE_URL', async () => {
    process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com'
    const { resolveBrandKitBaseUrl } = await import('../catalog.js')
    expect(resolveBrandKitBaseUrl()).toBe('https://blobby.dev-wsimg.com/brand-kits')
  })

  it('resolves test URL from GODADDY_API_BASE_URL', async () => {
    process.env.GODADDY_API_BASE_URL = 'https://api.test-godaddy.com'
    const { resolveBrandKitBaseUrl } = await import('../catalog.js')
    expect(resolveBrandKitBaseUrl()).toBe('https://blobby.test-wsimg.com/brand-kits')
  })

  it('BRAND_KIT_BASE_URL overrides resolveEnv default', async () => {
    process.env.BRAND_KIT_BASE_URL = 'http://localhost:9000/brand-kits'
    process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com'
    const { resolveBrandKitBaseUrl } = await import('../catalog.js')
    expect(resolveBrandKitBaseUrl()).toBe('http://localhost:9000/brand-kits')
  })

  it('fetchBrandKitCatalog parses, caches in memory, persists to disk', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const cachePath = join(tmp, 'cat.json')
    const { fetchBrandKitCatalog, _resetCacheForTest } = await import('../catalog.js')
    _resetCacheForTest()

    const first = await fetchBrandKitCatalog({ cachePath, ttlMs: 1000 })
    expect(first.kits[0]?.slug).toBe('botanical-calligraphy')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(existsSync(cachePath)).toBe(true)

    const second = await fetchBrandKitCatalog({ cachePath, ttlMs: 1000 })
    expect(second.kits[0]?.slug).toBe('botanical-calligraphy')
    expect(fetchMock).toHaveBeenCalledTimes(1) // cached
  })

  it('falls back to disk cache when network fails', async () => {
    const cachePath = join(tmp, 'cat.json')
    // Seed disk cache via a successful first call
    const fetchOk = vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE } as Response)
    vi.stubGlobal('fetch', fetchOk)
    const mod = await import('../catalog.js')
    mod._resetCacheForTest()
    await mod.fetchBrandKitCatalog({ cachePath, ttlMs: 0 })

    // Now fail the network and expire the in-memory cache
    mod._resetCacheForTest()
    const fetchFail = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchFail)

    const result = await mod.fetchBrandKitCatalog({ cachePath, ttlMs: 0 })
    expect(result.kits[0]?.slug).toBe('botanical-calligraphy')
  })

  it('rejects payload that fails zod validation', async () => {
    const fetchBad = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 1 }) } as Response)
    vi.stubGlobal('fetch', fetchBad)
    const cachePath = join(tmp, 'cat.json')
    const { fetchBrandKitCatalog, _resetCacheForTest } = await import('../catalog.js')
    _resetCacheForTest()
    await expect(fetchBrandKitCatalog({ cachePath, ttlMs: 0 })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests, expect FAIL**

```bash
pnpm --filter @airo/agents test:unit "brand-kit/catalog"
```

Expected: FAIL — catalog.ts does not exist.

- [ ] **Step 3: Implement `agents/src/services/brand-kit/catalog.ts`**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { resolveEnv } from '../../utils/gd-env.js'
import { logger } from '../../logging/index.js'
import { BrandKitCatalogSchema, type BrandKitCatalog } from './types.js'

const DEFAULT_CACHE_PATH = 'agents/data/brand-kit-catalog.json'
const DEFAULT_TTL_MS = 10 * 60 * 1000

let memCache: { at: number; data: BrandKitCatalog } | null = null

export function _resetCacheForTest(): void { memCache = null }

export function resolveBrandKitBaseUrl(): string {
  const override = process.env.BRAND_KIT_BASE_URL
  if (override && override.trim().length > 0) return override
  const env = resolveEnv()
  if (env === 'dev') return 'https://blobby.dev-wsimg.com/brand-kits'
  if (env === 'test') return 'https://blobby.test-wsimg.com/brand-kits'
  return 'https://blobby.wsimg.com/brand-kits'
}

export interface FetchOptions {
  cachePath?: string
  ttlMs?: number
}

export async function fetchBrandKitCatalog(opts: FetchOptions = {}): Promise<BrandKitCatalog> {
  const cachePath = opts.cachePath ?? DEFAULT_CACHE_PATH
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const now = Date.now()

  if (memCache && now - memCache.at < ttlMs) return memCache.data

  const url = `${resolveBrandKitBaseUrl()}/catalog.json`
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`catalog fetch ${response.status}`)
    const raw = await response.json()
    const parsed = BrandKitCatalogSchema.parse(raw)
    memCache = { at: now, data: parsed }
    try {
      mkdirSync(dirname(cachePath), { recursive: true })
      writeFileSync(cachePath, JSON.stringify(parsed), 'utf-8')
    } catch (err) {
      logger.warn('brand_kit.catalog.cache_write_failed', { cachePath, err: String(err) })
    }
    return parsed
  } catch (err) {
    logger.warn('brand_kit.catalog.network_failed', { url, err: String(err) })
    if (existsSync(cachePath)) {
      const onDisk = JSON.parse(readFileSync(cachePath, 'utf-8'))
      const parsed = BrandKitCatalogSchema.parse(onDisk)
      memCache = { at: now, data: parsed }
      return parsed
    }
    throw err
  }
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm --filter @airo/agents test:unit "brand-kit/catalog"
```

- [ ] **Step 5: Commit**

```bash
git add agents/src/services/brand-kit/catalog.ts agents/src/services/brand-kit/__tests__/catalog.test.ts
git commit -m "feat(brand-kit): env-aware catalog fetch with TTL + disk fallback"
```

---

## Task 3: Install service — download, verify, extract

**Files:**
- Create: `agents/src/services/brand-kit/install.ts`
- Test: `agents/src/services/brand-kit/__tests__/install.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// agents/src/services/brand-kit/__tests__/install.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { create as createTar } from 'tar'

async function makeTarball(targetTar: string, files: Record<string, string>): Promise<Buffer> {
  const stagingDir = mkdtempSync(join(tmpdir(), 'tarball-stage-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(stagingDir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  await createTar({ cwd: stagingDir, file: targetTar, gzip: true }, Object.keys(files))
  rmSync(stagingDir, { recursive: true, force: true })
  return readFileSync(targetTar)
}

describe('brand-kit/install', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'brand-kit-install-'))
    vi.resetModules()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('downloads, verifies sha256, extracts under docs/ui-kit/', async () => {
    const tarPath = join(tmp, 'kit.tar.gz')
    const buf = await makeTarball(tarPath, {
      'kit-meta.json': '{"slug":"botanical-calligraphy"}',
      'primitives/colors.md': '# colors',
    })
    const hash = createHash('sha256').update(buf).digest('hex')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const appPath = join(tmp, 'app')
    mkdirSync(appPath, { recursive: true })

    const { installBrandKit } = await import('../install.js')
    const result = await installBrandKit({
      appPath,
      entry: {
        slug: 'botanical-calligraphy',
        whenToUse: '',
        tags: [],
        questions: ['Q1?'],
        tarball: 'kit.tar.gz',
        tarballHash: `sha256-${hash}`,
      },
      baseUrl: 'http://example/brand-kits',
    })

    expect(result.slug).toBe('botanical-calligraphy')
    expect(result.questions).toEqual(['Q1?'])
    expect(result.written).toBeGreaterThan(0)
    expect(existsSync(join(appPath, 'docs/ui-kit/kit-meta.json'))).toBe(true)
    expect(existsSync(join(appPath, 'docs/ui-kit/primitives/colors.md'))).toBe(true)
  })

  it('rejects on hash mismatch', async () => {
    const tarPath = join(tmp, 'kit.tar.gz')
    const buf = await makeTarball(tarPath, { 'kit-meta.json': '{}' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const appPath = join(tmp, 'app')
    mkdirSync(appPath, { recursive: true })
    const { installBrandKit } = await import('../install.js')
    await expect(installBrandKit({
      appPath,
      entry: {
        slug: 'x', whenToUse: '', tags: [], questions: [],
        tarball: 'kit.tar.gz', tarballHash: 'sha256-deadbeef',
      },
      baseUrl: 'http://example/brand-kits',
    })).rejects.toThrow(/hash/i)
    expect(existsSync(join(appPath, 'docs/ui-kit'))).toBe(false)
  })

  it('rejects path-traversal entries', async () => {
    const tarPath = join(tmp, 'evil.tar.gz')
    // Build a tar with an absolute and a traversal entry
    const stage = mkdtempSync(join(tmpdir(), 'stage-'))
    mkdirSync(join(stage, 'sub'), { recursive: true })
    writeFileSync(join(stage, 'sub/ok.md'), 'ok')
    await createTar({ cwd: stage, file: tarPath, gzip: true, portable: true }, ['sub/ok.md'])
    // Manually craft an additional bad entry: easiest is to assert tar.x with onentry rejects '..'
    const buf = readFileSync(tarPath)
    const hash = createHash('sha256').update(buf).digest('hex')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const appPath = join(tmp, 'app')
    mkdirSync(appPath, { recursive: true })

    const { installBrandKit } = await import('../install.js')
    const r = await installBrandKit({
      appPath,
      entry: { slug: 's', whenToUse: '', tags: [], questions: [], tarball: 'evil.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(1)
    rmSync(stage, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run tests, expect FAIL**

```bash
pnpm --filter @airo/agents test:unit "brand-kit/install"
```

- [ ] **Step 3: Implement `agents/src/services/brand-kit/install.ts`**

```typescript
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, normalize, resolve } from 'path'
import { createHash } from 'crypto'
import { x as extractTar } from 'tar'
import { logger } from '../../logging/index.js'
import type { BrandKitCatalogEntry } from './types.js'

export interface InstallBrandKitInput {
  appPath: string
  entry: BrandKitCatalogEntry
  baseUrl: string
}

export interface InstallBrandKitResult {
  slug: string
  written: number
  questions: string[]
}

function isSafeRel(rel: string): boolean {
  if (!rel) return false
  if (rel.includes('\0')) return false
  if (rel.startsWith('/')) return false
  const norm = normalize(rel)
  if (norm.startsWith('..') || norm.includes(`${'/'}..${'/'}`)) return false
  return true
}

export async function installBrandKit(input: InstallBrandKitInput): Promise<InstallBrandKitResult> {
  const { appPath, entry, baseUrl } = input
  const url = `${baseUrl.replace(/\/$/, '')}/${entry.tarball}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`brand-kit download ${response.status}`)
  const buf = Buffer.from(await response.arrayBuffer())

  const expected = entry.tarballHash.replace(/^sha256-/i, '').toLowerCase()
  const actual = createHash('sha256').update(buf).digest('hex').toLowerCase()
  if (!actual.startsWith(expected)) {
    throw new Error(`brand-kit hash mismatch for ${entry.slug}: expected sha256-${expected}, got sha256-${actual}`)
  }

  const stage = mkdtempSync(join(tmpdir(), 'brand-kit-dl-'))
  const tarPath = join(stage, 'kit.tar.gz')
  writeFileSync(tarPath, buf)

  const target = join(appPath, 'docs', 'ui-kit')
  mkdirSync(target, { recursive: true })
  const targetResolved = resolve(target)

  let written = 0
  try {
    await extractTar({
      file: tarPath,
      cwd: target,
      filter: (path: string) => {
        if (!isSafeRel(path)) {
          logger.warn('brand_kit.install.unsafe_entry_skipped', { path, slug: entry.slug })
          return false
        }
        const full = resolve(join(target, path))
        if (!normalize(full).startsWith(targetResolved)) {
          logger.warn('brand_kit.install.escape_attempt_skipped', { path, slug: entry.slug })
          return false
        }
        return true
      },
      onentry: () => { written++ },
    })
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }

  return { slug: entry.slug, written, questions: entry.questions }
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm --filter @airo/agents test:unit "brand-kit/install"
```

- [ ] **Step 5: Commit**

```bash
git add agents/src/services/brand-kit/install.ts agents/src/services/brand-kit/__tests__/install.test.ts
git commit -m "feat(brand-kit): tarball install with sha256 verification"
```

---

## Task 4: `listBrandKits` AI tool

**Files:**
- Create: `agents/src/tools/ai-lib-tools/list-brand-kits.ts`
- Test: `agents/src/tools/ai-lib-tools/__tests__/list-brand-kits.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// agents/src/tools/ai-lib-tools/__tests__/list-brand-kits.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const SAMPLE = {
  version: 1,
  generatedAt: '2026-05-18T01:30:31.751Z',
  kits: [
    { slug: 'botanical-calligraphy', whenToUse: 'Use for weddings.', tags: ['wedding','warm'], questions: ['Q?'], tarball: 'a.tar.gz', tarballHash: 'sha256-abc' },
    { slug: 'mod-saas', whenToUse: 'Use for SaaS.', tags: ['saas','minimal'], questions: ['Q?'], tarball: 'b.tar.gz', tarballHash: 'sha256-def' },
  ],
}

describe('listBrandKits tool', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns formatted markdown listing slug + whenToUse + tags', async () => {
    vi.doMock('../../../services/brand-kit/catalog.js', () => ({
      fetchBrandKitCatalog: vi.fn().mockResolvedValue(SAMPLE),
      resolveBrandKitBaseUrl: () => 'http://x/brand-kits',
    }))
    const { listBrandKitsAITool } = await import('../list-brand-kits.js')
    const out = await listBrandKitsAITool.execute({}, {} as any) as string
    expect(out).toContain('botanical-calligraphy')
    expect(out).toContain('Use for weddings.')
    expect(out).toContain('wedding')
    expect(out).toContain('mod-saas')
    expect(out).not.toContain('a.tar.gz')
    expect(out).not.toContain('sha256-')
  })

  it('filters by tags when provided', async () => {
    vi.doMock('../../../services/brand-kit/catalog.js', () => ({
      fetchBrandKitCatalog: vi.fn().mockResolvedValue(SAMPLE),
      resolveBrandKitBaseUrl: () => 'http://x/brand-kits',
    }))
    const { listBrandKitsAITool } = await import('../list-brand-kits.js')
    const out = await listBrandKitsAITool.execute({ tags: ['saas'] }, {} as any) as string
    expect(out).toContain('mod-saas')
    expect(out).not.toContain('botanical-calligraphy')
  })
})
```

- [ ] **Step 2: Run tests, expect FAIL**

```bash
pnpm --filter @airo/agents test:unit "list-brand-kits"
```

- [ ] **Step 3: Implement `agents/src/tools/ai-lib-tools/list-brand-kits.ts`**

```typescript
import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { fetchBrandKitCatalog } from '../../services/brand-kit/catalog.js'
import { logger } from '../../logging/index.js'

export const listBrandKitsAITool: Tool = createTool(
  'List available brand kits from the catalog. Each entry shows slug, whenToUse, and tags. Use the kit slugs verbatim when calling installBrandKit.',
  z.object({
    tags: z.array(z.string()).optional().describe('Optional. Restrict to kits whose tags include any of these values.'),
  }),
  async (input) => {
    try {
      const catalog = await fetchBrandKitCatalog()
      const filterTags = input.tags?.map(t => t.toLowerCase()) ?? []
      const matches = filterTags.length === 0
        ? catalog.kits
        : catalog.kits.filter(k => k.tags.some(t => filterTags.includes(t.toLowerCase())))

      if (matches.length === 0) return 'No brand kits matched the requested tags.'

      const lines: string[] = ['# Brand Kit Catalog', '']
      for (const kit of matches) {
        lines.push(`## ${kit.slug}`)
        lines.push('')
        lines.push(kit.whenToUse)
        lines.push('')
        lines.push(`Tags: ${kit.tags.join(', ')}`)
        lines.push('')
      }
      return lines.join('\n')
    } catch (err) {
      logger.warn('tool.list_brand_kits.failed', { err: String(err) })
      return 'Brand kit catalog is currently unavailable.'
    }
  }
)
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm --filter @airo/agents test:unit "list-brand-kits"
```

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/list-brand-kits.ts agents/src/tools/ai-lib-tools/__tests__/list-brand-kits.test.ts
git commit -m "feat(brand-kit): listBrandKits tool"
```

---

## Task 5: `installBrandKit` AI tool

**Files:**
- Create: `agents/src/tools/ai-lib-tools/install-brand-kit.ts`
- Test: `agents/src/tools/ai-lib-tools/__tests__/install-brand-kit.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// agents/src/tools/ai-lib-tools/__tests__/install-brand-kit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ENTRY = {
  slug: 'botanical-calligraphy',
  whenToUse: 'Use for weddings.',
  tags: ['wedding'],
  questions: ['What floral palette?', 'Should script appear throughout?'],
  tarball: 'kit.tar.gz',
  tarballHash: 'sha256-abc',
}

describe('installBrandKit tool', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns error when slug not in catalog', async () => {
    vi.doMock('../../../services/brand-kit/catalog.js', () => ({
      fetchBrandKitCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] }),
      resolveBrandKitBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/brand-kit/install.js', () => ({
      installBrandKit: vi.fn(),
    }))
    vi.doMock('../../../database/repositories/AppRepository.js', () => ({
      AppRepository: class { findById() { return { id: 'a', path: '/tmp/app' } } },
    }))
    const { installBrandKitAITool } = await import('../install-brand-kit.js')
    const out = await installBrandKitAITool.execute({ slug: 'unknown' }, { metadata: { appId: 'a' } } as any) as string
    expect(out).toMatch(/not found in catalog/i)
  })

  it('installs and emits a ui_kit_upload context attachment with questions', async () => {
    const installSpy = vi.fn().mockResolvedValue({ slug: 'botanical-calligraphy', written: 7, questions: ENTRY.questions })
    const enqueueSpy = vi.fn()
    vi.doMock('../../../services/brand-kit/catalog.js', () => ({
      fetchBrandKitCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] }),
      resolveBrandKitBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/brand-kit/install.js', () => ({
      installBrandKit: installSpy,
    }))
    vi.doMock('../../../database/repositories/AppRepository.js', () => ({
      AppRepository: class { findById() { return { id: 'a', path: '/tmp/app' } } },
    }))
    vi.doMock('../../../services/ContextAttachmentRegistry.js', () => ({
      contextAttachmentRegistry: { enqueueAttachment: enqueueSpy },
    }))

    const { installBrandKitAITool } = await import('../install-brand-kit.js')
    const out = await installBrandKitAITool.execute({ slug: 'botanical-calligraphy' }, { metadata: { appId: 'a', conversationId: 'c1' } } as any) as string

    expect(installSpy).toHaveBeenCalledWith(expect.objectContaining({ appPath: '/tmp/app' }))
    expect(out).toContain('botanical-calligraphy')
    expect(out).toContain('Customization questions')
    expect(out).toContain('What floral palette?')
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    const arg = enqueueSpy.mock.calls[0]![0]
    expect(arg.type).toBe('ui_kit_upload')
  })
})
```

- [ ] **Step 2: Run tests, expect FAIL**

```bash
pnpm --filter @airo/agents test:unit "install-brand-kit"
```

- [ ] **Step 3: Confirm context-attachment registry shape**

Read `agents/src/services/ContextAttachmentRegistry.ts` and the `ui_kit_upload` renderer to confirm the enqueue API name + payload shape. Adjust the test mock and the implementation below to match (the variable name `enqueueAttachment` is a placeholder — replace with the real method).

- [ ] **Step 4: Implement `agents/src/tools/ai-lib-tools/install-brand-kit.ts`**

```typescript
import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { fetchBrandKitCatalog, resolveBrandKitBaseUrl } from '../../services/brand-kit/catalog.js'
import { installBrandKit } from '../../services/brand-kit/install.js'
import { contextAttachmentRegistry } from '../../services/ContextAttachmentRegistry.js'
import { logger } from '../../logging/index.js'

const appRepo = new AppRepository()

export const installBrandKitAITool: Tool = createTool(
  'Download and install a brand kit by slug. Extracts to docs/ui-kit/ and queues the kit content for the next turn. Returns install summary plus customization questions to ask the user next.',
  z.object({
    slug: z.string().min(1).describe('The catalog slug, e.g. "botanical-calligraphy"'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined
    const conversationId = context?.metadata?.conversationId as string | undefined
    if (!appId) return 'Error: App ID required'
    const app = appRepo.findById(appId)
    if (!app) return `Error: App '${appId}' not found`

    const catalog = await fetchBrandKitCatalog()
    const entry = catalog.kits.find(k => k.slug === input.slug)
    if (!entry) return `Error: brand kit '${input.slug}' not found in catalog.`

    let result
    try {
      result = await installBrandKit({
        appPath: app.path,
        entry,
        baseUrl: resolveBrandKitBaseUrl(),
      })
    } catch (err) {
      logger.warn('tool.install_brand_kit.failed', { slug: input.slug, err: String(err) })
      return `Error installing brand kit: ${err instanceof Error ? err.message : String(err)}`
    }

    // Enqueue ui_kit_upload context attachment so UiKitUploadContextRenderer
    // injects the kit content on the next turn.
    contextAttachmentRegistry.enqueueAttachment({
      type: 'ui_kit_upload',
      conversationId,
      appId,
      payload: { slug: result.slug, source: 'brand-kit-catalog' },
    })

    const lines: string[] = []
    lines.push(`Installed brand kit \`${result.slug}\` (${result.written} files).`)
    lines.push('')
    lines.push('Customization questions for this kit (ask the user via askQuestion next):')
    for (const q of result.questions) lines.push(`- ${q}`)
    return lines.join('\n')
  }
)
```

> **Note:** The `contextAttachmentRegistry.enqueueAttachment(...)` call is the contract this task expects. If the existing registry does not expose an `enqueueAttachment` method, add one (or use the existing equivalent — `register`/`emit`/etc. — found during Step 3). Update the test mock to match.

- [ ] **Step 5: Run tests, expect PASS**

```bash
pnpm --filter @airo/agents test:unit "install-brand-kit"
```

- [ ] **Step 6: Commit**

```bash
git add agents/src/tools/ai-lib-tools/install-brand-kit.ts agents/src/tools/ai-lib-tools/__tests__/install-brand-kit.test.ts
git commit -m "feat(brand-kit): installBrandKit tool"
```

---

## Task 6: Register tools in `allAILibTools`

**Files:**
- Modify: `agents/src/tools/ai-lib-tools/index.ts`

- [ ] **Step 1: Add the exports**

In `agents/src/tools/ai-lib-tools/index.ts`, alongside the other tool exports near the top of the file, add:

```typescript
export { listBrandKitsAITool } from './list-brand-kits.js'
export { installBrandKitAITool } from './install-brand-kit.js'
```

Then in the `allAILibTools` registration block (search for existing `loadUiKit:` entry — pattern follows that convention), add:

```typescript
listBrandKits: listBrandKitsAITool,
installBrandKit: installBrandKitAITool,
```

- [ ] **Step 2: Verify**

```bash
pnpm --filter @airo/agents typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agents/src/tools/ai-lib-tools/index.ts
git commit -m "feat(brand-kit): register tools in allAILibTools"
```

---

## Task 7: Variant prompt files

**Files:**
- Create: `agents/src/prompts/initial/brand-kit/manifest.json`
- Create: `agents/src/prompts/initial/brand-kit/questioning-phase1.md`
- Create: `agents/src/prompts/initial/brand-kit/kit-discovery-questions.md`
- Create: `agents/src/prompts/initial/brand-kit/kit-selection.md`
- Create: `agents/src/prompts/initial/brand-kit/kit-customization.md`
- Create: `agents/src/prompts/initial/brand-kit/no-kit-fallback.md`

- [ ] **Step 1: Inspect 3.0's `questioning.md` to extract Phase 1 vs Phase 2**

```bash
cat agents/src/prompts/initial/3.0/questioning.md
```

Note the Phase 1 section (lines under `## Phase 1 — Project Details`) and the Phase 2 section (lines under `## Phase 2 — Visual Style & Tone`).

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "base": "3.0",
  "preflightTools": ["listBrandKits"],
  "files": [
    { "src": "base", "file": "identity.md" },
    { "src": "base", "file": "project-name.md" },
    { "src": "variant", "file": "questioning-phase1.md" },
    { "src": "variant", "file": "kit-discovery-questions.md" },
    { "src": "variant", "file": "kit-selection.md" },
    { "src": "variant", "file": "kit-customization.md" },
    { "src": "variant", "file": "no-kit-fallback.md" },
    { "src": "base", "file": "design-direction.md" },
    { "src": "base", "file": "design-reference.md" },
    { "src": "base", "file": "feature-list.md" },
    { "src": "base", "file": "examples.md" },
    { "src": "base", "file": "handoff-template.md" }
  ]
}
```

- [ ] **Step 3: Create `questioning-phase1.md`**

Copy the Phase 1 section from `agents/src/prompts/initial/3.0/questioning.md` (the part under `## Phase 1 — Project Details` plus the `askQuestion tool schema` section at the bottom of the original file). Drop everything related to Phase 2.

The file should end with:

```markdown
After the user responds to Phase 1, proceed to the Brand-Kit Discovery questions module.
```

- [ ] **Step 4: Create `kit-discovery-questions.md`**

```markdown
# Brand-Kit Discovery Questions

After Phase 1, ask three multiple-choice questions to figure out which brand kit family fits. These questions REPLACE the standard style/tone questions for kit-driven projects.

<rules>
- **NO TEXT BEFORE OR AFTER TOOL CALLS** - Just call askQuestion, no explanatory text.
- **EXACTLY 3 QUESTIONS** in a single askQuestion call. Each is single-select with 4-5 options. allowOther: true.
- The options are designed to surface kit families. Map the answers onto the catalog you saw at the start of the session in the `listBrandKits` result.
</rules>

```json
{
  "questions": [
    {
      "question": "What aesthetic family fits the brand?",
      "suggestions": [
        { "text": "Organic & natural — soft, hand-crafted, botanical" },
        { "text": "Minimal & geometric — clean, generous whitespace, restrained" },
        { "text": "Bold & expressive — saturated color, large type, energy" },
        { "text": "Classic & traditional — refined, timeless, editorial" },
        { "text": "Playful & illustrated — cheerful, character-driven, friendly" }
      ],
      "allowOther": true
    },
    {
      "question": "What craft texture should the brand feel like?",
      "suggestions": [
        { "text": "Hand-lettered & illustrated" },
        { "text": "Refined typographic — serif-led, editorial" },
        { "text": "Clean digital — sans-serif, geometric" },
        { "text": "Photographic & cinematic" }
      ],
      "allowOther": true
    },
    {
      "question": "What energy should the brand carry?",
      "suggestions": [
        { "text": "Warm & intimate" },
        { "text": "Luxurious & elevated" },
        { "text": "Energetic & bold" },
        { "text": "Calm & precise" },
        { "text": "Casual & friendly" }
      ],
      "allowOther": true
    }
  ]
}
```

After answers, proceed to the Brand-Kit Selection module.
```

- [ ] **Step 5: Create `kit-selection.md`**

```markdown
# Brand-Kit Selection

You already have the catalog of available brand kits from the `listBrandKits` tool result at the start of this conversation. Each entry includes a slug, a "whenToUse" description, and tags.

Using the user's Phase 1 answers and the discovery answers, score each kit. Pick the top 2-3 candidates whose tags and whenToUse most closely match the user's intent. If no kit scores reasonably, present zero or one candidates plus the "None" option.

Then call `askQuestion` with one question whose suggestions are the candidate kits (use the `whenToUse` text as the option label, prefixed with the slug in parens) plus a final "None — start from scratch with a custom style" option.

<rules>
- **NO TEXT BEFORE OR AFTER TOOL CALLS** - Just call askQuestion, no explanatory text.
- **EXACTLY 1 QUESTION**, single-select, allowOther: false.
- 2-3 kit candidates + 1 "None" option = up to 4 suggestions.
</rules>

```json
{
  "questions": [
    {
      "question": "Which brand kit fits best?",
      "suggestions": [
        { "text": "(botanical-calligraphy) Use for wedding planners, florists..." },
        { "text": "None — start from scratch with a custom style" }
      ],
      "allowOther": false,
      "multiSelect": false
    }
  ]
}
```

After the user picks:

- If they picked a kit, call `installBrandKit({ slug })` with the slug from the parens prefix. Then proceed to the Brand-Kit Customization module.
- If they picked "None", proceed to the No-Kit Fallback module.
```

- [ ] **Step 6: Create `kit-customization.md`**

```markdown
# Brand-Kit Customization Questions

`installBrandKit` returned a list of customization questions specific to the chosen kit (under "Customization questions for this kit:"). Ask exactly those questions in a single `askQuestion` call. Provide 2-3 vivid suggestions per question if natural; otherwise leave `suggestions` empty and rely on `allowOther: true`.

<rules>
- **NO TEXT BEFORE OR AFTER TOOL CALLS** - Just call askQuestion.
- **ONE askQuestion CALL** containing ALL of the kit's customization questions.
- allowOther: true on every question.
</rules>

After the user answers, proceed to the design/handoff phase. Skip the No-Kit Fallback module — you have your style direction from the kit + customization answers.
```

- [ ] **Step 7: Create `no-kit-fallback.md`**

```markdown
# No-Kit Fallback — Standard Style/Tone

The user did not pick a brand kit. Run the standard style/tone questions before continuing to design. This is the same Phase 2 as the 3.0 initial agent.

<rules>
- **NO TEXT BEFORE OR AFTER TOOL CALLS** - Just call askQuestion.
- **UP TO 2 QUESTIONS** - Visual style and tone, vivid and specific.
- ❌ Generic suggestions like "Clean and modern" or "Professional and friendly".
</rules>

```json
{
  "questions": [
    {
      "question": "What visual style fits the brand?",
      "suggestions": [
        { "text": "Sun-bleached French patisserie — soft pastels, elegant serif type" },
        { "text": "Calm, focused workspace — generous whitespace, restrained color" },
        { "text": "Bold and energetic — neon accents on dark" }
      ],
      "allowOther": true
    },
    {
      "question": "What tone should the messaging have?",
      "suggestions": [
        { "text": "Warm and personal — like a friend sharing their favorite recipe" },
        { "text": "Direct and efficient — no fluff, just clarity" },
        { "text": "Encouraging and supportive — celebrate progress" }
      ],
      "allowOther": true
    }
  ]
}
```

After the user answers, proceed to the design/handoff phase.
```

- [ ] **Step 8: Verify variant discovery picks it up**

```bash
pnpm --filter @airo/agents test:unit -t "discoverNamedInitialVariants"
```

If no test exists for that function, add one:

```typescript
// agents/src/agents/__tests__/initial-agent-variants.test.ts
import { describe, it, expect } from 'vitest'
import { discoverNamedInitialVariants } from '../initial-agent.js'

describe('discoverNamedInitialVariants', () => {
  it('includes brand-kit', () => {
    expect(discoverNamedInitialVariants()).toContain('brand-kit')
  })
})
```

Run: `pnpm --filter @airo/agents test:unit "initial-agent-variants"` — expect PASS.

- [ ] **Step 9: Commit**

```bash
git add agents/src/prompts/initial/brand-kit/ agents/src/agents/__tests__/initial-agent-variants.test.ts
git commit -m "feat(brand-kit): variant prompt files"
```

---

## Task 8: Wire brand-kit tools into `createInitialAgent` for the variant

**Files:**
- Modify: `agents/src/agents/initial-agent.ts`

- [ ] **Step 1: Add tool wiring under the named-variant branch**

In `agents/src/agents/initial-agent.ts`, locate the `tools` initialization (around line 273, the block that starts with `const tools: Record<string, unknown> = {`). Below the existing template-id branches but before `if (handoffTool)`, add:

```typescript
  if (isNamedVariant && trimmedPromptVersion === 'brand-kit') {
    tools.listBrandKits = allAILibTools.listBrandKits
    tools.installBrandKit = allAILibTools.installBrandKit
    tools.loadUiKit = allAILibTools.loadUiKit
  }
```

- [ ] **Step 2: Surface `preflightTools` from the manifest**

Update the `ManifestFile` type to optionally carry `preflightTools`:

```typescript
type ManifestFile = { base: string; files: ManifestEntry[]; preflightTools?: string[] }
```

After `loadFromManifest` builds the prompt, propagate `preflightTools` back to the caller. Easiest path: change `loadFromManifest` to return `ManifestFile`, and bubble its `preflightTools` to `buildInitialSystemPrompt`'s caller. Then in `createInitialAgent`, attach the list to the agent metadata:

```typescript
return {
  ...
  metadata: {
    contextPreferences: { ... },
    preflightTools: variantPreflightTools ?? [],
  }
}
```

The `metadata` shape on `AgentConfig` already accepts arbitrary keys (it's typed loosely). Add the `preflightTools` key explicitly in JSDoc on `createInitialAgent` for discoverability.

- [ ] **Step 3: Add a test asserting tools + preflightTools are wired**

```typescript
// agents/src/agents/__tests__/initial-brand-kit-config.test.ts
import { describe, it, expect } from 'vitest'
import { createInitialAgent } from '../initial-agent.js'

describe('createInitialAgent (brand-kit variant)', () => {
  it('wires listBrandKits + installBrandKit + loadUiKit and declares preflightTools', async () => {
    const cfg = await createInitialAgent(undefined, undefined, 'brand-kit')
    expect(cfg.id).toBe('initial-brand-kit')
    expect(cfg.tools).toHaveProperty('listBrandKits')
    expect(cfg.tools).toHaveProperty('installBrandKit')
    expect(cfg.tools).toHaveProperty('loadUiKit')
    expect((cfg.metadata as any).preflightTools).toContain('listBrandKits')
  })

  it('does not wire brand-kit tools for the default variant', async () => {
    const cfg = await createInitialAgent()
    expect(cfg.tools).not.toHaveProperty('listBrandKits')
    expect(cfg.tools).not.toHaveProperty('installBrandKit')
  })
})
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm --filter @airo/agents test:unit "initial-brand-kit-config"
```

- [ ] **Step 5: Commit**

```bash
git add agents/src/agents/initial-agent.ts agents/src/agents/__tests__/initial-brand-kit-config.test.ts
git commit -m "feat(brand-kit): wire variant tools and preflightTools metadata"
```

---

## Task 9: Preflight tool synthesis in ai-transport message assembly

**Files:**
- Modify: `packages/ai-transport/src/experimental-websocket-server.ts`
- Create: `packages/ai-transport/src/__tests__/preflight-tools.test.ts`

> **Background:** When conversation history is empty AND the active agent's config carries `metadata.preflightTools: string[]`, run each tool server-side and prepend a synthesized `assistant tool_call` + `tool result` message pair to the model's message list. This gives the LLM the tool result on turn 1 with no extra round-trip.
>
> Per `packages/ai-transport/CLAUDE.md`, this behavior must live in this package (so both WS and SSE transports get it).

- [ ] **Step 1: Locate the message-assembly seam**

Open `packages/ai-transport/src/experimental-websocket-server.ts` and find the message assembly path that ends near line 3231 (the `messages.push(...afterHistoryMessages)` line followed by the orphan-tool strip at 3236). The synthesized messages must land BEFORE conversation history (so they appear at the top of the model's view) but AFTER any system-prompt/before-history context messages.

The function returns `{ messages, contextMessages }`. We add preflight messages right after `messages.push(...convertedHistoryMessages)` if and only if `convertedHistoryMessages.length === 0`.

- [ ] **Step 2: Write failing test**

```typescript
// packages/ai-transport/src/__tests__/preflight-tools.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runPreflightTools } from '../preflight-tools.js'

describe('runPreflightTools', () => {
  it('returns synthesized assistant tool_call + tool result pair', async () => {
    const tool = {
      execute: vi.fn().mockResolvedValue('catalog markdown here'),
      description: '',
      parameters: {},
    }
    const messages = await runPreflightTools({
      preflightTools: ['listBrandKits'],
      tools: { listBrandKits: tool },
      context: { metadata: { appId: 'a' } },
    })
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'assistant' })
    expect((messages[0] as any).tool_calls?.[0]?.function?.name).toBe('listBrandKits')
    expect(messages[1]).toMatchObject({ role: 'tool' })
    expect((messages[1] as any).content).toContain('catalog markdown here')
    expect((messages[1] as any).tool_call_id).toBe((messages[0] as any).tool_calls[0].id)
  })

  it('returns empty array when no preflight tools declared', async () => {
    const result = await runPreflightTools({ preflightTools: [], tools: {}, context: {} })
    expect(result).toEqual([])
  })

  it('skips tools that throw and continues with the rest', async () => {
    const okTool = { execute: vi.fn().mockResolvedValue('ok'), description: '', parameters: {} }
    const badTool = { execute: vi.fn().mockRejectedValue(new Error('boom')), description: '', parameters: {} }
    const messages = await runPreflightTools({
      preflightTools: ['bad', 'ok'],
      tools: { bad: badTool, ok: okTool },
      context: {},
    })
    expect(messages).toHaveLength(2)
    expect((messages[1] as any).content).toContain('ok')
  })
})
```

- [ ] **Step 3: Run test, expect FAIL**

```bash
pnpm --filter @airo/ai-transport test "preflight-tools"
```

- [ ] **Step 4: Implement `packages/ai-transport/src/preflight-tools.ts`**

```typescript
import { randomUUID } from 'crypto'

export interface PreflightToolMessage {
  role: 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface RunPreflightToolsInput {
  preflightTools: string[]
  tools: Record<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>
  context: unknown
}

export async function runPreflightTools(input: RunPreflightToolsInput): Promise<PreflightToolMessage[]> {
  const out: PreflightToolMessage[] = []
  for (const name of input.preflightTools) {
    const tool = input.tools[name]
    if (!tool) continue
    let result: string
    try {
      const value = await tool.execute({}, input.context)
      result = typeof value === 'string' ? value : JSON.stringify(value)
    } catch (err) {
      // Skip on failure; the agent flow falls back to no preflight context.
      continue
    }
    const id = `pf_${randomUUID()}`
    out.push({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id,
        type: 'function',
        function: { name, arguments: '{}' },
      }],
    })
    out.push({
      role: 'tool',
      content: result,
      tool_call_id: id,
    })
  }
  return out
}
```

- [ ] **Step 5: Run test, expect PASS**

```bash
pnpm --filter @airo/ai-transport test "preflight-tools"
```

- [ ] **Step 6: Wire into `experimental-websocket-server.ts` message assembly**

Locate the assembly function ending at the orphan-tool strip (around lines 3227-3245). Just after `messages.push(...convertedHistoryMessages)` and BEFORE `messages.push(...afterHistoryMessages)`, add:

```typescript
// Preflight tool synthesis: when history is empty and the agent declares
// preflightTools in its metadata, run them server-side and prepend synthesized
// assistant tool_call + tool result pairs so the model sees the result on turn 1.
if (convertedHistoryMessages.length === 0) {
  const preflightTools = (agent?.config?.metadata as any)?.preflightTools as string[] | undefined
  if (preflightTools && preflightTools.length > 0) {
    const preflight = await runPreflightTools({
      preflightTools,
      tools: agent.config.tools as Record<string, any>,
      context: { metadata: processedContext ?? {} },
    })
    messages.push(...preflight)
  }
}
```

(The exact variable names — `agent`, `processedContext` — must match the surrounding scope; adjust during implementation. The test in Step 2 covers `runPreflightTools` itself; an integration-level test is optional and not required to land this task.)

Add the import at the top of the file:

```typescript
import { runPreflightTools } from './preflight-tools.js'
```

- [ ] **Step 7: Typecheck + run all ai-transport tests**

```bash
pnpm --filter @airo/ai-transport run build
pnpm --filter @airo/ai-transport test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ai-transport/src/preflight-tools.ts packages/ai-transport/src/__tests__/preflight-tools.test.ts packages/ai-transport/src/experimental-websocket-server.ts
git commit -m "feat(ai-transport): preflight tool synthesis for empty conversations"
```

---

## Task 10: Document `BRAND_KIT_BASE_URL`

**Files:**
- Modify: `agents/.env.example`

- [ ] **Step 1: Append**

Add to `agents/.env.example`:

```
# Brand kit catalog override. Defaults to blobby.{dev-,test-,}wsimg.com/brand-kits
# based on GODADDY_API_BASE_URL.
# BRAND_KIT_BASE_URL=https://blobby.dev-wsimg.com/brand-kits
```

- [ ] **Step 2: Commit**

```bash
git add agents/.env.example
git commit -m "docs(brand-kit): document BRAND_KIT_BASE_URL override"
```

---

## Task 11: End-to-end smoke test

**Files:**
- Create: `agents/src/agents/__tests__/initial-brand-kit-flow.integration.test.ts` (integration; runs separately)

- [ ] **Step 1: Write a smoke test that loads the variant and asserts the system prompt contains the expected modules**

```typescript
import { describe, it, expect } from 'vitest'
import { createInitialAgent } from '../initial-agent.js'

describe('initial-brand-kit prompt assembly', () => {
  it('includes the variant modules + 3.0 base modules', async () => {
    const cfg = await createInitialAgent(undefined, undefined, 'brand-kit')
    const sys = cfg.system as string
    expect(sys).toContain('Initial Agent - Design-Focused Preview Planner') // identity.md from base
    expect(sys).toContain('Brand-Kit Discovery Questions')
    expect(sys).toContain('Brand-Kit Selection')
    expect(sys).toContain('Brand-Kit Customization Questions')
    expect(sys).toContain('No-Kit Fallback')
  })
})
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @airo/agents test:unit "initial-brand-kit-flow"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agents/src/agents/__tests__/initial-brand-kit-flow.integration.test.ts
git commit -m "test(brand-kit): variant prompt assembly smoke test"
```

---

## Final verification

- [ ] **Step 1: Full type + lint + build**

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Expected: PASS on all.

- [ ] **Step 2: Full test suite for the affected packages**

```bash
pnpm --filter @airo/agents test:unit
pnpm --filter @airo/ai-transport test
```

Expected: PASS.

- [ ] **Step 3: Manual confirmation**

```bash
# In one terminal:
pnpm run dev

# Once agents is up, hit the agents service to confirm the variant is registered.
# discoverNamedInitialVariants should include 'brand-kit' — the unit test in Task 7
# already asserts this; re-run if any doubt:
pnpm --filter @airo/agents test:unit "initial-agent-variants"
```

---

## Notes for the implementer

- The catalog has only one entry today (`botanical-calligraphy`); the variant prompt module `kit-discovery-questions.md` is stubbed against that one example. Revisit when the catalog grows.
- `contextAttachmentRegistry` in Task 5 uses a placeholder method `enqueueAttachment` — confirm the real method during implementation and update both the test mock and the call.
- Task 9 exact line numbers and identifiers in `experimental-websocket-server.ts` may drift; the seam (right after history push, gated on empty history) is the contract — find it and wire `runPreflightTools` there.
- Tarball format is assumed to be `.tar.gz` per the catalog filename. If the upstream ever ships zips, add an extension sniff in `install.ts` to dispatch.
