# Format Override Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Hover Bar bold, italic, and text color formatting for eligible whole bound-text expressions without rewriting the JSX expression.

**Architecture:** The source mapper wraps eligible bound expressions with a runtime `FormattedBoundText` component and emits dev-only targeting metadata for the Hover Bar. The runtime reads guarded, source-scoped sidecars under `format-overrides/` through a Vite virtual module, applies marks only when guard metadata matches, and warns in development on guard drift. Page source files use one sidecar per page; layouts, components, and other non-page sources use `format-overrides/shared.json`. The preview Hover Bar sends `FORMAT_OVERRIDE_UPDATED` messages through the builder page to a new agents route that validates, sanitizes, derives the scoped sidecar path from `target.file`, writes, and commits the sidecar.

**Tech Stack:** Babel plugin, Vite virtual module plugin, React, Vitest + Testing Library, Next.js builder page bridge, Express agents route, Node fs/GitUtils

**V1 Boundaries:** No `.map()` output, per-item marks, template-level marks, partial range marks, or formatting that survives the agent rewriting the bound expression itself. Guard drift renders unformatted and warns in development; users can reapply formatting to the new expression.

**Scope Derivation:** Prefer one pure helper for runtime and agents scope derivation, but do not import `@airo/shared` into generated v8 app runtime unless the implementation also makes that package resolvable from generated app workspaces. `app-templates/v8` is excluded from the root pnpm workspace today. If no packaging change accompanies implementation, keep the runtime and agents helpers duplicated with paired comments and identical path-derivation tests.

---

## File Map

| File | Responsibility | Action |
|------|----------------|--------|
| `app-templates/v8/src/lib/format-overrides.ts` | Runtime schema, source-scope derivation, defaults, guard matching, mark-to-style conversion | Create |
| `app-templates/v8/src/lib/__tests__/format-overrides.test.ts` | Runtime helper unit tests | Create |
| `app-templates/v8/src/components/FormattedBoundText.tsx` | Runtime wrapper that applies guarded sidecar marks | Create |
| `app-templates/v8/src/components/__tests__/FormattedBoundText.test.tsx` | Wrapper rendering and dev-warning tests | Create |
| `app-templates/v8/src/vite-env.d.ts` | Type declaration for `virtual:format-overrides` | Modify |
| `app-templates/v8/format-overrides-plugin.ts` | Vite virtual module loader for the sidecar directory | Create |
| `app-templates/v8/src/lib/__tests__/format-overrides-plugin.test.ts` | Virtual module tests | Create |
| `app-templates/v8/vite.config.ts` | Register the virtual module plugin | Modify |
| `app-templates/v8/source-mapper/src/format-bound-text.ts` | Source-mapper helpers for eligibility, guard construction, expression hashing, and import injection | Create |
| `app-templates/v8/source-mapper/src/index.ts` | Invoke bound-text wrapping in dev and production; keep `data-dev-*` attributes dev-only | Modify |
| `app-templates/v8/source-mapper/src/__tests__/index.test.ts` | Source mapper coverage for wrappers, guards, production behavior, and loop blocking | Modify |
| `app-templates/v8/dev-tools/src/utils/correlatedEditListener.ts` | Shared commit/action correlation listener | Create |
| `app-templates/v8/dev-tools/src/utils/elementStyleListeners.ts` | Reuse shared listener without changing style event names | Modify |
| `app-templates/v8/dev-tools/src/utils/formatOverrideMessages.ts` | Bound-text target extraction, loop detection, current mark reading, event names, and listener | Create |
| `app-templates/v8/dev-tools/src/utils/__tests__/formatOverrideMessages.test.ts` | Dev-tools target extraction, loop blocking, and listener tests | Create |
| `app-templates/v8/dev-tools/src/components/ColorSwatchIcon.tsx` | Shared presentational swatch icon for text color controls | Create |
| `app-templates/v8/dev-tools/src/components/TextColorButton.tsx` | Reuse shared swatch icon without changing style-edit behavior | Modify |
| `app-templates/v8/dev-tools/src/components/FormatOverrideControls.tsx` | Bound-text bold, italic, and color controls that post `FORMAT_OVERRIDE_UPDATED` | Create |
| `app-templates/v8/dev-tools/src/components/__tests__/FormatOverrideControls.test.tsx` | Bound-format control interaction tests | Create |
| `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx` | Gate style controls vs bound-format controls; block loop-rendered bound elements | Modify |
| `app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx` | Hover Bar gating tests for bound and loop-rendered text | Modify |
| `app/src/services/AppService.ts` | Add typed `updateFormatOverride` BFF method | Modify |
| `app/src/services/AppService.format-overrides.test.ts` | Verify BFF forwards the request to the agents endpoint | Create |
| `app/src/app/[market]/develop/[id]/formatOverrideBridge.ts` | Build iframe success/failure messages with `commitId` echo | Create |
| `app/src/app/[market]/develop/[id]/formatOverrideBridge.test.ts` | Unit tests for bridge result mapping | Create |
| `app/src/app/[market]/develop/[id]/page.tsx` | Handle `FORMAT_OVERRIDE_UPDATED` and call `appService.updateFormatOverride` | Modify |
| `agents/src/services/FormatOverrideService.ts` | Validate/sanitize sidecar updates, derive scoped sidecar paths, read/write stable JSON, commit scoped sidecars | Create |
| `agents/src/services/__tests__/FormatOverrideService.test.ts` | Service tests for validation, deletion, stable JSON, and commit staging | Create |
| `agents/src/server/routes/format-overrides.ts` | `POST /apps/:id/format-overrides` route | Create |
| `agents/src/server/routes/__tests__/format-overrides.test.ts` | HTTP route tests | Create |
| `agents/src/server/routes/index.ts` | Export the route | Modify |
| `agents/src/server/app.ts` | Mount the route behind protected router | Modify |

---

### Task 1: Runtime Sidecar Helpers and Wrapper

**Files:**
- Create: `app-templates/v8/src/lib/format-overrides.ts`
- Create: `app-templates/v8/src/lib/__tests__/format-overrides.test.ts`
- Create: `app-templates/v8/src/components/FormattedBoundText.tsx`
- Create: `app-templates/v8/src/components/__tests__/FormattedBoundText.test.tsx`
- Modify: `app-templates/v8/src/vite-env.d.ts`

- [ ] **Step 1: Write failing runtime helper tests**

Create `app-templates/v8/src/lib/__tests__/format-overrides.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

import {
  EMPTY_FORMAT_OVERRIDE_BUNDLE,
  buildFormatOverrideStyle,
  deriveFormatOverrideScope,
  findApplicableFormatOverride,
  type FormatOverrideBundle,
  type FormatOverrideSidecar,
  type FormatOverrideTarget,
} from '../format-overrides'

const expressionHash = `sha256:${'a'.repeat(64)}`
const differentExpressionHash = `sha256:${'b'.repeat(64)}`

const target: FormatOverrideTarget = {
  file: 'src/pages/index.tsx',
  tagName: 'h1',
  sourceKind: 'bound-expression',
  contentKey: null,
  contentKeyTemplate: null,
  expressionHash,
}

describe('format override runtime helpers', () => {
  it('returns missing for absent sidecar entries', () => {
    expect(findApplicableFormatOverride(EMPTY_FORMAT_OVERRIDE_BUNDLE, 'abc123', target)).toEqual({
      status: 'missing',
    })
  })

  it('returns applicable marks when every guard field matches', () => {
    const sidecar: FormatOverrideSidecar = {
      version: 1,
      overrides: {
        abc123: {
          target,
          marks: { bold: true, italic: true, color: '#123abc' },
          updatedAt: '2026-05-28T12:00:00.000Z',
        },
      },
    }
    const bundle: FormatOverrideBundle = { version: 1, scopes: { 'pages/index': sidecar } }

    expect(findApplicableFormatOverride(bundle, 'abc123', target)).toEqual({
      status: 'applicable',
      marks: { bold: true, italic: true, color: '#123abc' },
    })
  })

  it('returns guard-mismatch when a stale structural id points at a different expression', () => {
    const sidecar: FormatOverrideSidecar = {
      version: 1,
      overrides: {
        abc123: {
          target,
          marks: { bold: true, italic: false, color: null },
          updatedAt: '2026-05-28T12:00:00.000Z',
        },
      },
    }
    const bundle: FormatOverrideBundle = { version: 1, scopes: { 'pages/index': sidecar } }

    expect(findApplicableFormatOverride(bundle, 'abc123', {
      ...target,
      expressionHash: differentExpressionHash,
    })).toEqual({
      status: 'guard-mismatch',
      expected: target,
      actual: { ...target, expressionHash: differentExpressionHash },
    })
  })

  it('builds inline styles for the v1 mark set only', () => {
    expect(buildFormatOverrideStyle({ bold: true, italic: true, color: '#123abc' })).toEqual({
      fontWeight: 700,
      fontStyle: 'italic',
      color: '#123abc',
    })
  })

  it('derives scoped sidecar locations from source files', () => {
    expect(deriveFormatOverrideScope('src/pages/index.tsx')).toEqual({
      key: 'pages/index',
      filePath: 'format-overrides/pages/index.json',
    })
    expect(deriveFormatOverrideScope('src/pages/about.tsx')).toEqual({
      key: 'pages/about',
      filePath: 'format-overrides/pages/about.json',
    })
    expect(deriveFormatOverrideScope('src/pages/home.tsx')).toEqual({
      key: 'pages/home',
      filePath: 'format-overrides/pages/home.json',
    })
    expect(deriveFormatOverrideScope('src/pages/blog/index.tsx')).toEqual({
      key: 'pages/blog/index',
      filePath: 'format-overrides/pages/blog/index.json',
    })
    expect(deriveFormatOverrideScope('src/layouts/RootLayout.tsx')).toEqual({
      key: 'shared',
      filePath: 'format-overrides/shared.json',
    })
    expect(deriveFormatOverrideScope('src/pages/../secret.tsx')).toEqual({
      key: 'shared',
      filePath: 'format-overrides/shared.json',
    })
  })
})
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `cd app-templates/v8 && pnpm test "format-overrides"`
Expected: FAIL with `Cannot find module '../format-overrides'`.

- [ ] **Step 3: Implement runtime helper module**

Create `app-templates/v8/src/lib/format-overrides.ts`:

```typescript
import type { CSSProperties } from 'react'

export type FormatOverrideSourceKind = 'bound-expression' | 'content-key' | 'content-key-template'

export interface FormatOverrideTarget {
  file: string
  tagName: string
  sourceKind: FormatOverrideSourceKind
  contentKey?: string | null
  contentKeyTemplate?: string | null
  expressionHash?: string | null
}

export interface FormatOverrideMarks {
  bold?: boolean
  italic?: boolean
  color?: string | null
}

export interface FormatOverrideEntry {
  target: FormatOverrideTarget
  marks: FormatOverrideMarks
  updatedAt: string
}

export interface FormatOverrideSidecar {
  version: 1
  overrides: Record<string, FormatOverrideEntry>
}

export interface FormatOverrideBundle {
  version: 1
  scopes: Record<string, FormatOverrideSidecar>
}

export interface FormatOverrideScope {
  key: string
  filePath: string
}

export type FormatOverrideLookupResult =
  | { status: 'missing' }
  | { status: 'applicable'; marks: FormatOverrideMarks }
  | { status: 'guard-mismatch'; expected: FormatOverrideTarget; actual: FormatOverrideTarget }

export const EMPTY_FORMAT_OVERRIDE_SIDECAR: FormatOverrideSidecar = {
  version: 1,
  overrides: {},
}

export const EMPTY_FORMAT_OVERRIDE_BUNDLE: FormatOverrideBundle = {
  version: 1,
  scopes: {},
}

function normalizeNullable(value: string | null | undefined): string | null {
  return value ?? null
}

function normalizeSourceFile(file: string): string {
  const normalized = file.replace(/\\/g, '/')
  const srcIndex = normalized.indexOf('/src/')
  if (srcIndex !== -1) return normalized.slice(srcIndex + 1)
  return normalized.replace(/^\/+/, '')
}

function toSafePagePath(rawPagePath: string): string | null {
  const segments = rawPagePath.split('/')
  if (segments.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment))) return null

  return segments.map((segment) => segment.toLowerCase()).join('/')
}

export function deriveFormatOverrideScope(file: string): FormatOverrideScope {
  // Keep this scope derivation in sync with agents/src/services/FormatOverrideService.ts.
  // The server writes by target.file and the runtime reads by the same derived scope key.
  const normalized = normalizeSourceFile(file)
  const pageMatch = /^src\/pages\/(.+)\.[jt]sx?$/.exec(normalized)
  if (!pageMatch?.[1]) {
    return { key: 'shared', filePath: 'format-overrides/shared.json' }
  }

  const pagePath = toSafePagePath(pageMatch[1])
  if (!pagePath) {
    return { key: 'shared', filePath: 'format-overrides/shared.json' }
  }

  return {
    key: `pages/${pagePath}`,
    filePath: `format-overrides/pages/${pagePath}.json`,
  }
}

export function targetsMatch(expected: FormatOverrideTarget, actual: FormatOverrideTarget): boolean {
  return expected.file === actual.file &&
    expected.tagName === actual.tagName &&
    expected.sourceKind === actual.sourceKind &&
    normalizeNullable(expected.contentKey) === normalizeNullable(actual.contentKey) &&
    normalizeNullable(expected.contentKeyTemplate) === normalizeNullable(actual.contentKeyTemplate) &&
    normalizeNullable(expected.expressionHash) === normalizeNullable(actual.expressionHash)
}

export function findApplicableFormatOverride(
  bundle: FormatOverrideBundle,
  devId: string,
  actual: FormatOverrideTarget,
): FormatOverrideLookupResult {
  const scope = deriveFormatOverrideScope(actual.file)
  const sidecar = bundle.scopes[scope.key] ?? EMPTY_FORMAT_OVERRIDE_SIDECAR
  const entry = sidecar.overrides[devId]
  if (!entry) return { status: 'missing' }
  if (!targetsMatch(entry.target, actual)) {
    return { status: 'guard-mismatch', expected: entry.target, actual }
  }
  return { status: 'applicable', marks: entry.marks }
}

export function buildFormatOverrideStyle(marks: FormatOverrideMarks): CSSProperties {
  return {
    ...(marks.bold ? { fontWeight: 700 } : {}),
    ...(marks.italic ? { fontStyle: 'italic' } : {}),
    ...(marks.color ? { color: marks.color } : {}),
  }
}
```

- [ ] **Step 4: Write failing wrapper tests**

Create `app-templates/v8/src/components/__tests__/FormattedBoundText.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FormattedBoundText } from '../FormattedBoundText'

vi.mock('virtual:format-overrides', () => ({
  default: {
    version: 1,
    scopes: {
      'pages/index': {
        version: 1,
        overrides: {
          abc123: {
            target: {
              file: 'src/pages/index.tsx',
              tagName: 'h1',
              sourceKind: 'bound-expression',
              contentKey: null,
              contentKeyTemplate: null,
              expressionHash: `sha256:${'a'.repeat(64)}`,
            },
            marks: { bold: true, italic: true, color: '#123abc' },
            updatedAt: '2026-05-28T12:00:00.000Z',
          },
          stale: {
            target: {
              file: 'src/pages/index.tsx',
              tagName: 'p',
              sourceKind: 'bound-expression',
              contentKey: null,
              contentKeyTemplate: null,
              expressionHash: `sha256:${'b'.repeat(64)}`,
            },
            marks: { bold: true },
            updatedAt: '2026-05-28T12:00:00.000Z',
          },
        },
      },
    },
  },
}))

const guard = {
  file: 'src/pages/index.tsx',
  tagName: 'h1',
  sourceKind: 'bound-expression' as const,
  contentKey: null,
  contentKeyTemplate: null,
  expressionHash: `sha256:${'a'.repeat(64)}`,
}

describe('FormattedBoundText', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children unchanged when no override exists', () => {
    const { container } = render(
      <FormattedBoundText devId="missing" guard={guard}>
        Site title
      </FormattedBoundText>,
    )

    expect(container.querySelector('[data-airo-formatted-bound-text]')).toBeNull()
    expect(container.textContent).toBe('Site title')
  })

  it('wraps children and applies matching override marks', () => {
    render(
      <FormattedBoundText devId="abc123" guard={guard}>
        Site title
      </FormattedBoundText>,
    )

    const formatted = screen.getByText('Site title')
    expect(formatted).toHaveAttribute('data-airo-formatted-bound-text', 'true')
    expect(formatted).toHaveAttribute('data-airo-format-bold', 'true')
    expect(formatted).toHaveAttribute('data-airo-format-italic', 'true')
    expect(formatted).toHaveAttribute('data-airo-format-color', '#123abc')
    expect(formatted).toHaveStyle({
      fontWeight: '700',
      fontStyle: 'italic',
      color: '#123abc',
    })
  })

  it('renders children unchanged and warns in dev on guard mismatch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { container } = render(
      <FormattedBoundText devId="stale" guard={guard}>
        Site title
      </FormattedBoundText>,
    )

    expect(container.querySelector('[data-airo-formatted-bound-text]')).toBeNull()
    expect(container.textContent).toBe('Site title')
    expect(warn).toHaveBeenCalledWith(
      '[format-overrides] Ignoring stale override for bound text.',
      expect.objectContaining({ devId: 'stale' }),
    )
  })
})
```

- [ ] **Step 5: Run wrapper tests to verify they fail**

Run: `cd app-templates/v8 && pnpm test "FormattedBoundText"`
Expected: FAIL with `Cannot find module '../FormattedBoundText'`.

- [ ] **Step 6: Implement `FormattedBoundText` and virtual module typing**

Create `app-templates/v8/src/components/FormattedBoundText.tsx`:

```tsx
import type { ReactNode } from 'react'

import formatOverrideBundle from 'virtual:format-overrides'
import {
  buildFormatOverrideStyle,
  findApplicableFormatOverride,
  type FormatOverrideTarget,
} from '@/lib/format-overrides'

interface FormattedBoundTextProps {
  devId: string
  guard: FormatOverrideTarget
  children: ReactNode
}

export function FormattedBoundText({ devId, guard, children }: FormattedBoundTextProps) {
  const result = findApplicableFormatOverride(formatOverrideBundle, devId, guard)

  if (result.status === 'missing') {
    return <>{children}</>
  }

  if (result.status === 'guard-mismatch') {
    if (import.meta.env.DEV) {
      console.warn('[format-overrides] Ignoring stale override for bound text.', {
        devId,
        expected: result.expected,
        actual: result.actual,
      })
    }
    return <>{children}</>
  }

  const marks = result.marks

  return (
    <span
      data-airo-formatted-bound-text="true"
      data-airo-format-bold={marks.bold ? 'true' : undefined}
      data-airo-format-italic={marks.italic ? 'true' : undefined}
      data-airo-format-color={marks.color || undefined}
      style={buildFormatOverrideStyle(marks)}
    >
      {children}
    </span>
  )
}
```

Add this declaration to `app-templates/v8/src/vite-env.d.ts`:

```typescript
declare module 'virtual:format-overrides' {
  import type { FormatOverrideBundle } from '@/lib/format-overrides'

  const bundle: FormatOverrideBundle
  export default bundle
}
```

- [ ] **Step 7: Run runtime tests**

Run: `cd app-templates/v8 && pnpm test "format-overrides|FormattedBoundText"`
Expected: PASS.

- [ ] **Step 8: Commit runtime sidecar support**

```bash
git add app-templates/v8/src/lib/format-overrides.ts app-templates/v8/src/lib/__tests__/format-overrides.test.ts app-templates/v8/src/components/FormattedBoundText.tsx app-templates/v8/src/components/__tests__/FormattedBoundText.test.tsx app-templates/v8/src/vite-env.d.ts
git commit -m "Add format override runtime wrapper"
```

---

### Task 2: Vite Virtual Module

**Files:**
- Create: `app-templates/v8/format-overrides-plugin.ts`
- Create: `app-templates/v8/src/lib/__tests__/format-overrides-plugin.test.ts`
- Modify: `app-templates/v8/vite.config.ts`

- [ ] **Step 1: Write failing virtual module tests**

Create `app-templates/v8/src/lib/__tests__/format-overrides-plugin.test.ts`:

```typescript
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FORMAT_OVERRIDES_MODULE_ID, formatOverridesPlugin } from '../../../format-overrides-plugin'

async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'format-overrides-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('formatOverridesPlugin', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns an empty sidecar bundle when format-overrides/ is missing', async () => {
    await withTempRoot(async (root) => {
      const plugin = formatOverridesPlugin(root)
      const resolved = plugin.resolveId?.(FORMAT_OVERRIDES_MODULE_ID)
      expect(resolved).toBe('\0virtual:format-overrides')

      const loaded = await plugin.load?.('\0virtual:format-overrides')
      expect(String(loaded)).toContain('"version":1')
      expect(String(loaded)).toContain('"scopes":{}')
    })
  })

  it('embeds scoped sidecar JSON when a page sidecar exists', async () => {
    await withTempRoot(async (root) => {
      const expressionHash = `sha256:${'a'.repeat(64)}`

      await mkdir(join(root, 'format-overrides/pages'), { recursive: true })
      await writeFile(join(root, 'format-overrides/pages/index.json'), JSON.stringify({
        version: 1,
        overrides: {
          abc123: {
            target: {
              file: 'src/pages/index.tsx',
              tagName: 'h1',
              sourceKind: 'bound-expression',
              contentKey: null,
              contentKeyTemplate: null,
              expressionHash,
            },
            marks: { bold: true, italic: false, color: '#123abc' },
            updatedAt: '2026-05-28T12:00:00.000Z',
          },
        },
      }))

      const plugin = formatOverridesPlugin(root)
      const loaded = await plugin.load?.('\0virtual:format-overrides')

      expect(String(loaded)).toContain('"pages/index"')
      expect(String(loaded)).toContain('abc123')
      expect(String(loaded)).toContain('#123abc')
      expect(String(loaded)).toContain('export default')
    })
  })

  it('falls back to an empty scoped sidecar when JSON is invalid', async () => {
    await withTempRoot(async (root) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      await mkdir(join(root, 'format-overrides/pages'), { recursive: true })
      await writeFile(join(root, 'format-overrides/pages/index.json'), '{not json')

      const plugin = formatOverridesPlugin(root)
      const loaded = await plugin.load?.('\0virtual:format-overrides')

      expect(String(loaded)).toContain('"version":1')
      expect(String(loaded)).toContain('"pages/index"')
      expect(String(loaded)).toContain('"overrides":{}')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('format-overrides'))
    })
  })

  it('falls back to an empty scoped sidecar when the sidecar version is unsupported', async () => {
    await withTempRoot(async (root) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      await mkdir(join(root, 'format-overrides'), { recursive: true })
      await writeFile(join(root, 'format-overrides/shared.json'), JSON.stringify({ version: 2, overrides: { abc123: {} } }))

      const plugin = formatOverridesPlugin(root)
      const loaded = await plugin.load?.('\0virtual:format-overrides')

      expect(String(loaded)).toContain('"version":1')
      expect(String(loaded)).toContain('"shared"')
      expect(String(loaded)).toContain('"overrides":{}')
      expect(String(loaded)).not.toContain('abc123')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('format-overrides'))
    })
  })
})
```

- [ ] **Step 2: Run virtual module tests to verify they fail**

Run: `cd app-templates/v8 && pnpm test "format-overrides-plugin"`
Expected: FAIL with `Cannot find module '../../../format-overrides-plugin'`.

- [ ] **Step 3: Implement the Vite plugin**

Create `app-templates/v8/format-overrides-plugin.ts`:

```typescript
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import type { Plugin, ViteDevServer } from 'vite'

const SIDECAR_DIRNAME = 'format-overrides'
export const FORMAT_OVERRIDES_MODULE_ID = 'virtual:format-overrides'
const RESOLVED_FORMAT_OVERRIDES_MODULE_ID = `\0${FORMAT_OVERRIDES_MODULE_ID}`
const EMPTY_SIDECAR = { version: 1, overrides: {} }
const EMPTY_BUNDLE = { version: 1, scopes: {} }

function warnInvalidSidecar(scope: string, reason: string): void {
  if (process.env.NODE_ENV === 'production') return
  console.warn(`[format-overrides] Ignoring ${scope}: ${reason}`)
}

function readSidecarFile(filePath: string, scope: string): unknown {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!parsed || parsed.version !== 1 || !parsed.overrides || typeof parsed.overrides !== 'object' || Array.isArray(parsed.overrides)) {
      warnInvalidSidecar(scope, 'unsupported version or shape')
      return EMPTY_SIDECAR
    }

    return parsed
  } catch (error) {
    warnInvalidSidecar(scope, error instanceof Error ? error.message : 'invalid JSON')
    return EMPTY_SIDECAR
  }
}

function collectSidecarFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry)
    if (statSync(fullPath).isDirectory()) return collectSidecarFiles(fullPath)
    return entry.endsWith('.json') ? [fullPath] : []
  })
}

function scopeFromFile(sidecarRoot: string, filePath: string): string {
  const relative = path.relative(sidecarRoot, filePath).replace(/\\/g, '/')
  return relative.replace(/\.json$/, '')
}

function readSidecarBundle(root: string): unknown {
  const sidecarRoot = path.join(root, SIDECAR_DIRNAME)
  if (!existsSync(sidecarRoot)) return EMPTY_BUNDLE

  const scopes = Object.fromEntries(
    collectSidecarFiles(sidecarRoot)
      .sort()
      .map((filePath) => {
        const scope = scopeFromFile(sidecarRoot, filePath)
        return [scope, readSidecarFile(filePath, scope)]
      }),
  )

  return { version: 1, scopes }
}

function buildModule(root: string): string {
  return `export default ${JSON.stringify(readSidecarBundle(root))};`
}

function invalidateFormatOverridesModule(server: ViteDevServer): void {
  const module = server.moduleGraph.getModuleById(RESOLVED_FORMAT_OVERRIDES_MODULE_ID)
  if (module) server.moduleGraph.invalidateModule(module)
  // V1 uses a full reload after sidecar writes. Module-level HMR can replace this later.
  server.ws.send({ type: 'full-reload' })
}

export function formatOverridesPlugin(root: string = process.cwd()): Plugin {
  const sidecarRoot = path.join(root, SIDECAR_DIRNAME)

  return {
    name: 'format-overrides',
    resolveId(id) {
      return id === FORMAT_OVERRIDES_MODULE_ID ? RESOLVED_FORMAT_OVERRIDES_MODULE_ID : null
    },
    load(id) {
      return id === RESOLVED_FORMAT_OVERRIDES_MODULE_ID ? buildModule(root) : null
    },
    configureServer(server) {
      server.watcher.add(sidecarRoot)
      const normalizedRoot = sidecarRoot.replace(/\\/g, '/')
      const isFormatOverridePath = (changedPath: string) =>
        changedPath.replace(/\\/g, '/').startsWith(normalizedRoot)
      server.watcher.on('add', (changedPath) => {
        if (isFormatOverridePath(changedPath)) invalidateFormatOverridesModule(server)
      })
      server.watcher.on('change', (changedPath) => {
        if (isFormatOverridePath(changedPath)) invalidateFormatOverridesModule(server)
      })
      server.watcher.on('unlink', (changedPath) => {
        if (isFormatOverridePath(changedPath)) invalidateFormatOverridesModule(server)
      })
    },
  }
}
```

- [ ] **Step 4: Register the plugin**

Modify `app-templates/v8/vite.config.ts`:

```typescript
import { formatOverridesPlugin } from "./format-overrides-plugin";
```

Add the plugin immediately after `apiDevPlugin()`:

```typescript
apiDevPlugin(),
formatOverridesPlugin(__dirname),
```

- [ ] **Step 5: Run virtual module tests**

Run: `cd app-templates/v8 && pnpm test "format-overrides-plugin"`
Expected: PASS.

- [ ] **Step 6: Run app-template typecheck**

Run: `cd app-templates/v8 && pnpm type-check`
Expected: PASS.

- [ ] **Step 7: Commit virtual module support**

```bash
git add app-templates/v8/format-overrides-plugin.ts app-templates/v8/src/lib/__tests__/format-overrides-plugin.test.ts app-templates/v8/vite.config.ts
git commit -m "Add format override virtual module"
```

---

### Task 3: Source Mapper Bound-Text Wrapping

**Files:**
- Create: `app-templates/v8/source-mapper/src/format-bound-text.ts`
- Modify: `app-templates/v8/source-mapper/src/index.ts`
- Modify: `app-templates/v8/source-mapper/src/__tests__/index.test.ts`

- [ ] **Step 1: Add failing source mapper tests**

Append this block to `app-templates/v8/source-mapper/src/__tests__/index.test.ts`:

```typescript
describe('jsxSourceMapper — bound text format overrides', () => {
  it('wraps eligible generic bound text with FormattedBoundText', () => {
    const output = transform(`
      const user = { name: 'Ada' };
      export default () => <h1>{user.name}</h1>;
    `);

    expect(output).toContain("import { FormattedBoundText } from \"@/components/FormattedBoundText\";");
    expect(output).toContain('data-dev-bound-text="true"');
    expect(output).toContain('data-dev-bound-source-kind="bound-expression"');
    expect(output).toContain('data-dev-bound-expression-hash="sha256:');
    expect(output).toContain('<FormattedBoundText');
    expect(output).toContain('devId=');
    expect(output).toContain('sourceKind: "bound-expression"');
    expect(output).toContain('{user.name}');
  });

  it('uses content-key guards for recognized virtual content fields', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => <h1>{home.hero.title}</h1>;
    `);

    expect(output).toContain('data-dev-content-key="home.hero.title"');
    expect(output).toContain('data-dev-bound-source-kind="content-key"');
    expect(output).toContain('contentKey: "home.hero.title"');
    expect(output).toContain('expressionHash: null');
  });

  it('does not wrap loop-rendered content-template expressions in v1', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => <ul>{products.map((p) => <li>{p.name}</li>)}</ul>;
    `);

    expect(output).toContain('data-dev-content-key-template="products[].name"');
    expect(output).not.toContain('data-dev-bound-text="true"');
    expect(output).not.toContain('<FormattedBoundText');
  });

  it('does not wrap generic expressions inside non-content .map() output in v1', () => {
    const output = transform(`
      const items = [{ name: 'Ada' }];
      export default () => <ul>{items.map((item) => <li>{item.name}</li>)}</ul>;
    `);

    expect(output).not.toContain('data-dev-bound-text="true"');
    expect(output).not.toContain('<FormattedBoundText');
  });

  it('does not wrap unsupported tags or mixed children', () => {
    const unsupported = transform(`const user = { name: 'Ada' }; export default () => <button>{user.name}</button>;`);
    const mixed = transform(`const user = { name: 'Ada' }; export default () => <h1>Hello {user.name}</h1>;`);

    expect(unsupported).not.toContain('<FormattedBoundText');
    expect(mixed).not.toContain('<FormattedBoundText');
  });

  it('does not wrap direct JSX or fragment expression children', () => {
    const elementExpression = transform(`export default () => <h1>{<span>Ada</span>}</h1>;`);
    const fragmentExpression = transform(`export default () => <h1>{<>Ada</>}</h1>;`);

    expect(elementExpression).not.toContain('<FormattedBoundText');
    expect(fragmentExpression).not.toContain('<FormattedBoundText');
  });

  it('injects the wrapper in production while omitting dev-only data attributes', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const output = transform(`
        const user = { name: 'Ada' };
        export default () => <h1>{user.name}</h1>;
      `);

      expect(output).toContain('<FormattedBoundText');
      expect(output).not.toContain('data-dev-bound-text');
      expect(output).not.toContain('data-dev-id');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
```

- [ ] **Step 2: Run the new source mapper tests to verify they fail**

Run: `cd app-templates/v8/source-mapper && pnpm test -t "bound text format overrides"`
Expected: FAIL because no wrapper/import/metadata exists.

- [ ] **Step 3: Implement source mapper helper module**

Create `app-templates/v8/source-mapper/src/format-bound-text.ts` with these exported helpers:

```typescript
import { createHash } from 'node:crypto'

import _generate from '@babel/generator'
import type { NodePath, types } from '@babel/core'
import type { Expression, JSXElement, Program } from '@babel/types'

export type BoundTextSourceKind = 'bound-expression' | 'content-key' | 'content-key-template'

export interface BoundTextCandidate {
  devId: string
  file: string
  tagName: string
  sourceKind: BoundTextSourceKind
  contentKey: string | null
  contentKeyTemplate: string | null
  expressionHash: string | null
}

const SUPPORTED_TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'label', 'li', 'blockquote'])
const FORMATTED_BOUND_TEXT_IMPORT = '@/components/FormattedBoundText'
const generate = _generate.default || _generate

export function getIntrinsicTextTagName(opening: JSXElement['openingElement'], t: typeof types): string | null {
  if (t.isJSXIdentifier(opening.name)) {
    const tagName = opening.name.name
    return /^[a-z]/.test(tagName) && SUPPORTED_TEXT_TAGS.has(tagName) ? tagName : null
  }

  if (t.isJSXMemberExpression(opening.name)) {
    let root: types.JSXMemberExpression['object'] = opening.name
    while (t.isJSXMemberExpression(root)) root = root.object
    const property = opening.name.property.name
    return t.isJSXIdentifier(root) && /^[a-z]/.test(root.name) && SUPPORTED_TEXT_TAGS.has(property)
      ? property
      : null
  }

  return null
}

export function hashExpression(expression: Expression): string {
  const code = generate(expression, { comments: false, compact: true }).code
  return `sha256:${createHash('sha256').update(code).digest('hex')}`
}

export function ensureFormattedBoundTextImport(programPath: NodePath<Program>, t: typeof types): void {
  const hasImport = programPath.node.body.some((node) =>
    t.isImportDeclaration(node) &&
    node.source.value === FORMATTED_BOUND_TEXT_IMPORT &&
    node.specifiers.some((spec) => t.isImportSpecifier(spec) && t.isIdentifier(spec.imported, { name: 'FormattedBoundText' })),
  )
  if (hasImport) return

  programPath.unshiftContainer('body', t.importDeclaration([
    t.importSpecifier(t.identifier('FormattedBoundText'), t.identifier('FormattedBoundText')),
  ], t.stringLiteral(FORMATTED_BOUND_TEXT_IMPORT)))
}

export function buildGuardExpression(candidate: BoundTextCandidate, t: typeof types): types.JSXExpressionContainer {
  return t.jsxExpressionContainer(t.objectExpression([
    t.objectProperty(t.identifier('file'), t.stringLiteral(candidate.file)),
    t.objectProperty(t.identifier('tagName'), t.stringLiteral(candidate.tagName)),
    t.objectProperty(t.identifier('sourceKind'), t.stringLiteral(candidate.sourceKind)),
    t.objectProperty(t.identifier('contentKey'), candidate.contentKey ? t.stringLiteral(candidate.contentKey) : t.nullLiteral()),
    t.objectProperty(t.identifier('contentKeyTemplate'), candidate.contentKeyTemplate ? t.stringLiteral(candidate.contentKeyTemplate) : t.nullLiteral()),
    t.objectProperty(t.identifier('expressionHash'), candidate.expressionHash ? t.stringLiteral(candidate.expressionHash) : t.nullLiteral()),
  ]))
}
```

- [ ] **Step 4: Modify source mapper state and program path tracking**

In `app-templates/v8/source-mapper/src/index.ts`:

Add imports:

```typescript
import {
  buildGuardExpression,
  ensureFormattedBoundTextImport,
  getIntrinsicTextTagName,
  hashExpression,
  type BoundTextCandidate,
} from './format-bound-text.js';
```

Extend `PluginState`:

```typescript
  programPath: NodePath<Program> | null;
  genericMapDepth: number;
  genericMapFrames: WeakSet<CallExpression>;
```

In `Program.enter`, initialize them:

```typescript
state.programPath = _path;
state.genericMapDepth = 0;
state.genericMapFrames = new WeakSet();
```

Add a local helper near `analyzeMapCall`:

```typescript
function isAnyMapCall(node: CallExpression): boolean {
  return t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.property, { name: 'map' }) &&
    node.arguments.length > 0 &&
    (t.isArrowFunctionExpression(node.arguments[0]) || t.isFunctionExpression(node.arguments[0]));
}
```

Update `CallExpression.enter`:

```typescript
if (isAnyMapCall(path.node)) {
  state.genericMapFrames.add(path.node);
  state.genericMapDepth += 1;
}
```

Update `CallExpression.exit`:

```typescript
if (state.genericMapFrames.has(path.node)) {
  state.genericMapDepth -= 1;
}
```

- [ ] **Step 5: Restructure `JSXElement` visitor so wrapping works in production**

The existing visitor returns immediately in production. Remove that early return. The visitor must still push/pop ancestor frames and compute the same structural `devId` in both dev and production, because production builds need wrapper guards that match the sidecar entries created in dev. Only the `data-dev-*` attributes stay dev-only.

Add this helper near `pickSoleExpressionChild` so the implementation can replace the actual JSX child node, not only the inner expression:

```typescript
function pickSoleExpressionContainer(jsxElement: JSXElement): types.JSXExpressionContainer | null {
  const meaningful = jsxElement.children.filter(isMeaningfulChild);
  if (meaningful.length !== 1) return null;
  const child = meaningful[0];
  if (!t.isJSXExpressionContainer(child)) return null;
  if (t.isJSXEmptyExpression(child.expression)) return null;
  if (t.isJSXElement(child.expression) || t.isJSXFragment(child.expression)) return null;
  return child;
}
```

Add the idempotency guard helper near it:

```typescript
function isFormattedBoundTextChild(child: JSXElement['children'][number]): boolean {
  return t.isJSXElement(child) &&
    t.isJSXIdentifier(child.openingElement.name) &&
    child.openingElement.name.name === 'FormattedBoundText';
}
```

Rewrite `JSXElement.enter` to follow this skeleton. Keep the existing content-key and dynamic-attribute logic inside the marked dev-only block:

```typescript
enter(path: NodePath<JSXElement>, state: PluginState) {
  const isDevBuild = process.env.NODE_ENV !== 'production';
  const openingElement = path.node.openingElement;
  const rawTagName = getJsxTagName(openingElement);
  const tagName = getIntrinsicTextTagName(openingElement, t);

  const parentFrame = state.ancestorStack[state.ancestorStack.length - 1];
  let siblingIndex = 0;
  if (parentFrame) {
    siblingIndex = parentFrame.sameTagChildCount.get(rawTagName) || 0;
    parentFrame.sameTagChildCount.set(rawTagName, siblingIndex + 1);
  }
  state.ancestorStack.push({ tagName: rawTagName, ownIndex: siblingIndex, sameTagChildCount: new Map() });

  const fileName = state.filename || state.file.opts.filename || 'unknown';
  const normalizedFileName = normalizeFileName(fileName);
  const defaultExcludePaths = [
    'components/ui/',
    '/components/ui/',
    'src/components/ui/',
    '/src/components/ui/',
  ];
  const excludePaths = state.opts?.excludePaths || defaultExcludePaths;
  if (excludePaths.some(excludePath => fileName.includes(excludePath))) return;

  if (isDevBuild && isNativeTagParent(openingElement)) {
    // Keep the existing mixed-child content wrapper pre-pass here unchanged.
  }

  const expressionContainer = pickSoleExpressionContainer(path.node);
  const expression = expressionContainer?.expression as Expression | undefined;
  const contentKey = expression ? resolveContentKey(expression, state) : null;
  const lineNumber = openingElement.loc ? openingElement.loc.start.line : 0;
  const ancestorChain = state.ancestorStack.slice(0, -1).map(f => `${f.tagName}#${f.ownIndex}`).join('>');
  const structuralKey = `${normalizedFileName}:${ancestorChain}${ancestorChain ? '>' : ''}${rawTagName}#${siblingIndex}`;
  const devId = hashStructuralKey(structuralKey);

  const sourceKind = contentKey
    ? contentKey.includes('[]') ? 'content-key-template' : 'content-key'
    : 'bound-expression';
  const candidate: BoundTextCandidate | null = tagName && expression && !state.genericMapDepth
    ? {
        devId,
        file: normalizedFileName,
        tagName,
        sourceKind,
        contentKey: sourceKind === 'content-key' ? contentKey : null,
        contentKeyTemplate: sourceKind === 'content-key-template' ? contentKey : null,
        expressionHash: sourceKind === 'bound-expression' ? hashExpression(expression) : null,
      }
    : null;

  if (candidate && !path.node.children.some(isFormattedBoundTextChild)) {
    const wrapper = t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier('FormattedBoundText'), [
        t.jsxAttribute(t.jsxIdentifier('devId'), t.stringLiteral(candidate.devId)),
        t.jsxAttribute(t.jsxIdentifier('guard'), buildGuardExpression(candidate, t)),
      ], false),
      t.jsxClosingElement(t.jsxIdentifier('FormattedBoundText')),
      [t.jsxExpressionContainer(expression)],
      false,
    );
    path.node.children = path.node.children.map((child) => child === expressionContainer ? wrapper : child);
    if (state.programPath) ensureFormattedBoundTextImport(state.programPath, t);
  }

  if (!isDevBuild) return;

  if (candidate) {
    openingElement.attributes.push(
      t.jsxAttribute(t.jsxIdentifier('data-dev-bound-text'), t.stringLiteral('true')),
      t.jsxAttribute(t.jsxIdentifier('data-dev-bound-source-kind'), t.stringLiteral(candidate.sourceKind)),
    );
    if (candidate.expressionHash) {
      openingElement.attributes.push(
        t.jsxAttribute(t.jsxIdentifier('data-dev-bound-expression-hash'), t.stringLiteral(candidate.expressionHash)),
      );
    }
  }

  // Keep existing content-key, data-dev-dynamic, data-dev-file, data-dev-line, and data-dev-id emission here.
}
```

Rewrite `JSXElement.exit` so it always pops:

```typescript
exit(_path: NodePath<JSXElement>, state: PluginState) {
  state.ancestorStack.pop();
}
```

Do not reintroduce a production return in `exit`; production wrapping depends on balanced ancestor stack state.

- [ ] **Step 6: Add idempotency coverage**

Add this test in the bound-text describe block:

```typescript
it('does not double-wrap already wrapped bound text', () => {
  const first = transform(`const user = { name: 'Ada' }; export default () => <h1>{user.name}</h1>;`);
  const second = transform(first);
  expect((second.match(/<FormattedBoundText/g) ?? []).length).toBe(1);
});
```

- [ ] **Step 7: Run focused source mapper tests**

Run: `cd app-templates/v8/source-mapper && pnpm test -t "bound text format overrides"`
Expected: PASS.

- [ ] **Step 8: Run full source mapper tests**

Run: `cd app-templates/v8/source-mapper && pnpm test`
Expected: PASS; existing `data-dev-dynamic`, content-key, and structural-id tests stay green.

- [ ] **Step 9: Commit source mapper support**

```bash
git add app-templates/v8/source-mapper/src/format-bound-text.ts app-templates/v8/source-mapper/src/index.ts app-templates/v8/source-mapper/src/__tests__/index.test.ts
git commit -m "Wrap bound text for format overrides"
```

---

### Task 4: Dev-Tools Bound-Text Formatting Controls

**Files:**
- Create: `app-templates/v8/dev-tools/src/utils/correlatedEditListener.ts`
- Modify: `app-templates/v8/dev-tools/src/utils/elementStyleListeners.ts`
- Create: `app-templates/v8/dev-tools/src/utils/formatOverrideMessages.ts`
- Create: `app-templates/v8/dev-tools/src/utils/__tests__/formatOverrideMessages.test.ts`
- Create: `app-templates/v8/dev-tools/src/components/ColorSwatchIcon.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/TextColorButton.tsx`
- Create: `app-templates/v8/dev-tools/src/components/FormatOverrideControls.tsx`
- Create: `app-templates/v8/dev-tools/src/components/__tests__/FormatOverrideControls.test.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx`

- [ ] **Step 1: Extract correlated listener tests**

Create `app-templates/v8/dev-tools/src/utils/correlatedEditListener.ts` with no exports yet, then create `app-templates/v8/dev-tools/src/utils/__tests__/formatOverrideMessages.test.ts`:

```typescript
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FormatOverrideMessageEventType,
  FORMAT_OVERRIDE_REPLY_TIMEOUT_MS,
  addFormatOverrideEditListener,
  isLoopRenderedElement,
  readCurrentFormatOverrideMarks,
  readFormatOverrideTarget,
} from '../formatOverrideMessages'

describe('formatOverrideMessages', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('extracts a bound-text target from source-mapper attributes', () => {
    const element = document.createElement('h1')
    element.setAttribute('data-dev-id', 'abc123')
    element.setAttribute('data-dev-file', '/app/src/pages/index.tsx')
    element.setAttribute('data-dev-bound-text', 'true')
    element.setAttribute('data-dev-bound-source-kind', 'bound-expression')
    element.setAttribute('data-dev-bound-expression-hash', `sha256:${'a'.repeat(64)}`)

    expect(readFormatOverrideTarget(element)).toEqual({
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        contentKey: null,
        contentKeyTemplate: null,
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
    })
  })

  it('returns null for loop-rendered bound text', () => {
    const first = document.createElement('li')
    const second = document.createElement('li')
    for (const element of [first, second]) {
      element.setAttribute('data-dev-id', 'loopid')
      element.setAttribute('data-dev-line', '7')
      element.setAttribute('data-dev-bound-text', 'true')
      document.body.appendChild(element)
    }

    expect(isLoopRenderedElement(first)).toBe(true)
    expect(readFormatOverrideTarget(first)).toBeNull()
  })

  it('reads current marks from the runtime formatted child', () => {
    const element = document.createElement('h1')
    element.innerHTML = '<span data-airo-formatted-bound-text="true" data-airo-format-bold="true" data-airo-format-italic="true" data-airo-format-color="#123abc">Title</span>'

    expect(readCurrentFormatOverrideMarks(element)).toEqual({
      bold: true,
      italic: true,
      color: '#123abc',
    })
  })

  it('returns default marks when no runtime formatted child exists yet', () => {
    const element = document.createElement('h1')
    element.textContent = 'Title'

    expect(readCurrentFormatOverrideMarks(element)).toEqual({
      bold: false,
      italic: false,
      color: null,
    })
  })

  it('correlates format override replies by commitId', () => {
    const handler = vi.fn()
    const commitId = addFormatOverrideEditListener(handler)

    window.dispatchEvent(new MessageEvent('message', {
      source: window.parent,
      data: { type: FormatOverrideMessageEventType.EDIT_SUCCEEDED, commitId: 'different' },
    }))
    expect(handler).not.toHaveBeenCalled()

    window.dispatchEvent(new MessageEvent('message', {
      source: window.parent,
      data: { type: FormatOverrideMessageEventType.EDIT_SUCCEEDED, commitId },
    }))

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('detaches the listener after FORMAT_OVERRIDE_REPLY_TIMEOUT_MS', () => {
    const handler = vi.fn()
    const commitId = addFormatOverrideEditListener(handler)

    vi.advanceTimersByTime(FORMAT_OVERRIDE_REPLY_TIMEOUT_MS)
    window.dispatchEvent(new MessageEvent('message', {
      source: window.parent,
      data: { type: FormatOverrideMessageEventType.EDIT_SUCCEEDED, commitId },
    }))

    expect(handler).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run dev-tools util tests to verify they fail**

Run: `cd app-templates/v8/dev-tools && pnpm test "formatOverrideMessages"`
Expected: FAIL with missing exports.

- [ ] **Step 3: Implement shared correlated listener**

Create `app-templates/v8/dev-tools/src/utils/correlatedEditListener.ts`:

```typescript
import { generateUniqueId } from './crypto-utils'

interface CorrelatedEditListenerOptions {
  successType: string
  failureType: string
  timeoutWarning: string
  timeoutMs: number
  handler: (event: MessageEvent) => void
}

export function addCorrelatedEditListener({
  successType,
  failureType,
  timeoutWarning,
  timeoutMs,
  handler,
}: CorrelatedEditListenerOptions): string {
  const commitId = generateUniqueId()
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const handleResult = (event: MessageEvent) => {
    const eventType = event.data?.type
    const eventCommit = event.data?.commitId

    if (event.source !== window.parent || eventCommit !== commitId) return
    if (eventType !== successType && eventType !== failureType) return

    if (timeoutId !== null) clearTimeout(timeoutId)
    window.removeEventListener('message', handleResult)
    handler(event)
  }

  window.addEventListener('message', handleResult)
  timeoutId = setTimeout(() => {
    window.removeEventListener('message', handleResult)
    console.warn(timeoutWarning, { commitId })
  }, timeoutMs)

  return commitId
}
```

Modify `app-templates/v8/dev-tools/src/utils/elementStyleListeners.ts` so `addStyleEditListener` delegates to `addCorrelatedEditListener` and keeps the existing `StyleMessageEventType` and timeout export unchanged:

```typescript
import { addCorrelatedEditListener } from './correlatedEditListener'

export function addStyleEditListener(handler: (event: MessageEvent) => void): string {
  return addCorrelatedEditListener({
    successType: StyleMessageEventType.EDIT_SUCCEEDED,
    failureType: StyleMessageEventType.EDIT_FAILED,
    timeoutWarning: '[dev-tools] STYLE_UPDATED reply timed out; listener detached',
    timeoutMs: STYLE_REPLY_TIMEOUT_MS,
    handler,
  })
}
```

- [ ] **Step 4: Implement format override message helpers**

Create `app-templates/v8/dev-tools/src/utils/formatOverrideMessages.ts`:

```typescript
import { addCorrelatedEditListener } from './correlatedEditListener'

export enum FormatOverrideMessageEventType {
  UPDATED = 'FORMAT_OVERRIDE_UPDATED',
  EDIT_SUCCEEDED = 'FORMAT_OVERRIDE_EDIT_SUCCEEDED',
  EDIT_FAILED = 'FORMAT_OVERRIDE_EDIT_FAILED',
}

export const FORMAT_OVERRIDE_REPLY_TIMEOUT_MS = 30_000

export interface FormatOverrideTarget {
  file: string
  tagName: string
  sourceKind: 'bound-expression' | 'content-key' | 'content-key-template'
  contentKey: string | null
  contentKeyTemplate: string | null
  expressionHash: string | null
}

export interface FormatOverrideMessageTarget {
  devId: string
  target: FormatOverrideTarget
}

export interface FormatOverrideMarks {
  bold?: boolean
  italic?: boolean
  color?: string | null
}

function normalizeFileName(raw: string): string {
  const normalized = raw.replace(/\\/g, '/')
  const srcIdx = normalized.indexOf('/src/')
  return srcIdx === -1 ? normalized : normalized.slice(srcIdx + 1)
}

export function isLoopRenderedElement(element: HTMLElement): boolean {
  const devId = element.getAttribute('data-dev-id')
  const devLine = element.getAttribute('data-dev-line')
  if (!devId || !devLine) return false
  return document.querySelectorAll(`[data-dev-id="${devId}"][data-dev-line="${devLine}"]`).length > 1
}

export function readFormatOverrideTarget(element: HTMLElement): FormatOverrideMessageTarget | null {
  if (isLoopRenderedElement(element)) return null
  if (element.getAttribute('data-dev-bound-text') !== 'true') return null

  const devId = element.getAttribute('data-dev-id')
  const file = element.getAttribute('data-dev-file')
  const sourceKind = element.getAttribute('data-dev-bound-source-kind')
  const tagName = element.tagName.toLowerCase()

  if (!devId || !file) return null
  if (sourceKind !== 'bound-expression' && sourceKind !== 'content-key' && sourceKind !== 'content-key-template') return null

  return {
    devId,
    target: {
      file: normalizeFileName(file),
      tagName,
      sourceKind,
      contentKey: element.getAttribute('data-dev-content-key'),
      contentKeyTemplate: element.getAttribute('data-dev-content-key-template'),
      expressionHash: element.getAttribute('data-dev-bound-expression-hash'),
    },
  }
}

export function readCurrentFormatOverrideMarks(element: HTMLElement): FormatOverrideMarks {
  const formatted = element.querySelector('[data-airo-formatted-bound-text]') as HTMLElement | null
  return {
    bold: formatted?.getAttribute('data-airo-format-bold') === 'true',
    italic: formatted?.getAttribute('data-airo-format-italic') === 'true',
    color: formatted?.getAttribute('data-airo-format-color') || null,
  }
}

export function addFormatOverrideEditListener(handler: (event: MessageEvent) => void): string {
  return addCorrelatedEditListener({
    successType: FormatOverrideMessageEventType.EDIT_SUCCEEDED,
    failureType: FormatOverrideMessageEventType.EDIT_FAILED,
    timeoutWarning: '[dev-tools] FORMAT_OVERRIDE_UPDATED reply timed out; listener detached',
    timeoutMs: FORMAT_OVERRIDE_REPLY_TIMEOUT_MS,
    handler,
  })
}
```

- [ ] **Step 5: Run util tests**

Run: `cd app-templates/v8/dev-tools && pnpm test "formatOverrideMessages|elementStyleListeners"`
Expected: PASS; existing style listener tests still pass with unchanged event names.

- [ ] **Step 6: Write failing bound control tests**

Create `app-templates/v8/dev-tools/src/components/__tests__/FormatOverrideControls.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FormatOverrideControls from '../FormatOverrideControls'
import { safePostMessage } from '../../utils/postMessage'

vi.mock('../../utils/postMessage', () => ({ safePostMessage: vi.fn() }))
vi.mock('../../utils/translations', () => ({ t: vi.fn((_: string, fallback: string) => fallback) }))
vi.mock('../../utils/formatOverrideMessages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/formatOverrideMessages')>()
  return {
    ...actual,
    addFormatOverrideEditListener: vi.fn(() => 'commit-123'),
  }
})

const expressionHash = `sha256:${'a'.repeat(64)}`

function makeBoundElement(): HTMLElement {
  const element = document.createElement('h1')
  element.textContent = 'Title'
  element.setAttribute('data-dev-id', 'abc123')
  element.setAttribute('data-dev-file', '/app/src/pages/index.tsx')
  element.setAttribute('data-dev-bound-text', 'true')
  element.setAttribute('data-dev-bound-source-kind', 'bound-expression')
  element.setAttribute('data-dev-bound-expression-hash', expressionHash)
  document.body.appendChild(element)
  return element
}

describe('FormatOverrideControls', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('posts FORMAT_OVERRIDE_UPDATED when bold is toggled', () => {
    const element = makeBoundElement()
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: false, onOpenChange: vi.fn() }} />)

    fireEvent.click(screen.getByTitle('Toggle bold'))

    expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
      type: 'FORMAT_OVERRIDE_UPDATED',
      data: {
        commitId: 'commit-123',
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          contentKey: null,
          contentKeyTemplate: null,
          expressionHash,
        },
        marks: { bold: true, italic: false, color: null },
      },
    })
  })
})
```

- [ ] **Step 7: Run bound control tests to verify they fail**

Run: `cd app-templates/v8/dev-tools && pnpm test "FormatOverrideControls"`
Expected: FAIL with missing component.

- [ ] **Step 8: Implement shared color swatch and `FormatOverrideControls`**

Create `app-templates/v8/dev-tools/src/components/ColorSwatchIcon.tsx`:

```tsx
interface ColorSwatchIconProps {
  color: string
}

export default function ColorSwatchIcon({ color }: ColorSwatchIconProps) {
  return (
    <span
      style={{
        display: 'block',
        width: '17px',
        height: '17px',
        borderRadius: '50%',
        background: color,
        border: '1px solid rgba(0,0,0,0.15)',
        boxSizing: 'border-box',
      }}
    />
  )
}
```

Modify `app-templates/v8/dev-tools/src/components/TextColorButton.tsx` to use the shared icon without changing its picker session, optimistic preview, rollback, or `STYLE_UPDATED` behavior:

```tsx
import ColorSwatchIcon from './ColorSwatchIcon'

// ...

<HoverBarButton
  onClick={toggleMenu}
  title={t("devtools_text_color_title", "Text color")}
  icon={<ColorSwatchIcon color={currentColor} />}
  active={isOpen}
/>
```

Create `app-templates/v8/dev-tools/src/components/FormatOverrideControls.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Bold, Italic } from 'lucide-react'

import ColorPicker from './ColorPicker'
import ColorSwatchIcon from './ColorSwatchIcon'
import { HoverBarButton } from './HoverBar'
import { t } from '../utils/translations'
import { safePostMessage } from '../utils/postMessage'
import { extractThemeColors } from '../utils/text-editing-helpers'
import {
  FormatOverrideMessageEventType,
  addFormatOverrideEditListener,
  readCurrentFormatOverrideMarks,
  readFormatOverrideTarget,
  type FormatOverrideMarks,
} from '../utils/formatOverrideMessages'

interface FormatOverrideControlsProps {
  selectedElement: HTMLElement | null
  colorMenu: {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
  }
}

function normalizeMarks(marks: FormatOverrideMarks): Required<FormatOverrideMarks> {
  return {
    bold: !!marks.bold,
    italic: !!marks.italic,
    color: marks.color || null,
  }
}

export default function FormatOverrideControls({ selectedElement, colorMenu }: FormatOverrideControlsProps) {
  const [marks, setMarks] = useState<Required<FormatOverrideMarks>>({ bold: false, italic: false, color: null })
  const [themeColors, setThemeColors] = useState<string[]>([])

  useEffect(() => {
    setMarks(normalizeMarks(selectedElement ? readCurrentFormatOverrideMarks(selectedElement) : {}))
  }, [selectedElement])

  const postMarks = useCallback((nextMarks: Required<FormatOverrideMarks>) => {
    if (!selectedElement) return
    const formatTarget = readFormatOverrideTarget(selectedElement)
    if (!formatTarget) return

    const previousMarks = marks
    setMarks(nextMarks)
    const commitId = addFormatOverrideEditListener((event) => {
      if (event.data.type === FormatOverrideMessageEventType.EDIT_FAILED) {
        setMarks(previousMarks)
      }
    })

    safePostMessage(window.parent, {
      type: FormatOverrideMessageEventType.UPDATED,
      data: {
        commitId,
        devId: formatTarget.devId,
        target: formatTarget.target,
        marks: nextMarks,
      },
    })
  }, [marks, selectedElement])

  const toggleBold = useCallback(() => postMarks({ ...marks, bold: !marks.bold }), [marks, postMarks])
  const toggleItalic = useCallback(() => postMarks({ ...marks, italic: !marks.italic }), [marks, postMarks])
  const changeColor = useCallback((color: string) => postMarks({ ...marks, color }), [marks, postMarks])
  const toggleColorMenu = useCallback(() => {
    if (colorMenu.isOpen) {
      setThemeColors([])
      colorMenu.onOpenChange(false)
      return
    }
    setThemeColors(extractThemeColors())
    colorMenu.onOpenChange(true)
  }, [colorMenu.isOpen, colorMenu.onOpenChange])

  return (
    <>
      <HoverBarButton
        onClick={toggleBold}
        title={t('devtools_toggle_bold_title', 'Toggle bold')}
        icon={<Bold width={15} height={15} />}
        active={marks.bold}
      />
      <HoverBarButton
        onClick={toggleItalic}
        title={t('devtools_toggle_italic_title', 'Toggle italic')}
        icon={<Italic width={15} height={15} />}
        active={marks.italic}
      />
      <div className="relative flex items-stretch">
        <HoverBarButton
          onClick={toggleColorMenu}
          title={t('devtools_text_color_title', 'Text color')}
          icon={<ColorSwatchIcon color={marks.color || '#000000'} />}
          active={colorMenu.isOpen}
        />
        {colorMenu.isOpen && (
          <div data-airo-dev-tools="" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100002 }}>
            <ColorPicker value={marks.color || '#000000'} onChange={() => undefined} onChangeEnd={changeColor} themeColors={themeColors} />
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 9: Modify Hover Bar gating**

In `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx`:

Add imports:

```typescript
import FormatOverrideControls from "./FormatOverrideControls";
import { isLoopRenderedElement, readFormatOverrideTarget } from "../utils/formatOverrideMessages";
```

Do not loosen `isTextEditable` in `element-detection.ts`. Bound text remains blocked from the inline text-edit path; `ElementHoverBar` exposes a parallel format-only path for elements where `readFormatOverrideTarget(element)` succeeds.

Replace the local `isLoopRendered` computation with:

```typescript
const isLoopRendered = isLoopRenderedElement(element);
const boundFormatTarget = readFormatOverrideTarget(element);
const isBoundTextFormatEligible = !isImage && !!boundFormatTarget && !!element.textContent?.trim();
const elementIsText = !isImage && !isLoopRendered && !isBoundTextFormatEligible && isTextElement(element) && !!element.textContent?.trim();
```

Inside the `elementIsText` block, keep the existing style buttons. Add a sibling block before it:

```tsx
{isBoundTextFormatEligible && (
  <FormatOverrideControls selectedElement={targetEl} colorMenu={menuController("color")} />
)}
```

This keeps loop-rendered bound text blocked because `readFormatOverrideTarget` returns `null` for duplicate `data-dev-id` + `data-dev-line`.

- [ ] **Step 10: Add Hover Bar gating tests**

Modify `app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx`:

Update the `element-detection` mock to include `isListElement`:

```typescript
isListElement: vi.fn(() => false),
```

Mock `FormatOverrideControls`:

```typescript
vi.mock('../FormatOverrideControls', () => ({ default: () => <button title="Bound format controls" /> }));
```

Add tests:

```typescript
describe('ElementHoverBar - bound text formatting gating', () => {
  it('shows bound format controls for eligible bound text', async () => {
    const detection = await import('../../utils/element-detection')
    vi.mocked(detection.isTextElement).mockReturnValue(true)

    const h1 = document.createElement('h1')
    h1.textContent = 'Title'
    h1.setAttribute('data-dev-id', 'abc123')
    h1.setAttribute('data-dev-line', '7')
    h1.setAttribute('data-dev-file', '/app/src/pages/index.tsx')
    h1.setAttribute('data-dev-bound-text', 'true')
    h1.setAttribute('data-dev-bound-source-kind', 'bound-expression')
    h1.setAttribute('data-dev-bound-expression-hash', `sha256:${'a'.repeat(64)}`)
    document.body.appendChild(h1)

    renderHoverBar({ type: 'text' as never, element: h1 } as HoveredElement)
    fireEvent.click(h1)

    expect(screen.queryByTitle('Bound format controls')).not.toBeNull()
  })

  it('blocks bound format controls for loop-rendered bound text', async () => {
    const first = document.createElement('li')
    const second = document.createElement('li')
    for (const li of [first, second]) {
      li.textContent = 'Product'
      li.setAttribute('data-dev-id', 'loopid')
      li.setAttribute('data-dev-line', '9')
      li.setAttribute('data-dev-file', '/app/src/pages/index.tsx')
      li.setAttribute('data-dev-bound-text', 'true')
      li.setAttribute('data-dev-bound-source-kind', 'content-key-template')
      document.body.appendChild(li)
    }

    renderHoverBar({ type: 'text' as never, element: first } as HoveredElement)
    fireEvent.click(first)

    expect(screen.queryByTitle('Bound format controls')).toBeNull()
  })
})
```

- [ ] **Step 11: Run dev-tools tests**

Run: `cd app-templates/v8/dev-tools && pnpm test "formatOverrideMessages|FormatOverrideControls|ElementHoverBar|elementStyleListeners|TextColorButton"`
Expected: PASS.

- [ ] **Step 12: Run dev-tools typecheck**

Run: `cd app-templates/v8/dev-tools && pnpm type-check`
Expected: PASS.

- [ ] **Step 13: Commit dev-tools controls**

```bash
git add app-templates/v8/dev-tools/src/utils/correlatedEditListener.ts app-templates/v8/dev-tools/src/utils/elementStyleListeners.ts app-templates/v8/dev-tools/src/utils/formatOverrideMessages.ts app-templates/v8/dev-tools/src/utils/__tests__/formatOverrideMessages.test.ts app-templates/v8/dev-tools/src/components/ColorSwatchIcon.tsx app-templates/v8/dev-tools/src/components/TextColorButton.tsx app-templates/v8/dev-tools/src/components/FormatOverrideControls.tsx app-templates/v8/dev-tools/src/components/__tests__/FormatOverrideControls.test.tsx app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx
git commit -m "Add bound text format controls"
```

---

### Task 5: Builder Page Bridge

**Files:**
- Modify: `app/src/services/AppService.ts`
- Create: `app/src/services/AppService.format-overrides.test.ts`
- Create: `app/src/app/[market]/develop/[id]/formatOverrideBridge.ts`
- Create: `app/src/app/[market]/develop/[id]/formatOverrideBridge.test.ts`
- Modify: `app/src/app/[market]/develop/[id]/page.tsx`

- [ ] **Step 1: Add failing AppService test**

Create `app/src/services/AppService.format-overrides.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { agentFetch, buildDynamicApiUrl } = vi.hoisted(() => ({
  agentFetch: vi.fn(),
  buildDynamicApiUrl: vi.fn(),
}))

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicApiUrl,
}))

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch,
}))

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: { getState: () => ({}) },
}))

import { AppService } from './AppService'

describe('AppService.updateFormatOverride', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildDynamicApiUrl.mockResolvedValue('https://agent.example.com/apps/app1234567/format-overrides')
    agentFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, commitHash: 'abc1234' }),
    })
  })

  it('forwards format override payload to the agents route without commitId', async () => {
    const service = new AppService()

    await service.updateFormatOverride('app1234567', {
      commitId: 'commit-123',
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        contentKey: null,
        contentKeyTemplate: null,
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { bold: true, italic: false, color: null },
    })

    expect(buildDynamicApiUrl).toHaveBeenCalledWith('format-overrides', 'app1234567')
    expect(agentFetch).toHaveBeenCalledWith('https://agent.example.com/apps/app1234567/format-overrides', {
      siteId: 'app1234567',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          contentKey: null,
          contentKeyTemplate: null,
          expressionHash: `sha256:${'a'.repeat(64)}`,
        },
        marks: { bold: true, italic: false, color: null },
      }),
    })
  })
})
```

- [ ] **Step 2: Run AppService test to verify it fails**

Run: `pnpm --filter website test "AppService.format-overrides"`
Expected: FAIL because `updateFormatOverride` is missing.

- [ ] **Step 3: Add AppService types and method**

In `app/src/services/AppService.ts`, add interfaces near `StyleUpdateData`:

```typescript
export interface FormatOverrideTarget {
  file: string
  tagName: string
  sourceKind: 'bound-expression' | 'content-key' | 'content-key-template'
  contentKey?: string | null
  contentKeyTemplate?: string | null
  expressionHash?: string | null
}

export interface FormatOverrideUpdateData {
  commitId?: string
  devId: string
  target: FormatOverrideTarget
  marks: {
    bold?: boolean
    italic?: boolean
    color?: string | null
  }
}

export interface FormatOverrideUpdateResult {
  success: boolean
  commitHash?: string
  removed?: boolean
  error?: string
}
```

Add method near `updateStyle`:

```typescript
async updateFormatOverride(appId: string, data: FormatOverrideUpdateData): Promise<FormatOverrideUpdateResult> {
  const { commitId: _commitId, ...requestBody } = data
  const apiUrl = await buildDynamicApiUrl('format-overrides', appId)
  const response = await agentFetch(apiUrl, {
    siteId: appId,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(`Failed to send format override update to API: ${response.status}`)
  }

  return response.json()
}
```

- [ ] **Step 4: Add bridge result tests**

Create `app/src/app/[market]/develop/[id]/formatOverrideBridge.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

import { buildFormatOverrideReplyMessage } from './formatOverrideBridge'

describe('buildFormatOverrideReplyMessage', () => {
  it('echoes commitId on success', () => {
    expect(buildFormatOverrideReplyMessage('commit-123', { success: true })).toEqual({
      type: 'FORMAT_OVERRIDE_EDIT_SUCCEEDED',
      commitId: 'commit-123',
    })
  })

  it('echoes commitId on failure', () => {
    expect(buildFormatOverrideReplyMessage('commit-123', { success: false, error: 'bad request' })).toEqual({
      type: 'FORMAT_OVERRIDE_EDIT_FAILED',
      commitId: 'commit-123',
      error: 'bad request',
    })
  })
})
```

- [ ] **Step 5: Implement bridge helper**

Create `app/src/app/[market]/develop/[id]/formatOverrideBridge.ts`:

```typescript
import type { FormatOverrideUpdateResult } from '@/services/AppService'

export function buildFormatOverrideReplyMessage(commitId: string | undefined, result: FormatOverrideUpdateResult) {
  if (result.success) {
    return { type: 'FORMAT_OVERRIDE_EDIT_SUCCEEDED', commitId }
  }

  return {
    type: 'FORMAT_OVERRIDE_EDIT_FAILED',
    commitId,
    error: result.error,
  }
}
```

- [ ] **Step 6: Wire the builder page message handler**

In `app/src/app/[market]/develop/[id]/page.tsx`, import:

```typescript
import { buildFormatOverrideReplyMessage } from './formatOverrideBridge'
import type { FormatOverrideUpdateData } from '@/services/AppService'
```

Add callback near `sendStyleUpdate`:

```typescript
const sendFormatOverrideUpdate = useCallback(async (formatData: FormatOverrideUpdateData) => {
  if (!appId) return

  const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
  const commitId = formatData.commitId

  logger.info('develop-page.format-override.begin', {
    appId,
    devId: formatData.devId,
    sourceKind: formatData.target.sourceKind,
  })

  try {
    const result = await appService.updateFormatOverride(appId, formatData)
    logger.info('develop-page.format-override.complete', { appId, success: result.success })
    if (iframe) postMessageToIframe(iframe, buildFormatOverrideReplyMessage(commitId, result))
  } catch (error) {
    logger.error('develop-page.format-override.error', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    })
    if (iframe) postMessageToIframe(iframe, buildFormatOverrideReplyMessage(commitId, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}, [appId])
```

Add a switch case:

```typescript
case 'FORMAT_OVERRIDE_UPDATED':
  logger.info('develop-page.format-override-from-iframe', { appId })
  sendFormatOverrideUpdate(event.data.data)
  break
```

Add `sendFormatOverrideUpdate` to the message-handler effect dependency array.

- [ ] **Step 7: Run builder bridge tests**

Run: `pnpm --filter website test "AppService.format-overrides|formatOverrideBridge"`
Expected: PASS.

- [ ] **Step 8: Commit builder bridge**

```bash
git add app/src/services/AppService.ts app/src/services/AppService.format-overrides.test.ts 'app/src/app/[market]/develop/[id]/formatOverrideBridge.ts' 'app/src/app/[market]/develop/[id]/formatOverrideBridge.test.ts' 'app/src/app/[market]/develop/[id]/page.tsx'
git commit -m "Bridge format override updates"
```

---

### Task 6: Agents Sidecar Service and Route

V1 is AAB-only. The service resolves `app.path` through `AppRepository.findById(appId)`, which depends on the AAB-only `apps` table. PaaS/direct-agents API support should stay out of this implementation unless a future task defines an explicit workspace path contract and auth boundary, similar to existing dual-product request patterns.

**Files:**
- Create: `agents/src/services/FormatOverrideService.ts`
- Create: `agents/src/services/__tests__/FormatOverrideService.test.ts`
- Create: `agents/src/server/routes/format-overrides.ts`
- Create: `agents/src/server/routes/__tests__/format-overrides.test.ts`
- Modify: `agents/src/server/routes/index.ts`
- Modify: `agents/src/server/app.ts`

- [ ] **Step 1: Write failing service tests**

Create `agents/src/services/__tests__/FormatOverrideService.test.ts`:

```typescript
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { GitUtils } from '../../utils/git.js'
import { createForWorkspace } from '../../workspace/index.js'
import { FormatOverrideService } from '../FormatOverrideService.js'

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(() => null),
}))

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(() => ({
    addFiles: vi.fn().mockResolvedValue({ success: true }),
    getStatus: vi.fn().mockResolvedValue({ stagedFiles: 1 }),
    commit: vi.fn().mockResolvedValue({ success: true }),
    getLastCommit: vi.fn().mockResolvedValue({ hash: 'commit-123' }),
  })),
}))

describe('FormatOverrideService', () => {
  let appRepo: AppRepository
  let appId: string
  let appPath: string
  let service: FormatOverrideService
  const expressionHash = `sha256:${'a'.repeat(64)}`
  const indexSidecarPath = () => join(appPath, 'format-overrides/pages/index.json')
  const homeSidecarPath = () => join(appPath, 'format-overrides/pages/home.json')
  const sharedSidecarPath = () => join(appPath, 'format-overrides/shared.json')

  beforeEach(async () => {
    vi.mocked(createForWorkspace).mockReturnValue(null)
    vi.mocked(GitUtils).mockClear()
    appRepo = new AppRepository()
    appPath = await mkdtemp(join(tmpdir(), 'format-overrides-app-'))
    const result = await appRepo.registerOrUpdateApp({
      siteId: 'local-dev-site',
      name: 'Format Override Test App',
      appPath,
      initialPrompt: 'test',
    })
    appId = result.app.id
    appRepo.update(appId, { path: appPath })
    service = new FormatOverrideService(appRepo)
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (appId) await appRepo.delete(appId)
    if (appPath) await rm(appPath, { recursive: true, force: true })
  })

  it('writes a sanitized stable page sidecar entry', async () => {
    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        contentKey: null,
        contentKeyTemplate: null,
        expressionHash,
      },
      marks: { bold: true, italic: false, color: '#ABCDEF' },
    })

    expect(result.success).toBe(true)
    const sidecar = JSON.parse(await readFile(indexSidecarPath(), 'utf-8'))
    expect(sidecar).toEqual({
      version: 1,
      overrides: {
        abc123: {
          target: {
            file: 'src/pages/index.tsx',
            tagName: 'h1',
            sourceKind: 'bound-expression',
            contentKey: null,
            contentKeyTemplate: null,
            expressionHash,
          },
          marks: { bold: true, italic: false, color: '#abcdef' },
          updatedAt: expect.any(String),
        },
      },
    })
  })

  it('writes non-page overrides to shared.json', async () => {
    await service.update(appId, {
      devId: 'shared123',
      target: {
        file: 'src/layouts/RootLayout.tsx',
        tagName: 'span',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { italic: true },
    })

    const sidecar = JSON.parse(await readFile(sharedSidecarPath(), 'utf-8'))
    expect(sidecar.overrides.shared123.target.file).toBe('src/layouts/RootLayout.tsx')
    expect(sidecar.overrides.shared123.marks).toEqual({ bold: false, italic: true, color: null })
  })

  it('keeps index and home pages in separate scoped sidecars', async () => {
    await service.update(appId, {
      devId: 'index123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })
    await service.update(appId, {
      devId: 'home123',
      target: {
        file: 'src/pages/home.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { italic: true },
    })

    const indexSidecar = JSON.parse(await readFile(indexSidecarPath(), 'utf-8'))
    const homeSidecar = JSON.parse(await readFile(homeSidecarPath(), 'utf-8'))

    expect(indexSidecar.overrides.index123.target.file).toBe('src/pages/index.tsx')
    expect(homeSidecar.overrides.home123.target.file).toBe('src/pages/home.tsx')
    expect(indexSidecar.overrides.home123).toBeUndefined()
    expect(homeSidecar.overrides.index123).toBeUndefined()
  })

  it('removes the sidecar entry when marks are default', async () => {
    await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })

    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: false, italic: false, color: null },
    })

    expect(result).toEqual({ success: true, removed: true })
    await expect(readFile(indexSidecarPath(), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stages and commits the scoped sidecar deletion', async () => {
    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {} } as unknown as ReturnType<typeof createForWorkspace>)
    await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })

    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: false, italic: false, color: null },
    })
    const gitUtils = vi.mocked(GitUtils).mock.results.at(-1)?.value

    expect(result).toEqual({ success: true, removed: true, commitHash: 'commit-123' })
    // This service-level mock verifies the deleted scoped path is passed to GitUtils.
    // Keep GitUtils coverage for the fact that `git add <path>` stages tracked-file deletions.
    expect(gitUtils?.addFiles).toHaveBeenCalledWith(appPath, ['format-overrides/pages/index.json'])
    expect(gitUtils?.commit).toHaveBeenCalledWith(appPath, 'Update format overrides')
  })

  it('rejects bound-expression targets without expressionHash', async () => {
    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
      },
      marks: { bold: true },
    })).rejects.toThrow('target.expressionHash is required for bound-expression format overrides')
  })

  it('rejects malformed expressionHash values', async () => {
    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash: 'not-a-sha',
      },
      marks: { bold: true },
    })).rejects.toThrow('target.expressionHash must be a sha256 hash')
  })

  it('treats unsupported sidecar versions as empty', async () => {
    await mkdir(join(appPath, 'format-overrides/pages'), { recursive: true })
    await writeFile(indexSidecarPath(), JSON.stringify({
      version: 2,
      overrides: { stale: { marks: { bold: true } } },
    }))

    await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })

    const sidecar = JSON.parse(await readFile(indexSidecarPath(), 'utf-8'))
    expect(sidecar.version).toBe(1)
    expect(sidecar.overrides.stale).toBeUndefined()
    expect(sidecar.overrides.abc123).toBeDefined()
  })

  it('does not rewrite the sidecar when the normalized entry is unchanged', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'))
    await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })
    const firstSidecar = await readFile(indexSidecarPath(), 'utf-8')

    vi.setSystemTime(new Date('2026-05-28T12:01:00.000Z'))
    await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })
    const secondSidecar = await readFile(indexSidecarPath(), 'utf-8')
    vi.useRealTimers()

    expect(secondSidecar).toBe(firstSidecar)
  })
})
```

- [ ] **Step 2: Run service tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit "FormatOverrideService"`
Expected: FAIL because the service module is missing.

- [ ] **Step 3: Implement `FormatOverrideService`**

Create `agents/src/services/FormatOverrideService.ts`:

```typescript
import fs from 'node:fs/promises'
import path from 'node:path'

import { AppRepository } from '../database/repositories/AppRepository.js'
import { logger } from '../logging/index.js'
import { createForWorkspace } from '../workspace/index.js'
import { GitUtils } from '../utils/git.js'

export type FormatOverrideSourceKind = 'bound-expression' | 'content-key' | 'content-key-template'

export interface FormatOverrideTarget {
  file: string
  tagName: string
  sourceKind: FormatOverrideSourceKind
  contentKey?: string | null
  contentKeyTemplate?: string | null
  expressionHash?: string | null
}

export interface FormatOverrideUpdateRequest {
  devId: string
  target: FormatOverrideTarget
  marks: {
    bold?: boolean
    italic?: boolean
    color?: string | null
  }
}

export interface FormatOverrideUpdateResponse {
  success: boolean
  commitHash?: string
  removed?: boolean
  error?: string
}

interface FormatOverrideSidecar {
  version: 1
  overrides: Record<string, {
    target: Required<FormatOverrideTarget>
    marks: { bold: boolean; italic: boolean; color: string | null }
    updatedAt: string
  }>
}

const SIDECAR_DIRNAME = 'format-overrides'
const SOURCE_KINDS = new Set<FormatOverrideSourceKind>(['bound-expression', 'content-key', 'content-key-template'])
const EXPRESSION_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

interface FormatOverrideScope {
  key: string
  relativePath: string
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function normalizeColor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error('marks.color must be a 6-digit hex color')
  }
  return value.toLowerCase()
}

function normalizeTarget(target: FormatOverrideTarget): Required<FormatOverrideTarget> {
  const sourceKind = target.sourceKind
  if (!SOURCE_KINDS.has(sourceKind)) throw new Error('target.sourceKind is invalid')

  const normalized = {
    file: requireString(target.file, 'target.file'),
    tagName: requireString(target.tagName, 'target.tagName').toLowerCase(),
    sourceKind,
    contentKey: target.contentKey ?? null,
    contentKeyTemplate: target.contentKeyTemplate ?? null,
    expressionHash: target.expressionHash ?? null,
  }

  if (sourceKind === 'bound-expression' && !normalized.expressionHash) {
    throw new Error('target.expressionHash is required for bound-expression format overrides')
  }
  if (normalized.expressionHash && !EXPRESSION_HASH_PATTERN.test(normalized.expressionHash)) {
    throw new Error('target.expressionHash must be a sha256 hash')
  }
  if (sourceKind === 'content-key' && !normalized.contentKey) {
    throw new Error('target.contentKey is required for content-key format overrides')
  }
  if (sourceKind === 'content-key-template' && !normalized.contentKeyTemplate) {
    throw new Error('target.contentKeyTemplate is required for content-key-template format overrides')
  }

  return normalized
}

function normalizeMarks(marks: FormatOverrideUpdateRequest['marks']) {
  return {
    bold: marks.bold === true,
    italic: marks.italic === true,
    color: normalizeColor(marks.color),
  }
}

function hasMarks(marks: ReturnType<typeof normalizeMarks>): boolean {
  return marks.bold || marks.italic || !!marks.color
}

function normalizeSourceFile(file: string): string {
  const normalized = file.replace(/\\/g, '/')
  const srcIndex = normalized.indexOf('/src/')
  if (srcIndex !== -1) return normalized.slice(srcIndex + 1)
  return normalized.replace(/^\/+/, '')
}

function toSafePagePath(rawPagePath: string): string | null {
  const segments = rawPagePath.split('/')
  if (segments.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment))) return null

  return segments.map((segment) => segment.toLowerCase()).join('/')
}

function deriveFormatOverrideScope(file: string): FormatOverrideScope {
  // Keep this scope derivation in sync with app-templates/v8/src/lib/format-overrides.ts.
  // The server writes by target.file and the runtime reads by the same derived scope key.
  const normalized = normalizeSourceFile(file)
  const pageMatch = /^src\/pages\/(.+)\.[jt]sx?$/.exec(normalized)
  if (!pageMatch?.[1]) {
    return {
      key: 'shared',
      relativePath: path.join(SIDECAR_DIRNAME, 'shared.json'),
    }
  }

  const pagePath = toSafePagePath(pageMatch[1])
  if (!pagePath) {
    return {
      key: 'shared',
      relativePath: path.join(SIDECAR_DIRNAME, 'shared.json'),
    }
  }

  return {
    key: `pages/${pagePath}`,
    relativePath: path.join(SIDECAR_DIRNAME, 'pages', `${pagePath}.json`),
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    )
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2)
}

function stableSidecar(sidecar: FormatOverrideSidecar): string {
  return `${JSON.stringify({ version: 1, overrides: sortJsonValue(sidecar.overrides) }, null, 2)}\n`
}

function normalizedPayloadMatches(
  entry: FormatOverrideSidecar['overrides'][string] | undefined,
  target: Required<FormatOverrideTarget>,
  marks: ReturnType<typeof normalizeMarks>,
): boolean {
  return !!entry &&
    stableStringify({ target: entry.target, marks: entry.marks }) === stableStringify({ target, marks })
}

export class FormatOverrideService {
  constructor(private readonly appRepository = new AppRepository()) {}

  async update(appId: string, request: FormatOverrideUpdateRequest): Promise<FormatOverrideUpdateResponse> {
    const app = this.appRepository.findById(appId)
    if (!app) throw new Error('App not found')

    const devId = requireString(request.devId, 'devId')
    const target = normalizeTarget(request.target)
    const marks = normalizeMarks(request.marks ?? {})
    const scope = deriveFormatOverrideScope(target.file)
    const sidecarPath = path.join(app.path, scope.relativePath)
    const sidecar = await this.readSidecar(sidecarPath)

    if (hasMarks(marks)) {
      if (normalizedPayloadMatches(sidecar.overrides[devId], target, marks)) {
        return { success: true }
      }

      sidecar.overrides[devId] = {
        target,
        marks,
        updatedAt: new Date().toISOString(),
      }
    } else {
      if (!sidecar.overrides[devId]) {
        return { success: true, removed: true }
      }

      delete sidecar.overrides[devId]
    }

    if (Object.keys(sidecar.overrides).length === 0) {
      await fs.rm(sidecarPath, { force: true })
    } else {
      await fs.mkdir(path.dirname(sidecarPath), { recursive: true })
      await fs.writeFile(sidecarPath, stableSidecar(sidecar))
    }

    const commitHash = await this.commitSidecar(appId, app.path, [scope.relativePath])

    return {
      success: true,
      ...(commitHash ? { commitHash } : {}),
      ...(!hasMarks(marks) ? { removed: true } : {}),
    }
  }

  private async readSidecar(sidecarPath: string): Promise<FormatOverrideSidecar> {
    try {
      const parsed = JSON.parse(await fs.readFile(sidecarPath, 'utf-8')) as Partial<FormatOverrideSidecar> | null
      if (!parsed || parsed.version !== 1 || !parsed.overrides || typeof parsed.overrides !== 'object' || Array.isArray(parsed.overrides)) {
        logger.warn('formatOverrides.sidecar.invalid', { sidecarPath, version: parsed?.version })
        return { version: 1, overrides: {} }
      }

      return { version: 1, overrides: parsed.overrides as FormatOverrideSidecar['overrides'] }
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        logger.warn('formatOverrides.sidecar.readFailed', {
          sidecarPath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return { version: 1, overrides: {} }
    }
  }

  private async commitSidecar(appId: string, appPath: string, relativeFiles: string[]): Promise<string | undefined> {
    try {
      const workspace = createForWorkspace(appId, 'preview')
      if (!workspace) return undefined
      const gitUtils = new GitUtils(workspace.tasks)

      const addResult = await gitUtils.addFiles(appPath, relativeFiles)
      if (!addResult.success) return undefined

      const status = await gitUtils.getStatus(appPath)
      if (status.stagedFiles === 0) return undefined

      const commitResult = await gitUtils.commit(appPath, 'Update format overrides')
      if (!commitResult.success) return undefined

      return (await gitUtils.getLastCommit(appPath))?.hash
    } catch (error) {
      logger.warn('format_overrides.git_commit.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }
}
```

- [ ] **Step 4: Write failing route tests**

Create `agents/src/server/routes/__tests__/format-overrides.test.ts`:

```typescript
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../services/FormatOverrideService.js', () => ({
  FormatOverrideService: vi.fn().mockImplementation(() => ({
    update: vi.fn().mockResolvedValue({ success: true, commitHash: 'abc1234' }),
  })),
}))

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}))

import { FormatOverrideService } from '../../../services/FormatOverrideService.js'
import formatOverridesRouter from '../format-overrides.js'

function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use(formatOverridesRouter)
  return app
}

describe('format override routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates format overrides for an app', async () => {
    const app = createTestApp()

    const response = await request(app)
      .post('/apps/app1234567/format-overrides')
      .send({
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          expressionHash: `sha256:${'a'.repeat(64)}`,
        },
        marks: { bold: true },
      })
      .expect(200)

    expect(response.body).toEqual({ success: true, commitHash: 'abc1234' })
    const service = vi.mocked(FormatOverrideService).mock.results[0]?.value
    expect(service.update).toHaveBeenCalledWith('app1234567', {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { bold: true },
    })
  })

  it('returns 400 for validation errors', async () => {
    const service = vi.mocked(FormatOverrideService).mock.results[0]?.value
    service.update.mockRejectedValueOnce(new Error('devId is required'))

    const app = createTestApp()
    const response = await request(app)
      .post('/apps/app1234567/format-overrides')
      .send({ target: {}, marks: {} })
      .expect(400)

    expect(response.body).toEqual({ success: false, error: 'devId is required' })
  })
})
```

- [ ] **Step 5: Implement route and mount it**

Create `agents/src/server/routes/format-overrides.ts`:

```typescript
import { Router, type Request, type Response } from 'express'

import { FormatOverrideService } from '../../services/FormatOverrideService.js'
import { log } from '../../logging/index.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'

const router: Router = Router()
const service = new FormatOverrideService()

router.post('/apps/:id([a-z0-9]{10})/format-overrides', validateAppOwnership, async (req: Request, res: Response) => {
  const appId = req.params.id as string
  const contextLogger = log.forApp(appId)

  try {
    contextLogger.info('route.format_overrides.update.begin', {
      devId: req.body?.devId,
      sourceKind: req.body?.target?.sourceKind,
    })

    const result = await service.update(appId, req.body)
    return res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message === 'App not found' ? 404 : 400
    contextLogger.warn('route.format_overrides.update.failed', { error: message })
    return res.status(status).json({ success: false, error: message })
  }
})

export default router
```

Modify `agents/src/server/routes/index.ts`:

```typescript
export { default as formatOverridesRouter } from './format-overrides.js';
```

Modify `agents/src/server/app.ts` import list to include `formatOverridesRouter`, then mount it with the other protected root-mounted routers:

```typescript
protectedRouter.use('/', formatOverridesRouter);
```

- [ ] **Step 6: Run agents tests**

Run: `pnpm --filter @airo/agents test:unit "FormatOverrideService|format-overrides"`
Expected: PASS.

- [ ] **Step 7: Run agents typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS.

- [ ] **Step 8: Commit agents sidecar endpoint**

```bash
git add agents/src/services/FormatOverrideService.ts agents/src/services/__tests__/FormatOverrideService.test.ts agents/src/server/routes/format-overrides.ts agents/src/server/routes/__tests__/format-overrides.test.ts agents/src/server/routes/index.ts agents/src/server/app.ts
git commit -m "Add format override endpoint"
```

---

### Task 7: Publish/Build Verification and Final Checks

**Files:**
- Modify only if earlier verification exposes a defect in files already listed above.

- [ ] **Step 1: Verify the sidecar is bundled, not fetched**

Run: `cd app-templates/v8 && pnpm test "format-overrides-plugin|FormattedBoundText"`
Expected: PASS. The plugin test proves scoped files under `format-overrides/` are embedded as virtual module source, and the wrapper test proves no runtime network fetch is needed.

- [ ] **Step 2: Verify source mapper production behavior**

Run: `cd app-templates/v8/source-mapper && pnpm test -t "injects the wrapper in production"`
Expected: PASS. Production transform output contains `<FormattedBoundText` and omits `data-dev-*`.

- [ ] **Step 3: Verify dev-tools loop blocking**

Run: `cd app-templates/v8/dev-tools && pnpm test "formatOverrideMessages|ElementHoverBar" -t "loop-rendered"`
Expected: PASS. Loop-rendered bound elements do not expose format override controls in v1.

- [ ] **Step 4: Run package-focused verification**

Run these commands:

```bash
cd app-templates/v8/source-mapper && pnpm test
cd app-templates/v8/dev-tools && pnpm test
cd app-templates/v8/dev-tools && pnpm type-check
cd app-templates/v8 && pnpm test "format-overrides|FormattedBoundText|format-overrides-plugin"
cd app-templates/v8 && pnpm type-check
pnpm --filter website test "AppService.format-overrides|formatOverrideBridge"
pnpm --filter @airo/agents test:unit "FormatOverrideService|format-overrides"
pnpm --filter @airo/agents typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Run broader repo verification if package-focused checks pass**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: both pass. If either fails outside files changed for this feature, record the unrelated failure and keep the feature branch changes intact.

- [ ] **Step 6: Inspect the diff for accidental behavior changes**

Run:

```bash
git diff --check
git diff --stat
git status --short
```

Expected:
- `git diff --check` prints no whitespace errors.
- `git diff --stat` shows only the files listed in this plan.
- `git status --short` may still show the pre-existing `.gitignore` modification; do not stage or revert it.

- [ ] **Step 7: Commit any verification fixes**

If the previous steps required small fixes, commit them:

```bash
git add <changed feature files only>
git commit -m "Stabilize format override implementation"
```

Do not include `.gitignore` unless the user explicitly asks for it.
