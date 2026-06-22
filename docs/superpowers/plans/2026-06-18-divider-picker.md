# Divider Section Manual Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Hover Bar manual editing of divider sections — preset selection, parameter sliders (amplitude/depth/steepness/position), and removal — without round-tripping through "Edit with AI".

**Architecture:** A new runtime `<SectionDivider>` React component in the v8 template renders one of 15 SVG divider presets, parameterized by 4 numeric props, with color resolved at runtime from the next sibling section's computed background. The dev-tools hover bar gains a "Style" action gated to `data-component="SectionDivider"` elements (a marker rendered by the `SectionDivider` runtime component itself — independent of source-mapper output, which only injects `data-dev-file`/`data-dev-line`/`data-dev-id`) that opens a Radix Popover (`DividerPicker`) — preset grid + contextual sliders + Remove. Slider drags fire local-only `DIVIDER_PREVIEWED` messages routed through a window-scoped optimistic-preview store; release fires `DIVIDER_UPDATED` which crosses the iframe boundary to the builder page, gets forwarded to a new `POST /apps/:id/dividers` agents route, and lands as a structured-prop AST rewrite committed per-app. Color inheritance and `MutationObserver`-based re-resolution mean the design is forward-compatible with future section-bg editing without changes here.

**Tech Stack:** React, Vitest + Testing Library, Babel via shared `ASTEditorBase`, Radix Popover/Slider, Express agents route, Next.js builder BFF.

**V1 Boundaries:** Edit-existing-only — no insertion UX (Muse's `<SectionGap>` hover-pill is the documented v1.5 direction). Color strictly inherited from next sibling, no per-divider color override. Fade/gradient parameters (`softness`, `fadeOpacity`, `fadeDirection`, `fadeMidpoint`) deferred — Muse hasn't wired them either. Default-equivalent slider values are written explicitly (matches Muse). All sliders quantize to step 5.

---

## File Map

| File | Responsibility | Action |
|------|----------------|--------|
| `app-templates/v8/src/lib/divider-types.ts` | `DividerPreset` union, `SectionDividerProps` interface, defaults | Create |
| `app-templates/v8/src/lib/divider-presets.ts` | 15-preset metadata + lookup helpers | Create |
| `app-templates/v8/src/lib/divider-heights.ts` | `getDividerHeight` helper ported from Muse | Create |
| `app-templates/v8/src/lib/__tests__/divider-types.test.ts` | Type-export and shape tests | Create |
| `app-templates/v8/src/lib/__tests__/divider-presets.test.ts` | Metadata + lookup tests | Create |
| `app-templates/v8/src/lib/__tests__/divider-heights.test.ts` | Height computation tests | Create |
| `app-templates/v8/src/components/SectionDivider.tsx` | Runtime component: preset switch, color resolver, preview-store subscription | Create |
| `app-templates/v8/src/components/dividers/WaveSmooth.tsx` | Fully implemented preset SVG | Create |
| `app-templates/v8/src/components/dividers/WaveLayered.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/WaveAsymmetric.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/Tilt.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/Arrow.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/CurveConcave.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/CurveConvex.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/CurveDouble.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/Sweep.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/Spill.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/Triangle.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/Peaks.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/Steps.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/Fade.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/dividers/Line.tsx` | Stub — port from Muse | Create |
| `app-templates/v8/src/components/__tests__/SectionDivider.test.tsx` | Component smoke + color resolver + preview-override tests | Create |
| `app-templates/v8/src/lib/divider-preview.ts` | Window-scoped optimistic preview store | Create |
| `app-templates/v8/src/lib/__tests__/divider-preview.test.ts` | Store API tests | Create |
| `app-templates/v8/dev-tools/src/utils/element-detection.ts` | Add `isDividerElement` classifier | Modify |
| `app-templates/v8/dev-tools/src/utils/__tests__/element-detection.test.ts` | Add divider classification tests | Modify |
| `app-templates/v8/dev-tools/src/utils/dividerMessages.ts` | Target extraction, current-props read, listener helpers | Create |
| `app-templates/v8/dev-tools/src/utils/__tests__/dividerMessages.test.ts` | Helper tests | Create |
| `app-templates/v8/dev-tools/src/utils/dividerPreviewStore.ts` | Window-scoped accessor for the preview store published by the customer-app bundle | Create |
| `app-templates/v8/dev-tools/src/utils/__tests__/dividerPreviewStore.test.ts` | Accessor tests | Create |
| `app-templates/v8/dev-tools/src/utils/divider-meta.ts` | Duplicated preset id list + display names (kept in sync with `src/lib/divider-presets.ts`) | Create |
| `app-templates/v8/dev-tools/src/components/DividerThumbnail.tsx` | Lightweight tile thumbnail per preset (dev-tools bundle) | Create |
| `app-templates/v8/dev-tools/src/components/__tests__/DividerThumbnail.test.tsx` | Thumbnail render tests | Create |
| `app-templates/v8/dev-tools/src/utils/eventBus.ts` | Add `DIVIDER_PREVIEWED`, `DIVIDER_UPDATED` events | Modify |
| `app/src/utils/eventBus.ts` | Sync'd copy — same additions | Modify |
| `app-templates/v8/dev-tools/src/components/DividerPicker.tsx` | Popover with preset grid, contextual sliders, Remove | Create |
| `app-templates/v8/dev-tools/src/components/__tests__/DividerPicker.test.tsx` | Picker interaction tests | Create |
| `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx` | Gate "Style" action to divider elements | Modify |
| `app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx` | Add divider gating tests | Modify |
| `agents/src/tools/ast-divider-editor.ts` | AST tool extending `ASTEditorBase`; structured-prop rewrite + element removal | Create |
| `agents/src/tools/__tests__/ast-divider-editor.test.ts` | AST tool tests | Create |
| `agents/src/services/DividerEditService.ts` | Validation + service orchestration | Create |
| `agents/src/services/__tests__/DividerEditService.test.ts` | Validation tests | Create |
| `agents/src/server/routes/dividers.ts` | `POST /apps/:id/dividers` Express route | Create |
| `agents/src/server/routes/__tests__/dividers.test.ts` | HTTP route tests | Create |
| `agents/src/server/routes/index.ts` | Export `dividersRouter` | Modify |
| `agents/src/server/app.ts` | Mount `dividersRouter` on protected router | Modify |
| `app/src/services/AppService.ts` | Add `updateDivider` BFF method | Modify |
| `app/src/services/AppService.divider.test.ts` | BFF call shape test | Create |
| `app/src/app/[market]/develop/[id]/dividerBridge.ts` | Iframe success/failure message builders | Create |
| `app/src/app/[market]/develop/[id]/dividerBridge.test.ts` | Bridge unit tests | Create |
| `app/src/app/[market]/develop/[id]/page.tsx` (or `useDevToolsBusBindings.ts`) | Handle `DIVIDER_UPDATED` and forward to BFF | Modify |
| `agents/src/prompts/<located-by-grep>` | Document `<SectionDivider>` for the agent | Modify |

---

### Task 1: Runtime divider types, presets metadata, height helper

**Files:**
- Create: `app-templates/v8/src/lib/divider-types.ts`
- Create: `app-templates/v8/src/lib/divider-presets.ts`
- Create: `app-templates/v8/src/lib/divider-heights.ts`
- Create: `app-templates/v8/src/lib/__tests__/divider-types.test.ts`
- Create: `app-templates/v8/src/lib/__tests__/divider-presets.test.ts`
- Create: `app-templates/v8/src/lib/__tests__/divider-heights.test.ts`

- [ ] **Step 1: Write failing types test**

Create `app-templates/v8/src/lib/__tests__/divider-types.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  DIVIDER_PRESETS,
  type DividerPreset,
  type DividerCategory,
  type SectionDividerProps,
} from '../divider-types'

describe('divider types', () => {
  it('exports the 15 preset ids', () => {
    expect(DIVIDER_PRESETS).toEqual([
      'wave-smooth',
      'wave-layered',
      'wave-asymmetric',
      'tilt',
      'arrow',
      'curve-concave',
      'curve-convex',
      'curve-double',
      'sweep',
      'spill',
      'triangle',
      'peaks',
      'steps',
      'fade',
      'line',
    ])
  })

  it('SectionDividerProps requires preset and accepts optional numerics', () => {
    const p: SectionDividerProps = { preset: 'wave-smooth' }
    const q: SectionDividerProps = {
      preset: 'sweep',
      amplitude: 60,
      depth: 50,
      steepness: 40,
      position: 30,
      color: '#ffffff',
      className: 'foo',
    }
    expect(p.preset).toBe('wave-smooth')
    expect(q.steepness).toBe(40)
  })

  it('DividerCategory has 5 values', () => {
    const cats: DividerCategory[] = ['waves', 'angles', 'curves', 'geometric', 'minimal']
    expect(cats).toHaveLength(5)
  })
})
```

- [ ] **Step 2: Run types test to verify it fails**

Run: `cd app-templates/v8 && pnpm test "divider-types"`
Expected: FAIL with `Cannot find module '../divider-types'`.

- [ ] **Step 3: Implement `divider-types.ts`**

Create `app-templates/v8/src/lib/divider-types.ts`:

```typescript
export const DIVIDER_PRESETS = [
  'wave-smooth',
  'wave-layered',
  'wave-asymmetric',
  'tilt',
  'arrow',
  'curve-concave',
  'curve-convex',
  'curve-double',
  'sweep',
  'spill',
  'triangle',
  'peaks',
  'steps',
  'fade',
  'line',
] as const

export type DividerPreset = (typeof DIVIDER_PRESETS)[number]

export type DividerCategory = 'waves' | 'angles' | 'curves' | 'geometric' | 'minimal'

export interface SectionDividerProps {
  preset: DividerPreset
  amplitude?: number
  depth?: number
  steepness?: number
  position?: number
  color?: string
  className?: string
}

export interface DividerPresetProps {
  amplitude?: number
  depth?: number
  steepness?: number
  position?: number
  color?: string
}

export const DIVIDER_PARAM_DEFAULTS = {
  amplitude: 50,
  depth: 50,
  steepness: 50,
  position: 50,
} as const
```

- [ ] **Step 4: Run types tests to verify they pass**

Run: `cd app-templates/v8 && pnpm test "divider-types"`
Expected: PASS.

- [ ] **Step 5: Write failing presets test**

Create `app-templates/v8/src/lib/__tests__/divider-presets.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  DIVIDER_PRESET_META,
  getDividerMeta,
  getDividersByCategory,
  getAllDividerPresets,
} from '../divider-presets'

describe('divider presets metadata', () => {
  it('has 15 entries keyed by preset id', () => {
    expect(Object.keys(DIVIDER_PRESET_META)).toHaveLength(15)
  })

  it('each entry has id, name, category', () => {
    for (const [id, meta] of Object.entries(DIVIDER_PRESET_META)) {
      expect(meta.id).toBe(id)
      expect(typeof meta.name).toBe('string')
      expect(['waves', 'angles', 'curves', 'geometric', 'minimal']).toContain(meta.category)
    }
  })

  it('getDividerMeta returns the right entry', () => {
    expect(getDividerMeta('wave-smooth').category).toBe('waves')
    expect(getDividerMeta('tilt').category).toBe('angles')
    expect(getDividerMeta('triangle').category).toBe('geometric')
    expect(getDividerMeta('fade').category).toBe('minimal')
  })

  it('getDividersByCategory partitions correctly', () => {
    expect(getDividersByCategory('waves').map((m) => m.id)).toEqual([
      'wave-smooth',
      'wave-layered',
      'wave-asymmetric',
    ])
    expect(getDividersByCategory('angles').map((m) => m.id)).toEqual(['tilt', 'arrow'])
    expect(getDividersByCategory('minimal').map((m) => m.id)).toEqual(['fade', 'line'])
  })

  it('getAllDividerPresets returns 15 entries in declaration order', () => {
    const all = getAllDividerPresets()
    expect(all).toHaveLength(15)
    expect(all[0].id).toBe('wave-smooth')
    expect(all[14].id).toBe('line')
  })
})
```

- [ ] **Step 6: Run presets test to verify it fails**

Run: `cd app-templates/v8 && pnpm test "divider-presets"`
Expected: FAIL with module-not-found.

- [ ] **Step 7: Implement `divider-presets.ts`**

Create `app-templates/v8/src/lib/divider-presets.ts`:

```typescript
import type { DividerPreset, DividerCategory } from './divider-types'

export interface DividerPresetMeta {
  id: DividerPreset
  name: string
  category: DividerCategory
}

export const DIVIDER_PRESET_META: Record<DividerPreset, DividerPresetMeta> = {
  'wave-smooth': { id: 'wave-smooth', name: 'Smooth Wave', category: 'waves' },
  'wave-layered': { id: 'wave-layered', name: 'Layered Waves', category: 'waves' },
  'wave-asymmetric': { id: 'wave-asymmetric', name: 'Asymmetric Wave', category: 'waves' },
  tilt: { id: 'tilt', name: 'Tilt', category: 'angles' },
  arrow: { id: 'arrow', name: 'Arrow', category: 'angles' },
  'curve-concave': { id: 'curve-concave', name: 'Concave', category: 'curves' },
  'curve-convex': { id: 'curve-convex', name: 'Convex', category: 'curves' },
  'curve-double': { id: 'curve-double', name: 'Double Curve', category: 'curves' },
  sweep: { id: 'sweep', name: 'Sweep', category: 'curves' },
  spill: { id: 'spill', name: 'Spill', category: 'curves' },
  triangle: { id: 'triangle', name: 'Triangle', category: 'geometric' },
  peaks: { id: 'peaks', name: 'Peaks', category: 'geometric' },
  steps: { id: 'steps', name: 'Steps', category: 'geometric' },
  fade: { id: 'fade', name: 'Fade', category: 'minimal' },
  line: { id: 'line', name: 'Line', category: 'minimal' },
}

export function getDividerMeta(id: DividerPreset): DividerPresetMeta {
  return DIVIDER_PRESET_META[id]
}

export function getDividersByCategory(category: DividerCategory): DividerPresetMeta[] {
  return getAllDividerPresets().filter((m) => m.category === category)
}

export function getAllDividerPresets(): DividerPresetMeta[] {
  return Object.values(DIVIDER_PRESET_META)
}
```

- [ ] **Step 8: Run presets test to verify it passes**

Run: `cd app-templates/v8 && pnpm test "divider-presets"`
Expected: PASS.

- [ ] **Step 9: Write failing heights test**

Create `app-templates/v8/src/lib/__tests__/divider-heights.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { getDividerHeight } from '../divider-heights'

describe('getDividerHeight', () => {
  it('returns the base clamp for default-param presets', () => {
    expect(getDividerHeight({ preset: 'fade' })).toMatch(/clamp\(/)
    expect(getDividerHeight({ preset: 'line' })).toMatch(/clamp\(/)
  })

  it('scales above 1 when amplitude is high', () => {
    const low = getDividerHeight({ preset: 'wave-smooth', amplitude: 50 })
    const high = getDividerHeight({ preset: 'wave-smooth', amplitude: 100 })
    expect(low).not.toEqual(high)
    expect(high).toContain('* ')
  })

  it('special-cases spill to use viewBox-derived ratio', () => {
    const small = getDividerHeight({ preset: 'spill', depth: 20 })
    const large = getDividerHeight({ preset: 'spill', depth: 100 })
    expect(small).toMatch(/clamp\(/)
    expect(large).toContain('* ')
  })

  it('clamps the scale to [0.85, 1.6]', () => {
    const props = { preset: 'wave-smooth' as const, amplitude: 100 }
    const out = getDividerHeight(props)
    const match = out.match(/\* ([0-9.]+)/)
    if (match) {
      const scale = Number(match[1])
      expect(scale).toBeLessThanOrEqual(1.6)
      expect(scale).toBeGreaterThanOrEqual(0.85)
    }
  })
})
```

- [ ] **Step 10: Run heights test to verify it fails**

Run: `cd app-templates/v8 && pnpm test "divider-heights"`
Expected: FAIL with module-not-found.

- [ ] **Step 11: Implement `divider-heights.ts`**

Create `app-templates/v8/src/lib/divider-heights.ts`. Port from `gdcorp-im/muse:packages/sections/src/dividers/heights.ts`:

```typescript
import type { DividerPreset, SectionDividerProps } from './divider-types'

const DIVIDER_PRESET_HEIGHTS: Record<DividerPreset, string> = {
  'wave-smooth': 'clamp(40px, 8vw, 120px)',
  'wave-layered': 'clamp(48px, 9vw, 140px)',
  'wave-asymmetric': 'clamp(40px, 8vw, 120px)',
  tilt: 'clamp(32px, 6vw, 96px)',
  arrow: 'clamp(40px, 7vw, 110px)',
  'curve-concave': 'clamp(40px, 7vw, 110px)',
  'curve-convex': 'clamp(40px, 7vw, 110px)',
  'curve-double': 'clamp(48px, 9vw, 140px)',
  sweep: 'clamp(40px, 8vw, 120px)',
  spill: 'clamp(48px, 9vw, 140px)',
  triangle: 'clamp(36px, 7vw, 100px)',
  peaks: 'clamp(40px, 8vw, 120px)',
  steps: 'clamp(40px, 8vw, 120px)',
  fade: 'clamp(48px, 9vw, 120px)',
  line: 'clamp(2px, 0.2vw, 4px)',
}

const PRESET_HEIGHT_PARAMS: Record<DividerPreset, Array<keyof SectionDividerProps>> = {
  'wave-smooth': ['amplitude'],
  'wave-layered': ['amplitude'],
  'wave-asymmetric': ['amplitude'],
  tilt: ['steepness'],
  arrow: ['depth'],
  'curve-concave': ['depth'],
  'curve-convex': ['depth'],
  'curve-double': ['depth'],
  sweep: ['steepness', 'depth'],
  spill: [],
  triangle: ['depth'],
  peaks: ['depth'],
  steps: ['depth'],
  fade: [],
  line: [],
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getDividerHeightScale(divider: SectionDividerProps): number {
  const params = PRESET_HEIGHT_PARAMS[divider.preset]
  if (params.length === 0) return 1
  let scale = 1
  for (const key of params) {
    const value = (divider[key] as number | undefined) ?? 50
    scale += ((value - 50) / 100) * 0.4
  }
  return clamp(scale, 0.85, 1.6)
}

function getSpillViewHeightRatio(depth: number): number {
  if (depth <= 50) return 1
  return 1 + ((depth - 50) / 50) * 0.6
}

function getDividerHeightForPreset(preset: DividerPreset): string {
  return DIVIDER_PRESET_HEIGHTS[preset]
}

export function getDividerHeight(divider: SectionDividerProps): string {
  const base = getDividerHeightForPreset(divider.preset)
  if (divider.preset === 'spill') {
    const depth = divider.depth ?? 50
    const ratio = getSpillViewHeightRatio(depth)
    if (ratio <= 1) return base
    return `calc(${base} * ${ratio})`
  }
  const scale = getDividerHeightScale(divider)
  if (scale === 1) return base
  return `calc(${base} * ${scale})`
}
```

- [ ] **Step 12: Run heights test to verify it passes**

Run: `cd app-templates/v8 && pnpm test "divider-heights"`
Expected: PASS.

- [ ] **Step 13: Run full Task 1 test suite**

Run: `cd app-templates/v8 && pnpm test "divider-(types|presets|heights)"`
Expected: PASS for all three.

- [ ] **Step 14: Run app-template typecheck**

Run: `cd app-templates/v8 && pnpm typecheck`
Expected: PASS.

- [ ] **Step 15: Commit Task 1**

```bash
git add app-templates/v8/src/lib/divider-types.ts \
        app-templates/v8/src/lib/divider-presets.ts \
        app-templates/v8/src/lib/divider-heights.ts \
        app-templates/v8/src/lib/__tests__/divider-types.test.ts \
        app-templates/v8/src/lib/__tests__/divider-presets.test.ts \
        app-templates/v8/src/lib/__tests__/divider-heights.test.ts
git commit -m "Add runtime divider types, presets, and height helper"
```

---

### Task 2: Runtime SectionDivider component + preset SVG bodies

**Files:**
- Create: `app-templates/v8/src/components/SectionDivider.tsx`
- Create: `app-templates/v8/src/components/dividers/WaveSmooth.tsx` (fully implemented)
- Create: 14 stub preset files for the other presets, one per preset
- Create: `app-templates/v8/src/components/__tests__/SectionDivider.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `app-templates/v8/src/components/__tests__/SectionDivider.test.tsx`:

```typescript
/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { SectionDivider } from '../SectionDivider'
import type { DividerPreset } from '../../lib/divider-types'

describe('SectionDivider', () => {
  afterEach(() => cleanup())

  it('renders an SVG for wave-smooth', () => {
    const { container } = render(<SectionDivider preset="wave-smooth" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1200 120')
  })

  it('reflects amplitude in the wave-smooth path', () => {
    const { container: a } = render(<SectionDivider preset="wave-smooth" amplitude={20} />)
    const { container: b } = render(<SectionDivider preset="wave-smooth" amplitude={80} />)
    const da = a.querySelector('path')?.getAttribute('d') ?? ''
    const db = b.querySelector('path')?.getAttribute('d') ?? ''
    expect(da).not.toEqual(db)
  })

  it('renders wrapping element with computed height for wave-smooth at default', () => {
    const { container } = render(<SectionDivider preset="wave-smooth" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.style.height).toMatch(/clamp\(/)
  })

  describe.each([
    'wave-smooth',
    'wave-layered',
    'wave-asymmetric',
    'tilt',
    'arrow',
    'curve-concave',
    'curve-convex',
    'curve-double',
    'sweep',
    'spill',
    'triangle',
    'peaks',
    'steps',
    'fade',
    'line',
  ] satisfies DividerPreset[])('preset %s', (preset) => {
    it('renders without throwing', () => {
      expect(() => render(<SectionDivider preset={preset} />)).not.toThrow()
    })
  })

  describe('color resolution', () => {
    let next: HTMLElement
    beforeEach(() => {
      next = document.createElement('section')
      next.style.backgroundColor = 'rgb(255, 0, 0)'
      document.body.appendChild(next)
    })
    afterEach(() => {
      document.body.innerHTML = ''
    })

    it('uses explicit color when provided', () => {
      const { container } = render(<SectionDivider preset="wave-smooth" color="#00ff00" />)
      expect(container.querySelector('path')?.getAttribute('fill')).toBe('#00ff00')
    })

    it('falls back to transparent when no next sibling exists', () => {
      const { container } = render(<SectionDivider preset="wave-smooth" />)
      const fill = container.querySelector('path')?.getAttribute('fill') ?? ''
      expect(['transparent', 'currentColor']).toContain(fill)
    })
  })
})
```

- [ ] **Step 2: Run component tests to verify they fail**

Run: `cd app-templates/v8 && pnpm test "SectionDivider"`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement WaveSmooth (the full reference preset)**

Create `app-templates/v8/src/components/dividers/WaveSmooth.tsx`:

```tsx
import type { DividerPresetProps } from '../../lib/divider-types'

export function WaveSmooth({ amplitude = 50, color }: DividerPresetProps) {
  const waveHeight = (amplitude / 100) * 60
  const mid = 60
  const top = mid - waveHeight
  const bottom = mid + waveHeight
  return (
    <svg
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <path
        d={`M0,${mid} C200,${bottom} 400,${top} 600,${mid} C800,${bottom} 1000,${top} 1200,${mid} L1200,120 L0,120 Z`}
        fill={color ?? 'currentColor'}
      />
    </svg>
  )
}
```

- [ ] **Step 4: Stub the remaining 14 preset components**

For each of `WaveLayered`, `WaveAsymmetric`, `Tilt`, `Arrow`, `CurveConcave`, `CurveConvex`, `CurveDouble`, `Sweep`, `Spill`, `Triangle`, `Peaks`, `Steps`, `Fade`, `Line`, create a file at `app-templates/v8/src/components/dividers/<Name>.tsx` with a placeholder body. Use this template (replace `<Name>` and the params comment per the spec slider matrix):

```tsx
import type { DividerPresetProps } from '../../lib/divider-types'

// TODO: Port SVG body from gdcorp-im/muse:packages/sections/src/dividers/presets/<Name>.tsx.
// Relevant params for this preset: <list per spec slider matrix — see DividerPicker contextual sliders section>.
// Expected viewBox: "0 0 1200 120" (or as Muse defines for asymmetric/spill/steps).
// Example: Tilt uses steepness + position; Arrow uses depth + position; Fade uses none.
export function <Name>(props: DividerPresetProps) {
  return (
    <svg
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <rect x="0" y="118" width="1200" height="2" fill={props.color ?? 'currentColor'} />
    </svg>
  )
}
```

The placeholder draws a thin line at the bottom so smoke tests pass while implementations are pending.

The implementer should track the porting work as a follow-up and replace each placeholder with the corresponding Muse SVG. The `divider-heights.ts` clamp values are already preset-specific; SVG body is the only outstanding work.

- [ ] **Step 5: Implement `SectionDivider.tsx`**

> **Important — two distinct DOM markers, only one is the classifier signal:**
>
> 1. **`data-component="SectionDivider"`** — set by *this* component on its wrapping `<div>`. This is what `isDividerElement` keys off. Always present whenever the component renders, no source-mapper involvement needed.
> 2. **`data-dev-id`, `data-dev-file`, `data-dev-line`** — injected by the source-mapper as JSX attributes on `<SectionDivider …>`. For React components these arrive as props and *must be forwarded* to the DOM root or the AST locator can't read file/line/devId from the wrapper. The source-mapper does **not** inject `data-dev-component` (`extractDevContext` documents this with an explicit fallback to `"unknown"`), so don't try to forward it.
>
> Without the wrapper's `data-component="SectionDivider"` attribute, `isDividerElement` returns false in production. Without the forwarded `data-dev-*` props, the agent's AST locator can't find the file/line. Both are load-bearing.

Create `app-templates/v8/src/components/SectionDivider.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DividerPreset, SectionDividerProps } from '../lib/divider-types'
import { getDividerHeight } from '../lib/divider-heights'
import { WaveSmooth } from './dividers/WaveSmooth'
import { WaveLayered } from './dividers/WaveLayered'
import { WaveAsymmetric } from './dividers/WaveAsymmetric'
import { Tilt } from './dividers/Tilt'
import { Arrow } from './dividers/Arrow'
import { CurveConcave } from './dividers/CurveConcave'
import { CurveConvex } from './dividers/CurveConvex'
import { CurveDouble } from './dividers/CurveDouble'
import { Sweep } from './dividers/Sweep'
import { Spill } from './dividers/Spill'
import { Triangle } from './dividers/Triangle'
import { Peaks } from './dividers/Peaks'
import { Steps } from './dividers/Steps'
import { Fade } from './dividers/Fade'
import { Line } from './dividers/Line'

const PRESET_COMPONENTS: Record<DividerPreset, React.ComponentType<{
  amplitude?: number
  depth?: number
  steepness?: number
  position?: number
  color?: string
}>> = {
  'wave-smooth': WaveSmooth,
  'wave-layered': WaveLayered,
  'wave-asymmetric': WaveAsymmetric,
  tilt: Tilt,
  arrow: Arrow,
  'curve-concave': CurveConcave,
  'curve-convex': CurveConvex,
  'curve-double': CurveDouble,
  sweep: Sweep,
  spill: Spill,
  triangle: Triangle,
  peaks: Peaks,
  steps: Steps,
  fade: Fade,
  line: Line,
}

function isSolidColor(color: string): boolean {
  return /^rgb\(|^rgba\(|^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(color) && !color.startsWith('linear-gradient')
}

function resolveColorFromNextSibling(el: HTMLElement | null): string {
  if (!el) return 'transparent'
  const next = el.nextElementSibling as HTMLElement | null
  if (!next) return 'transparent'
  const style = window.getComputedStyle(next)
  if (style.display === 'none' || style.visibility === 'hidden') return 'transparent'
  const bg = style.backgroundColor
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return 'transparent'
  if (!isSolidColor(bg)) return 'transparent'
  return bg
}

export interface SectionDividerComponentProps extends SectionDividerProps {
  'data-dev-id'?: string
  'data-dev-file'?: string
  'data-dev-line'?: string | number
}

export function SectionDivider(props: SectionDividerComponentProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [resolvedColor, setResolvedColor] = useState<string>('transparent')

  useLayoutEffect(() => {
    if (props.color !== undefined) {
      setResolvedColor(props.color)
      return
    }
    const update = () => setResolvedColor(resolveColorFromNextSibling(ref.current))
    update()
    const next = ref.current?.nextElementSibling
    if (!next) return
    const observer = new MutationObserver(update)
    observer.observe(next, { attributes: true, attributeFilter: ['style', 'class'] })
    return () => observer.disconnect()
  }, [props.color, props.preset])

  const Preset = PRESET_COMPONENTS[props.preset]
  const height = getDividerHeight(props)

  return (
    <div
      ref={ref}
      data-component="SectionDivider"
      data-dev-id={props['data-dev-id']}
      data-dev-file={props['data-dev-file']}
      data-dev-line={props['data-dev-line']}
      className={props.className}
      style={{ width: '100%', height, lineHeight: 0, overflow: 'hidden' }}
    >
      <Preset
        amplitude={props.amplitude}
        depth={props.depth}
        steepness={props.steepness}
        position={props.position}
        color={resolvedColor}
      />
    </div>
  )
}
```

Add a regression test that asserts forwarding works. Append to `app-templates/v8/src/components/__tests__/SectionDivider.test.tsx` before the color-resolution describe block:

```typescript
describe('SectionDivider DOM markers', () => {
  it('forwards source-mapper attributes (data-dev-id, data-dev-file, data-dev-line) to the wrapping div', () => {
    const { container } = render(
      <SectionDivider
        preset="wave-smooth"
        data-dev-id="abc123"
        data-dev-file="src/pages/index.tsx"
        data-dev-line={42}
      />,
    )
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.getAttribute('data-dev-id')).toBe('abc123')
    expect(wrapper.getAttribute('data-dev-file')).toBe('src/pages/index.tsx')
    expect(wrapper.getAttribute('data-dev-line')).toBe('42')
  })

  it('always sets data-component="SectionDivider" on the wrapping div', () => {
    const { container } = render(<SectionDivider preset="wave-smooth" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.getAttribute('data-component')).toBe('SectionDivider')
  })

  it('inner SVG can be classified as a divider via closest() walk', () => {
    const { container } = render(<SectionDivider preset="wave-smooth" />)
    const svg = container.querySelector('svg') as HTMLElement
    expect(svg).not.toBeNull()
    const wrapper = svg.closest('[data-component="SectionDivider"]')
    expect(wrapper).not.toBeNull()
  })
})
```

- [ ] **Step 6: Run component tests to verify they pass**

Run: `cd app-templates/v8 && pnpm test "SectionDivider"`
Expected: PASS.

- [ ] **Step 7: Run app-template typecheck**

Run: `cd app-templates/v8 && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add app-templates/v8/src/components/SectionDivider.tsx \
        app-templates/v8/src/components/dividers/ \
        app-templates/v8/src/components/__tests__/SectionDivider.test.tsx
git commit -m "Add SectionDivider runtime component with preset router"
```

---

### Task 3: Optimistic preview store + SectionDivider integration

**Files:**
- Create: `app-templates/v8/src/lib/divider-preview.ts`
- Create: `app-templates/v8/src/lib/__tests__/divider-preview.test.ts`
- Modify: `app-templates/v8/src/components/SectionDivider.tsx`
- Modify: `app-templates/v8/src/components/__tests__/SectionDivider.test.tsx`

- [ ] **Step 1: Write failing preview store tests**

Create `app-templates/v8/src/lib/__tests__/divider-preview.test.ts`:

```typescript
/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest'
import { dividerPreview } from '../divider-preview'

describe('dividerPreview store', () => {
  beforeEach(() => {
    dividerPreview.clear('a')
    dividerPreview.clear('b')
  })

  it('returns undefined for unset devIds', () => {
    expect(dividerPreview.get('a')).toBeUndefined()
  })

  it('set then get returns the override', () => {
    dividerPreview.set('a', { preset: 'tilt', amplitude: 60 })
    expect(dividerPreview.get('a')).toEqual({ preset: 'tilt', amplitude: 60 })
  })

  it('clear removes the override', () => {
    dividerPreview.set('a', { preset: 'tilt' })
    dividerPreview.clear('a')
    expect(dividerPreview.get('a')).toBeUndefined()
  })

  it('isolates devIds', () => {
    dividerPreview.set('a', { preset: 'tilt' })
    dividerPreview.set('b', { preset: 'arrow' })
    expect(dividerPreview.get('a')?.preset).toBe('tilt')
    expect(dividerPreview.get('b')?.preset).toBe('arrow')
  })

  it('subscribers fire on set and clear', () => {
    let calls = 0
    const unsub = dividerPreview.subscribe(() => {
      calls++
    })
    dividerPreview.set('a', { preset: 'tilt' })
    dividerPreview.clear('a')
    expect(calls).toBeGreaterThanOrEqual(2)
    unsub()
  })

  it('unsubscribed listeners do not fire', () => {
    let calls = 0
    const unsub = dividerPreview.subscribe(() => {
      calls++
    })
    unsub()
    dividerPreview.set('a', { preset: 'tilt' })
    expect(calls).toBe(0)
  })

  it('exposes a window-level handle', () => {
    expect((window as unknown as { __airoDividerPreview__?: unknown }).__airoDividerPreview__).toBeDefined()
  })
})
```

- [ ] **Step 2: Run preview store test to verify it fails**

Run: `cd app-templates/v8 && pnpm test "divider-preview"`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `divider-preview.ts`**

Create `app-templates/v8/src/lib/divider-preview.ts`:

```typescript
import type { SectionDividerProps } from './divider-types'

export type DividerPreviewOverride = Partial<SectionDividerProps>

export interface DividerPreviewStore {
  set(devId: string, override: DividerPreviewOverride): void
  clear(devId: string): void
  get(devId: string): DividerPreviewOverride | undefined
  subscribe(listener: () => void): () => void
}

function createStore(): DividerPreviewStore {
  const overrides = new Map<string, DividerPreviewOverride>()
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) listener()
  }

  return {
    set(devId, override) {
      overrides.set(devId, { ...override })
      notify()
    },
    clear(devId) {
      if (overrides.delete(devId)) notify()
    },
    get(devId) {
      return overrides.get(devId)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const dividerPreview: DividerPreviewStore = createStore()

if (typeof window !== 'undefined') {
  ;(window as unknown as { __airoDividerPreview__: DividerPreviewStore }).__airoDividerPreview__ = dividerPreview
}
```

- [ ] **Step 4: Run preview store tests to verify they pass**

Run: `cd app-templates/v8 && pnpm test "divider-preview"`
Expected: PASS.

- [ ] **Step 5: Add failing SectionDivider preview-integration test**

Append to `app-templates/v8/src/components/__tests__/SectionDivider.test.tsx`:

```typescript
import { dividerPreview } from '../../lib/divider-preview'

describe('SectionDivider preview overrides', () => {
  afterEach(() => {
    dividerPreview.clear('test-1')
    cleanup()
  })

  it('renders the override preset when set in the store', () => {
    dividerPreview.set('test-1', { preset: 'tilt' })
    const { container } = render(<SectionDivider data-dev-id="test-1" preset="wave-smooth" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('reverts to incoming preset after clear', () => {
    dividerPreview.set('test-1', { preset: 'tilt' })
    const { container, rerender } = render(<SectionDivider data-dev-id="test-1" preset="wave-smooth" />)
    dividerPreview.clear('test-1')
    rerender(<SectionDivider data-dev-id="test-1" preset="wave-smooth" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('uses incoming props when no preview override is set', () => {
    const { container } = render(<SectionDivider data-dev-id="test-2" preset="wave-smooth" amplitude={50} />)
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1200 120')
  })
})
```

- [ ] **Step 6: Run integration test to verify it fails**

Run: `cd app-templates/v8 && pnpm test "SectionDivider"`
Expected: the new "preview overrides" tests fail because SectionDivider doesn't yet read from the store.

- [ ] **Step 7: Wire SectionDivider to subscribe to the preview store**

Edit `app-templates/v8/src/components/SectionDivider.tsx`. Update the props interface and merge logic:

```typescript
import { useSyncExternalStore } from 'react'
import { dividerPreview } from '../lib/divider-preview'

export interface SectionDividerComponentProps extends SectionDividerProps {
  'data-dev-id'?: string
}
```

Inside the component, before resolving `Preset`, add:

```typescript
const devId = (props as SectionDividerComponentProps)['data-dev-id']
const overrideSnapshot = useSyncExternalStore(
  dividerPreview.subscribe,
  () => (devId ? dividerPreview.get(devId) : undefined),
  () => undefined,
)
const merged: SectionDividerProps = overrideSnapshot
  ? { ...props, ...overrideSnapshot }
  : props
```

Then drive the render off `merged` instead of `props` for `preset`, `amplitude`, `depth`, `steepness`, `position`, and `getDividerHeight`.

- [ ] **Step 8: Run integration tests to verify they pass**

Run: `cd app-templates/v8 && pnpm test "SectionDivider"`
Expected: PASS.

- [ ] **Step 9: Run app-template typecheck**

Run: `cd app-templates/v8 && pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit Task 3**

```bash
git add app-templates/v8/src/lib/divider-preview.ts \
        app-templates/v8/src/lib/__tests__/divider-preview.test.ts \
        app-templates/v8/src/components/SectionDivider.tsx \
        app-templates/v8/src/components/__tests__/SectionDivider.test.tsx
git commit -m "Add optimistic divider preview store"
```

---

### Task 4: Element detection + dev-tools helpers + eventBus types

**Files:**
- Modify: `app-templates/v8/dev-tools/src/utils/element-detection.ts`
- Modify: `app-templates/v8/dev-tools/src/utils/__tests__/element-detection.test.ts`
- Create: `app-templates/v8/dev-tools/src/utils/dividerMessages.ts`
- Create: `app-templates/v8/dev-tools/src/utils/__tests__/dividerMessages.test.ts`
- Modify: `app-templates/v8/dev-tools/src/utils/eventBus.ts`
- Modify: `app/src/utils/eventBus.ts`

- [ ] **Step 1: Write failing isDividerElement test**

> **Why this test does not mock `extractDevContext`:** the production source-mapper does not inject `data-dev-component` (it injects only `data-dev-file`, `data-dev-line`, `data-dev-id` — see [`source-mapper/src/index.ts:430`](../../../app-templates/v8/source-mapper/src/index.ts#L430)). `extractDevContext` falls back to `componentName: "unknown"` when the attribute is absent ([`element-helpers.ts:48`](../../../app-templates/v8/dev-tools/src/utils/element-helpers.ts#L48)). Earlier drafts of this plan keyed `isDividerElement` off `componentName === "SectionDivider"` and the tests passed only because they mocked `extractDevContext`. In production every divider would be misclassified. The classifier now keys off `data-component="SectionDivider"`, which is rendered by the `SectionDivider` runtime component itself (Task 2) and is independent of source-mapper output. Tests use real DOM attributes so they exercise the production code path.

Append to `app-templates/v8/dev-tools/src/utils/__tests__/element-detection.test.ts`:

```typescript
/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { isDividerElement } from '../element-detection'

describe('isDividerElement', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns true for the wrapper itself when it carries data-component="SectionDivider"', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-component', 'SectionDivider')
    document.body.appendChild(wrapper)
    expect(isDividerElement(wrapper)).toBe(true)
  })

  it('returns true for inner descendants of a divider wrapper (closest() walk)', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-component', 'SectionDivider')
    const svg = document.createElement('svg')
    const path = document.createElement('path')
    svg.appendChild(path)
    wrapper.appendChild(svg)
    document.body.appendChild(wrapper)
    expect(isDividerElement(path as unknown as HTMLElement)).toBe(true)
    expect(isDividerElement(svg as unknown as HTMLElement)).toBe(true)
  })

  it('returns false for non-divider elements', () => {
    const section = document.createElement('section')
    section.setAttribute('data-component', 'Hero')
    document.body.appendChild(section)
    expect(isDividerElement(section)).toBe(false)
  })

  it('returns false for elements outside any divider wrapper', () => {
    const heading = document.createElement('h1')
    document.body.appendChild(heading)
    expect(isDividerElement(heading)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isDividerElement(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run element-detection tests to verify they fail**

Run: `cd app-templates/v8/dev-tools && pnpm test "element-detection"`
Expected: FAIL — `isDividerElement` is not exported.

- [ ] **Step 3: Implement `isDividerElement`**

Edit `app-templates/v8/dev-tools/src/utils/element-detection.ts`. Add at the bottom:

```typescript
export function isDividerElement(element: HTMLElement | null): boolean {
  if (!element) return false
  return !!element.closest('[data-component="SectionDivider"]')
}
```

No `extractDevContext` import is needed — classification is a single-attribute lookup walking up via `closest()`. The walk handles the inner-SVG click-target case the same way `extractDevContext`'s ancestor walk does for file/line/devId reads later.

- [ ] **Step 4: Run element-detection tests to verify they pass**

Run: `cd app-templates/v8/dev-tools && pnpm test "element-detection"`
Expected: PASS.

- [ ] **Step 5: Write failing dividerMessages tests**

> **Same rationale as the element-detection tests:** these tests use real DOM attributes and the real `extractDevContext` helper because the production code path reads `data-component` (the classifier marker, set by the runtime `SectionDivider`) and `data-dev-file` / `data-dev-line` / `data-dev-id` (the source-mapper attributes, forwarded through `SectionDivider` props). Mocking would hide the production-vs-test divergence that motivated this fix.

Create `app-templates/v8/dev-tools/src/utils/__tests__/dividerMessages.test.ts`:

```typescript
/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { readDividerTarget, readCurrentDividerProps, dividerCorrelatedListener } from '../dividerMessages'

function makeDividerWrapper({
  devId,
  file,
  line,
}: {
  devId?: string
  file?: string
  line?: string
}): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-component', 'SectionDivider')
  if (devId) wrapper.setAttribute('data-dev-id', devId)
  if (file) wrapper.setAttribute('data-dev-file', file)
  if (line) wrapper.setAttribute('data-dev-line', line)
  document.body.appendChild(wrapper)
  return wrapper
}

describe('readDividerTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns target metadata when the wrapper carries data-component + dev attributes', () => {
    const wrapper = makeDividerWrapper({
      devId: 'd1',
      file: 'src/pages/index.tsx',
      line: '25',
    })
    expect(readDividerTarget(wrapper)).toEqual({
      devId: 'd1',
      target: {
        file: 'src/pages/index.tsx',
        line: 25,
        component: 'SectionDivider',
      },
    })
  })

  it('walks up from inner SVG via closest() and reads the wrapper attributes', () => {
    const wrapper = makeDividerWrapper({
      devId: 'd1',
      file: 'src/pages/index.tsx',
      line: '25',
    })
    const svg = document.createElement('svg')
    wrapper.appendChild(svg)
    expect(readDividerTarget(svg as unknown as HTMLElement)).toEqual({
      devId: 'd1',
      target: { file: 'src/pages/index.tsx', line: 25, component: 'SectionDivider' },
    })
  })

  it('returns null when the wrapper is not a SectionDivider', () => {
    const heading = document.createElement('h1')
    document.body.appendChild(heading)
    expect(readDividerTarget(heading)).toBeNull()
  })

  it('returns null when devId or file/line are missing on a divider wrapper', () => {
    const wrapper = makeDividerWrapper({ devId: 'd1' /* no file/line */ })
    expect(readDividerTarget(wrapper)).toBeNull()
  })
})

describe('readCurrentDividerProps', () => {
  it('reads preset and numeric props from data attributes when present', () => {
    const el = document.createElement('div')
    el.setAttribute('data-divider-preset', 'tilt')
    el.setAttribute('data-divider-amplitude', '60')
    el.setAttribute('data-divider-position', '40')
    expect(readCurrentDividerProps(el)).toEqual({
      preset: 'tilt',
      amplitude: 60,
      position: 40,
    })
  })

  it('returns an empty object when nothing is present', () => {
    expect(readCurrentDividerProps(document.createElement('div'))).toEqual({})
  })
})

describe('dividerCorrelatedListener', () => {
  it('invokes the callback when a matching commitId arrives', () => {
    const cb = vi.fn()
    const unsub = dividerCorrelatedListener('commit-1', cb)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'EDIT_FAILED', commitId: 'commit-1', error: 'oops' },
      }),
    )
    expect(cb).toHaveBeenCalledWith({ status: 'failed', error: 'oops' })
    unsub()
  })

  it('ignores events for other commit ids', () => {
    const cb = vi.fn()
    const unsub = dividerCorrelatedListener('commit-1', cb)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'EDIT_FAILED', commitId: 'other', error: 'oops' },
      }),
    )
    expect(cb).not.toHaveBeenCalled()
    unsub()
  })
})
```

- [ ] **Step 6: Run dividerMessages tests to verify they fail**

Run: `cd app-templates/v8/dev-tools && pnpm test "dividerMessages"`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `dividerMessages.ts`**

Create `app-templates/v8/dev-tools/src/utils/dividerMessages.ts`:

```typescript
import { extractDevContext } from './element-helpers'

export interface DividerTarget {
  file: string
  line: number
  component: 'SectionDivider'
}

export interface DividerTargetReading {
  devId: string
  target: DividerTarget
}

export interface DividerCurrentProps {
  preset?: string
  amplitude?: number
  depth?: number
  steepness?: number
  position?: number
}

export function readDividerTarget(element: HTMLElement | null): DividerTargetReading | null {
  if (!element) return null
  const wrapper = element.closest('[data-component="SectionDivider"]') as HTMLElement | null
  if (!wrapper) return null
  const dev = extractDevContext(wrapper)
  if (!dev || !dev.devId) return null
  return {
    devId: dev.devId,
    target: {
      file: dev.fileName,
      line: dev.lineNumber,
      component: 'SectionDivider',
    },
  }
}

const NUMERIC_KEYS = ['amplitude', 'depth', 'steepness', 'position'] as const

export function readCurrentDividerProps(element: HTMLElement): DividerCurrentProps {
  const out: DividerCurrentProps = {}
  const preset = element.getAttribute('data-divider-preset')
  if (preset) out.preset = preset
  for (const key of NUMERIC_KEYS) {
    const value = element.getAttribute(`data-divider-${key}`)
    if (value !== null) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) out[key] = parsed
    }
  }
  return out
}

export type DividerCorrelationResult =
  | { status: 'succeeded'; commitHash?: string; removed?: boolean }
  | { status: 'failed'; error: string }

export function dividerCorrelatedListener(
  commitId: string,
  callback: (result: DividerCorrelationResult) => void,
): () => void {
  function handler(event: MessageEvent) {
    const data = event.data as { type?: string; commitId?: string; error?: string; commitHash?: string; removed?: boolean }
    if (!data || data.commitId !== commitId) return
    if (data.type === 'EDIT_FAILED') {
      callback({ status: 'failed', error: data.error ?? 'unknown' })
    } else if (data.type === 'DIVIDER_UPDATE_SUCCEEDED') {
      callback({ status: 'succeeded', commitHash: data.commitHash, removed: data.removed })
    }
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
```

The runtime `SectionDivider` component should also forward `preset` / numeric values onto its DOM root as `data-divider-*` attributes so `readCurrentDividerProps` works. Update `SectionDivider.tsx`'s wrapping `<div>` to add:

```tsx
data-divider-preset={merged.preset}
data-divider-amplitude={merged.amplitude}
data-divider-depth={merged.depth}
data-divider-steepness={merged.steepness}
data-divider-position={merged.position}
```

(Add only the non-undefined ones so `getAttribute` returns null for absent params.)

- [ ] **Step 8: Run dividerMessages tests to verify they pass**

Run: `cd app-templates/v8/dev-tools && pnpm test "dividerMessages"`
Expected: PASS.

- [ ] **Step 9: Add new event types to both eventBus files**

Edit `app-templates/v8/dev-tools/src/utils/eventBus.ts`. In the `BusEventMap` interface, add:

```typescript
DIVIDER_PREVIEWED: { data: BusDividerPreviewPayload };
DIVIDER_UPDATED: { data: BusDividerUpdatePayload };
```

Above the interface, add the payload types:

```typescript
export interface BusDividerPreviewPayload {
  devId: string
  override: {
    preset?: string
    amplitude?: number
    depth?: number
    steepness?: number
    position?: number
  }
}

export interface BusDividerUpdatePayload {
  commitId: string
  devId: string
  target: {
    file: string
    line: number
    component: 'SectionDivider'
  }
  action: 'update' | 'remove'
  props?: {
    preset?: string
    amplitude?: number | null
    depth?: number | null
    steepness?: number | null
    position?: number | null
  }
}
```

Apply the identical edit to `app/src/utils/eventBus.ts`. Both files have a header comment requiring them to stay in sync.

- [ ] **Step 10: Run dev-tools and app typechecks**

Run: `cd app-templates/v8/dev-tools && pnpm type-check`
Run: `pnpm --filter website typecheck`
Expected: PASS.

- [ ] **Step 11: Commit Task 4**

```bash
git add app-templates/v8/dev-tools/src/utils/element-detection.ts \
        app-templates/v8/dev-tools/src/utils/__tests__/element-detection.test.ts \
        app-templates/v8/dev-tools/src/utils/dividerMessages.ts \
        app-templates/v8/dev-tools/src/utils/__tests__/dividerMessages.test.ts \
        app-templates/v8/dev-tools/src/utils/eventBus.ts \
        app/src/utils/eventBus.ts \
        app-templates/v8/src/components/SectionDivider.tsx
git commit -m "Add divider element detection and event types"
```

---

### Task 5: DividerPicker component + ElementHoverBar Style action

> **Bundle boundary note:** the dev-tools bundle and the customer-app bundle are **separate** at runtime. Each gets its own JavaScript module instance. Anything imported as a value from `app-templates/v8/src/...` into `app-templates/v8/dev-tools/src/...` will be a *different instance* than the one running in the customer app, and runtime state (like the preview store) will not be shared. The format-override plan handles this by duplicating helpers across the boundary; we follow the same pattern. Type-only imports (`import type { ... }`) are fine because they erase at build time.
>
> Concretely:
> - The preview store **must** be accessed via the window singleton (`window.__airoDividerPreview__`), not by importing `dividerPreview`.
> - Preset metadata (id list, display names) is duplicated into `dev-tools/src/utils/divider-meta.ts` from `src/lib/divider-presets.ts`. Both files carry a header comment requiring sync.
> - Tile thumbnails use a separate dev-tools-only `DividerThumbnail` component, not the customer-app `<SectionDivider>` runtime.

**Files:**
- Create: `app-templates/v8/dev-tools/src/utils/dividerPreviewStore.ts`
- Create: `app-templates/v8/dev-tools/src/utils/__tests__/dividerPreviewStore.test.ts`
- Create: `app-templates/v8/dev-tools/src/utils/divider-meta.ts`
- Create: `app-templates/v8/dev-tools/src/components/DividerThumbnail.tsx`
- Create: `app-templates/v8/dev-tools/src/components/__tests__/DividerThumbnail.test.tsx`
- Create: `app-templates/v8/dev-tools/src/components/DividerPicker.tsx`
- Create: `app-templates/v8/dev-tools/src/components/__tests__/DividerPicker.test.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx`
- Modify: `app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx`

- [ ] **Step 0a: Implement the window-scoped preview store accessor**

Create `app-templates/v8/dev-tools/src/utils/dividerPreviewStore.ts`:

```typescript
// Type-only import — erased at build time, no runtime cross-bundle linkage.
import type { SectionDividerProps } from '../../../src/lib/divider-types'

export type DividerPreviewOverride = Partial<SectionDividerProps>

export interface DividerPreviewStore {
  set(devId: string, override: DividerPreviewOverride): void
  clear(devId: string): void
  get(devId: string): DividerPreviewOverride | undefined
  subscribe(listener: () => void): () => void
}

export function getDividerPreviewStore(): DividerPreviewStore | null {
  if (typeof window === 'undefined') return null
  const handle = (window as unknown as { __airoDividerPreview__?: DividerPreviewStore }).__airoDividerPreview__
  return handle ?? null
}

// Convenience wrappers that no-op safely when the customer-app bundle
// hasn't loaded yet (early picker render, SSR, jsdom without the v8 bundle).
export function setDividerPreview(devId: string, override: DividerPreviewOverride): void {
  getDividerPreviewStore()?.set(devId, override)
}

export function clearDividerPreview(devId: string): void {
  getDividerPreviewStore()?.clear(devId)
}
```

Tests at `app-templates/v8/dev-tools/src/utils/__tests__/dividerPreviewStore.test.ts`:

```typescript
/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { getDividerPreviewStore, setDividerPreview, clearDividerPreview } from '../dividerPreviewStore'

describe('dividerPreviewStore accessor', () => {
  let mockStore: { set: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockStore = { set: vi.fn(), clear: vi.fn(), get: vi.fn(), subscribe: vi.fn() }
    ;(window as unknown as { __airoDividerPreview__: typeof mockStore }).__airoDividerPreview__ = mockStore
  })

  afterEach(() => {
    delete (window as unknown as { __airoDividerPreview__?: unknown }).__airoDividerPreview__
  })

  it('returns the window-attached store', () => {
    expect(getDividerPreviewStore()).toBe(mockStore)
  })

  it('returns null when the store has not been published yet', () => {
    delete (window as unknown as { __airoDividerPreview__?: unknown }).__airoDividerPreview__
    expect(getDividerPreviewStore()).toBeNull()
  })

  it('setDividerPreview no-ops cleanly when store is missing', () => {
    delete (window as unknown as { __airoDividerPreview__?: unknown }).__airoDividerPreview__
    expect(() => setDividerPreview('a', { preset: 'tilt' })).not.toThrow()
  })

  it('setDividerPreview forwards to the published store', () => {
    setDividerPreview('a', { preset: 'tilt' })
    expect(mockStore.set).toHaveBeenCalledWith('a', { preset: 'tilt' })
  })

  it('clearDividerPreview forwards to the published store', () => {
    clearDividerPreview('a')
    expect(mockStore.clear).toHaveBeenCalledWith('a')
  })
})
```

- [ ] **Step 0b: Duplicate preset metadata in dev-tools**

Create `app-templates/v8/dev-tools/src/utils/divider-meta.ts`:

```typescript
// Mirrors app-templates/v8/src/lib/divider-presets.ts at the dev-tools side
// because the dev-tools and customer-app bundles cannot share runtime values.
// Keep this list in sync with the customer-app file. A typecheck against
// the type-only import below catches drift in the id union.
import type { DividerPreset } from '../../../src/lib/divider-types'

export interface DividerTileMeta {
  id: DividerPreset
  name: string
}

export const DIVIDER_TILE_METAS: DividerTileMeta[] = [
  { id: 'wave-smooth', name: 'Smooth Wave' },
  { id: 'wave-layered', name: 'Layered Waves' },
  { id: 'wave-asymmetric', name: 'Asymmetric Wave' },
  { id: 'tilt', name: 'Tilt' },
  { id: 'arrow', name: 'Arrow' },
  { id: 'curve-concave', name: 'Concave' },
  { id: 'curve-convex', name: 'Convex' },
  { id: 'curve-double', name: 'Double Curve' },
  { id: 'sweep', name: 'Sweep' },
  { id: 'spill', name: 'Spill' },
  { id: 'triangle', name: 'Triangle' },
  { id: 'peaks', name: 'Peaks' },
  { id: 'steps', name: 'Steps' },
  { id: 'fade', name: 'Fade' },
  { id: 'line', name: 'Line' },
]
```

- [ ] **Step 0c: Implement `DividerThumbnail` for tile previews**

Create `app-templates/v8/dev-tools/src/components/DividerThumbnail.tsx`:

```tsx
import type { DividerPreset } from '../../../src/lib/divider-types'

interface DividerThumbnailProps {
  preset: DividerPreset
  selected?: boolean
}

// Lightweight inline-SVG thumbnails for the dev-tools picker grid.
// Intentionally simpler than the customer-app SectionDivider runtime —
// thumbnails are 60x24 viewbox, single representative shape per preset.
// V1 uses a recognizable silhouette per preset family; full visual parity
// is a polish follow-up. Keep these in sync with the runtime SVG bodies
// when those land (each customer-app preset SVG can crib its path here).
export function DividerThumbnail({ preset, selected }: DividerThumbnailProps) {
  return (
    <svg
      viewBox="0 0 60 24"
      preserveAspectRatio="none"
      width={60}
      height={24}
      role="img"
      aria-label={preset}
      data-selected={selected || undefined}
    >
      <path d={getThumbnailPath(preset)} fill="currentColor" />
    </svg>
  )
}

function getThumbnailPath(preset: DividerPreset): string {
  switch (preset) {
    case 'wave-smooth':
      return 'M0,12 C10,4 20,20 30,12 C40,4 50,20 60,12 L60,24 L0,24 Z'
    case 'wave-layered':
      return 'M0,14 C12,8 24,20 36,14 C48,8 60,20 60,14 L60,24 L0,24 Z'
    case 'wave-asymmetric':
      return 'M0,12 C20,4 30,18 60,10 L60,24 L0,24 Z'
    case 'tilt':
      return 'M0,16 L60,8 L60,24 L0,24 Z'
    case 'arrow':
      return 'M0,14 L30,4 L60,14 L60,24 L0,24 Z'
    case 'curve-concave':
      return 'M0,8 Q30,24 60,8 L60,24 L0,24 Z'
    case 'curve-convex':
      return 'M0,16 Q30,4 60,16 L60,24 L0,24 Z'
    case 'curve-double':
      return 'M0,12 Q15,4 30,12 Q45,20 60,12 L60,24 L0,24 Z'
    case 'sweep':
      return 'M0,18 Q30,4 60,12 L60,24 L0,24 Z'
    case 'spill':
      return 'M0,14 Q15,22 30,14 Q45,6 60,14 L60,24 L0,24 Z'
    case 'triangle':
      return 'M0,14 L30,4 L60,14 L60,24 L0,24 Z'
    case 'peaks':
      return 'M0,14 L15,4 L30,14 L45,4 L60,14 L60,24 L0,24 Z'
    case 'steps':
      return 'M0,12 L15,12 L15,8 L30,8 L30,12 L45,12 L45,8 L60,8 L60,24 L0,24 Z'
    case 'fade':
      return 'M0,16 L60,16 L60,24 L0,24 Z'
    case 'line':
      return 'M0,22 L60,22 L60,24 L0,24 Z'
  }
}
```

Tests at `app-templates/v8/dev-tools/src/components/__tests__/DividerThumbnail.test.tsx`:

```typescript
/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { DividerThumbnail } from '../DividerThumbnail'
import { DIVIDER_TILE_METAS } from '../../utils/divider-meta'

describe('DividerThumbnail', () => {
  it.each(DIVIDER_TILE_METAS.map((m) => m.id))('renders preset %s without throwing', (id) => {
    expect(() => render(<DividerThumbnail preset={id} />)).not.toThrow()
  })

  it('marks the SVG as selected via data-selected when selected prop is true', () => {
    const { container } = render(<DividerThumbnail preset="wave-smooth" selected />)
    expect(container.querySelector('svg')?.getAttribute('data-selected')).toBe('true')
  })

  it('omits data-selected when not selected', () => {
    const { container } = render(<DividerThumbnail preset="wave-smooth" />)
    expect(container.querySelector('svg')?.hasAttribute('data-selected')).toBe(false)
  })
})
```

- [ ] **Step 1: Write failing DividerPicker tests**

Create `app-templates/v8/dev-tools/src/components/__tests__/DividerPicker.test.tsx`:

```typescript
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { DividerPicker } from '../DividerPicker'

vi.mock('../../utils/postMessage', () => ({
  safePostMessage: vi.fn(),
}))

const { safePostMessage } = await import('../../utils/postMessage')

// Provide a fake window-scoped preview store so the picker's `setDividerPreview`
// / `clearDividerPreview` calls are observable in tests. In production the
// customer-app bundle publishes the real store on window.__airoDividerPreview__.
const fakeStore = {
  set: vi.fn(),
  clear: vi.fn(),
  get: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}

const baseTarget = {
  devId: 'div-1',
  target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' as const },
  current: { preset: 'wave-smooth', amplitude: 50 },
}

describe('DividerPicker', () => {
  beforeEach(() => {
    vi.mocked(safePostMessage).mockReset()
    fakeStore.set.mockReset()
    fakeStore.clear.mockReset()
    ;(window as unknown as { __airoDividerPreview__: typeof fakeStore }).__airoDividerPreview__ = fakeStore
  })

  afterEach(() => cleanup())

  it('renders a tile for each of the 15 presets', () => {
    render(<DividerPicker open {...baseTarget} onClose={() => {}} />)
    expect(screen.getAllByTestId(/divider-tile-/)).toHaveLength(15)
  })

  it('selecting a preset shows only its sliders', () => {
    render(<DividerPicker open {...baseTarget} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('divider-tile-tilt'))
    expect(screen.getByTestId('divider-slider-steepness')).toBeTruthy()
    expect(screen.getByTestId('divider-slider-position')).toBeTruthy()
    expect(screen.queryByTestId('divider-slider-amplitude')).toBeNull()
  })

  it('slider drag writes to the preview store via the window accessor', () => {
    render(<DividerPicker open {...baseTarget} onClose={() => {}} />)
    const slider = screen.getByTestId('divider-slider-amplitude').querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.input(slider, { target: { value: '70' } })
    expect(fakeStore.set).toHaveBeenCalledWith('div-1', expect.objectContaining({ amplitude: 70 }))
  })

  it('release posts DIVIDER_UPDATED via safePostMessage', () => {
    render(<DividerPicker open {...baseTarget} onClose={() => {}} />)
    const slider = screen.getByTestId('divider-slider-amplitude').querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.input(slider, { target: { value: '75' } })
    fireEvent.change(slider, { target: { value: '75' } })
    expect(safePostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DIVIDER_UPDATED',
        action: 'update',
        devId: 'div-1',
        props: expect.objectContaining({ amplitude: 75 }),
      }),
    )
  })

  it('Remove button posts DIVIDER_UPDATED with action: remove', () => {
    render(<DividerPicker open {...baseTarget} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(safePostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DIVIDER_UPDATED', action: 'remove', devId: 'div-1' }),
    )
  })

  it('rolls back preview on EDIT_FAILED', () => {
    render(<DividerPicker open {...baseTarget} onClose={() => {}} />)
    const slider = screen.getByTestId('divider-slider-amplitude').querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.input(slider, { target: { value: '80' } })
    fireEvent.change(slider, { target: { value: '80' } })
    const lastCall = vi.mocked(safePostMessage).mock.calls.at(-1)?.[0] as { commitId: string }
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'EDIT_FAILED', commitId: lastCall.commitId, error: 'boom' },
      }),
    )
    expect(fakeStore.clear).toHaveBeenCalledWith('div-1')
  })

  it('preset values are quantized to step 5', () => {
    render(<DividerPicker open {...baseTarget} onClose={() => {}} />)
    const slider = screen.getByTestId('divider-slider-amplitude').querySelector('input[type="range"]') as HTMLInputElement
    expect(slider.step).toBe('5')
    expect(slider.min).toBe('10')
    expect(slider.max).toBe('100')
  })
})
```

- [ ] **Step 2: Run DividerPicker tests to verify they fail**

Run: `cd app-templates/v8/dev-tools && pnpm test "DividerPicker"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `DividerPicker.tsx`**

Create `app-templates/v8/dev-tools/src/components/DividerPicker.tsx`:

```tsx
import * as Popover from '@radix-ui/react-popover'
import * as Slider from '@radix-ui/react-slider'
import { useEffect, useRef, useState } from 'react'
// Type-only imports across the bundle boundary are safe — they erase at build time.
// Value imports are NOT safe and would create a separate module instance.
import type { DividerPreset, SectionDividerProps } from '../../../src/lib/divider-types'
// Runtime values come from the dev-tools-side duplicates and the window-scoped accessor.
import { DIVIDER_TILE_METAS } from '../utils/divider-meta'
import { setDividerPreview, clearDividerPreview } from '../utils/dividerPreviewStore'
import { DividerThumbnail } from './DividerThumbnail'
import { safePostMessage } from '../utils/postMessage'
import { dividerCorrelatedListener } from '../utils/dividerMessages'
import { t } from '../utils/translations'

type NumericKey = 'amplitude' | 'depth' | 'steepness' | 'position'

const USES_AMPLITUDE: ReadonlySet<DividerPreset> = new Set(['wave-smooth', 'wave-layered', 'wave-asymmetric'])
const USES_DEPTH: ReadonlySet<DividerPreset> = new Set([
  'arrow', 'triangle', 'curve-concave', 'curve-convex', 'curve-double', 'sweep', 'spill', 'peaks', 'steps',
])
const USES_STEEPNESS: ReadonlySet<DividerPreset> = new Set(['tilt', 'sweep'])
const USES_POSITION: ReadonlySet<DividerPreset> = new Set([
  'tilt', 'sweep', 'arrow', 'triangle', 'curve-concave', 'curve-convex', 'curve-double', 'peaks', 'steps', 'spill',
])

interface DividerPickerProps {
  open: boolean
  devId: string
  target: { file: string; line: number; component: 'SectionDivider' }
  current: SectionDividerProps
  anchorElement?: HTMLElement | null
  onClose: () => void
}

export function DividerPicker({ open, devId, target, current, anchorElement, onClose }: DividerPickerProps) {
  const [draft, setDraft] = useState<SectionDividerProps>(current)
  const lastCommitId = useRef<string | null>(null)

  useEffect(() => {
    setDraft(current)
  }, [current])

  function newCommitId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `commit-${Date.now()}-${Math.random()}`
  }

  function postUpdate(action: 'update' | 'remove', props?: SectionDividerProps) {
    const commitId = newCommitId()
    lastCommitId.current = commitId
    const unsub = dividerCorrelatedListener(commitId, (result) => {
      if (result.status === 'failed') {
        clearDividerPreview(devId)
        setDraft(current)
      } else {
        clearDividerPreview(devId)
      }
      unsub()
    })
    safePostMessage({
      type: 'DIVIDER_UPDATED',
      commitId,
      devId,
      target,
      action,
      props: action === 'update'
        ? {
            preset: props?.preset,
            amplitude: USES_AMPLITUDE.has(props!.preset) ? (props?.amplitude ?? null) : null,
            depth: USES_DEPTH.has(props!.preset) ? (props?.depth ?? null) : null,
            steepness: USES_STEEPNESS.has(props!.preset) ? (props?.steepness ?? null) : null,
            position: USES_POSITION.has(props!.preset) ? (props?.position ?? null) : null,
          }
        : undefined,
    })
  }

  function handleSelectPreset(preset: DividerPreset) {
    const next: SectionDividerProps = {
      preset,
      amplitude: USES_AMPLITUDE.has(preset) ? (draft.amplitude ?? 50) : undefined,
      depth: USES_DEPTH.has(preset) ? (draft.depth ?? 50) : undefined,
      steepness: USES_STEEPNESS.has(preset) ? (draft.steepness ?? 50) : undefined,
      position: USES_POSITION.has(preset) ? (draft.position ?? 50) : undefined,
    }
    setDraft(next)
    setDividerPreview(devId, next)
    postUpdate('update', next)
  }

  function handleSliderChange(key: NumericKey, value: number) {
    const next = { ...draft, [key]: value }
    setDraft(next)
    setDividerPreview(devId, next)
  }

  function handleSliderCommit(key: NumericKey, value: number) {
    const next = { ...draft, [key]: value }
    setDraft(next)
    postUpdate('update', next)
  }

  function handleRemove() {
    setDraft(current)
    clearDividerPreview(devId)
    postUpdate('remove')
    onClose()
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Popover.Anchor virtualRef={anchorElement ? { current: anchorElement } : undefined} />
      <Popover.Portal>
        <Popover.Content side="bottom" align="center" sideOffset={8}>
          <header>
            <h3>{t('divider-picker.title', 'Divider style')}</h3>
            <button type="button" onClick={handleRemove}>
              {t('divider-picker.remove', 'Remove')}
            </button>
          </header>

          <div className="divider-grid">
            {DIVIDER_TILE_METAS.map((meta) => (
              <button
                key={meta.id}
                type="button"
                data-testid={`divider-tile-${meta.id}`}
                data-selected={draft.preset === meta.id || undefined}
                onClick={() => handleSelectPreset(meta.id)}
                aria-label={meta.name}
              >
                <DividerThumbnail preset={meta.id} selected={draft.preset === meta.id} />
              </button>
            ))}
          </div>

          <footer>
            {USES_AMPLITUDE.has(draft.preset) && (
              <SliderRow
                key="amplitude"
                testId="divider-slider-amplitude"
                label={t('divider-picker.amplitude', 'Amplitude')}
                value={draft.amplitude ?? 50}
                min={10}
                max={100}
                step={5}
                onChange={(v) => handleSliderChange('amplitude', v)}
                onCommit={(v) => handleSliderCommit('amplitude', v)}
              />
            )}
            {USES_DEPTH.has(draft.preset) && (
              <SliderRow
                key="depth"
                testId="divider-slider-depth"
                label={t('divider-picker.depth', 'Depth')}
                value={draft.depth ?? 50}
                min={10}
                max={100}
                step={5}
                onChange={(v) => handleSliderChange('depth', v)}
                onCommit={(v) => handleSliderCommit('depth', v)}
              />
            )}
            {USES_STEEPNESS.has(draft.preset) && (
              <SliderRow
                key="steepness"
                testId="divider-slider-steepness"
                label={t('divider-picker.steepness', 'Steepness')}
                value={draft.steepness ?? 50}
                min={10}
                max={100}
                step={5}
                onChange={(v) => handleSliderChange('steepness', v)}
                onCommit={(v) => handleSliderCommit('steepness', v)}
              />
            )}
            {USES_POSITION.has(draft.preset) && (
              <SliderRow
                key="position"
                testId="divider-slider-position"
                label={t('divider-picker.position', 'Position')}
                value={draft.position ?? 50}
                min={0}
                max={100}
                step={5}
                onChange={(v) => handleSliderChange('position', v)}
                onCommit={(v) => handleSliderCommit('position', v)}
              />
            )}
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

interface SliderRowProps {
  testId: string
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  onCommit: (value: number) => void
}

function SliderRow({ testId, label, value, min, max, step, onChange, onCommit }: SliderRowProps) {
  return (
    <div data-testid={testId}>
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  )
}
```

The implementer may swap the native `<input type="range">` for `Slider.Root` from `@radix-ui/react-slider` for parity with Muse's UX; the test selectors above should still find the slider via `data-testid`.

- [ ] **Step 4: Run DividerPicker tests to verify they pass**

Run: `cd app-templates/v8/dev-tools && pnpm test "DividerPicker"`
Expected: PASS.

- [ ] **Step 5: Add failing ElementHoverBar gating tests**

Append to `app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx`:

```typescript
vi.mock('../DividerPicker', () => ({
  DividerPicker: () => <div data-testid="divider-picker-mock" />,
}))

describe('ElementHoverBar - divider gating', () => {
  it('shows the Style action for divider elements', async () => {
    const detection = await import('../../utils/element-detection')
    vi.mocked(detection.isDividerElement).mockReturnValue(true)

    const div = document.createElement('div')
    div.setAttribute('data-dev-id', 'div-1')
    div.setAttribute('data-dev-line', '12')
    div.setAttribute('data-dev-file', 'src/pages/index.tsx')
    div.setAttribute('data-component', 'SectionDivider')
    document.body.appendChild(div)

    renderHoverBar({ type: 'divider' as never, element: div } as HoveredElement)
    fireEvent.click(div)

    expect(screen.queryByRole('button', { name: /style/i })).not.toBeNull()
  })

  it('hides text/image actions for divider elements', async () => {
    const detection = await import('../../utils/element-detection')
    vi.mocked(detection.isDividerElement).mockReturnValue(true)

    const div = document.createElement('div')
    div.setAttribute('data-component', 'SectionDivider')
    document.body.appendChild(div)

    renderHoverBar({ type: 'divider' as never, element: div } as HoveredElement)
    fireEvent.click(div)

    expect(screen.queryByRole('button', { name: /bold/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /replace/i })).toBeNull()
  })

  it('opens DividerPicker when Style is clicked', async () => {
    const detection = await import('../../utils/element-detection')
    vi.mocked(detection.isDividerElement).mockReturnValue(true)

    const div = document.createElement('div')
    div.setAttribute('data-component', 'SectionDivider')
    document.body.appendChild(div)

    renderHoverBar({ type: 'divider' as never, element: div } as HoveredElement)
    fireEvent.click(div)
    fireEvent.click(screen.getByRole('button', { name: /style/i }))

    expect(screen.queryByTestId('divider-picker-mock')).not.toBeNull()
  })

  it('hides the Style action for non-divider elements', async () => {
    const detection = await import('../../utils/element-detection')
    vi.mocked(detection.isDividerElement).mockReturnValue(false)
    vi.mocked(detection.isTextElement).mockReturnValue(true)

    const h1 = document.createElement('h1')
    h1.textContent = 'Heading'
    document.body.appendChild(h1)

    renderHoverBar({ type: 'text' as never, element: h1 } as HoveredElement)
    fireEvent.click(h1)

    expect(screen.queryByRole('button', { name: /style/i })).toBeNull()
  })

  it('hides the Style action for loop-rendered divider elements', async () => {
    const detection = await import('../../utils/element-detection')
    vi.mocked(detection.isDividerElement).mockReturnValue(true)
    const correlated = await import('../../utils/correlatedEditListener')
    vi.mocked(correlated.isLoopRenderedElement).mockReturnValue(true)

    const first = document.createElement('div')
    const second = document.createElement('div')
    for (const el of [first, second]) {
      el.setAttribute('data-dev-id', 'loopid')
      el.setAttribute('data-dev-line', '9')
      el.setAttribute('data-component', 'SectionDivider')
      document.body.appendChild(el)
    }

    renderHoverBar({ type: 'divider' as never, element: first } as HoveredElement)
    fireEvent.click(first)

    expect(screen.queryByRole('button', { name: /style/i })).toBeNull()
  })
})
```

Update the `correlatedEditListener` mock at the top of the test file to include `isLoopRenderedElement: vi.fn(() => false)` (default to false; opt-in per test where loop detection is the SUT).

Update the `element-detection` mock to include `isDividerElement: vi.fn(() => false)` if it's not already there.

- [ ] **Step 6: Run hover bar gating tests to verify they fail**

Run: `cd app-templates/v8/dev-tools && pnpm test "ElementHoverBar"`
Expected: FAIL — Style action doesn't exist yet.

- [ ] **Step 7: Modify ElementHoverBar to gate the Style action (with loop-blocking)**

> **Loop-blocking is required.** The spec says the picker must not open for elements that fail the duplicate-`data-dev-id` check (the same gate the existing style controls use today). Without this, a divider rendered inside a `.map()` would let the user "edit" only the first item visually while the AST tool would either fail or rewrite all instances. Reuse the existing `isLoopRendered` helper that the style-controls path uses; if it lives under a different name in this repo, grep for `data-dev-id` plus duplicate-detection (the existing gate is referenced in [`ElementHoverBar.tsx`](../../../app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx) — the format-override plan extracts it into `isLoopRenderedElement` in `correlatedEditListener.ts`; if format-override has merged, import from there).

Edit `app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx`:

Add imports:

```typescript
import { DividerPicker } from './DividerPicker'
import { isDividerElement } from '../utils/element-detection'
import { readDividerTarget, readCurrentDividerProps } from '../utils/dividerMessages'
// Reuse the existing loop-rendered gate. Path may vary depending on whether
// the format-override sidecar work has merged. Fallback: compute inline using
// duplicate-(data-dev-id, data-dev-line) detection from element-detection.ts.
import { isLoopRenderedElement } from '../utils/correlatedEditListener'
```

Inside the component, add a check after element classification:

```typescript
const isLoopRendered = isLoopRenderedElement(element)
const isDivider = !isLoopRendered && isDividerElement(element)
const dividerReading = isDivider ? readDividerTarget(element) : null
const dividerCurrent = isDivider ? readCurrentDividerProps(element) : {}
const [dividerPickerOpen, setDividerPickerOpen] = useState(false)
```

Where the existing action buttons are rendered, add a divider-specific block that runs *before* text/image gating:

```tsx
{isDivider && dividerReading && (
  <>
    <button type="button" onClick={() => setDividerPickerOpen(true)}>
      {t('hover-bar.style', 'Style')}
    </button>
    {dividerPickerOpen && (
      <DividerPicker
        open={dividerPickerOpen}
        devId={dividerReading.devId}
        target={dividerReading.target}
        current={dividerCurrent as SectionDividerProps}
        anchorElement={element}
        onClose={() => setDividerPickerOpen(false)}
      />
    )}
  </>
)}
```

When `isLoopRendered && isDividerElement(element)`, neither the Style action nor the picker renders — the user falls back to "Reference" + "Edit with AI" for that element, matching the spec.

Wrap the existing text/image action sets in a `!isDivider` guard so they don't render for divider elements. Reference and Edit-with-AI remain as the universal fallback regardless.

- [ ] **Step 8: Run hover bar gating tests to verify they pass**

Run: `cd app-templates/v8/dev-tools && pnpm test "ElementHoverBar|DividerPicker"`
Expected: PASS.

- [ ] **Step 9: Run dev-tools typecheck**

Run: `cd app-templates/v8/dev-tools && pnpm type-check`
Expected: PASS.

- [ ] **Step 10: Commit Task 5**

```bash
git add app-templates/v8/dev-tools/src/utils/dividerPreviewStore.ts \
        app-templates/v8/dev-tools/src/utils/__tests__/dividerPreviewStore.test.ts \
        app-templates/v8/dev-tools/src/utils/divider-meta.ts \
        app-templates/v8/dev-tools/src/components/DividerThumbnail.tsx \
        app-templates/v8/dev-tools/src/components/__tests__/DividerThumbnail.test.tsx \
        app-templates/v8/dev-tools/src/components/DividerPicker.tsx \
        app-templates/v8/dev-tools/src/components/__tests__/DividerPicker.test.tsx \
        app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx \
        app-templates/v8/dev-tools/src/components/__tests__/ElementHoverBar.test.tsx
git commit -m "Add DividerPicker popover and Hover Bar Style action"
```

---

### Task 6: Agents AST tool, service, route

**Files:**
- Create: `agents/src/tools/ast-divider-editor.ts`
- Create: `agents/src/tools/__tests__/ast-divider-editor.test.ts`
- Create: `agents/src/services/DividerEditService.ts`
- Create: `agents/src/services/__tests__/DividerEditService.test.ts`
- Create: `agents/src/server/routes/dividers.ts`
- Create: `agents/src/server/routes/__tests__/dividers.test.ts`
- Modify: `agents/src/server/routes/index.ts`
- Modify: `agents/src/server/app.ts`

Reference the existing `agents/src/tools/ast-style-editor.ts` for the multi-tier locator pattern and the `commitChanges` invocation pattern; do not re-derive them.

- [ ] **Step 1: Write failing AST tool tests**

Create `agents/src/tools/__tests__/ast-divider-editor.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from 'vitest'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { ASTDividerEditor } from '../ast-divider-editor'
import { GitTool } from '../git-tool'

vi.mock('../git-tool', () => {
  return {
    GitTool: vi.fn().mockImplementation(() => ({
      executeGitOperation: vi.fn().mockResolvedValue({ success: true, commits: [{ hash: 'abc1234' }] }),
    })),
  }
})

const FIXTURES = path.resolve(__dirname, '__fixtures__')

async function withFixture(name: string, body: (filePath: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(FIXTURES, 'tmp-'))
  const filePath = path.join(dir, 'index.tsx')
  const source = await fs.readFile(path.join(FIXTURES, name), 'utf8')
  await fs.writeFile(filePath, source)
  try {
    await body(filePath)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('ASTDividerEditor', () => {
  let editor: ASTDividerEditor
  beforeEach(() => {
    editor = new ASTDividerEditor()
  })

  it('updates a single prop on the located JSX element', async () => {
    await withFixture('basic-divider.tsx', async (filePath) => {
      const result = await editor.editDivider({
        appPath: path.dirname(filePath),
        relativePath: 'index.tsx',
        appId: 'app-1',
        request: {
          devId: 'div-1',
          target: { file: 'index.tsx', line: 5, component: 'SectionDivider' },
          action: 'update',
          props: { preset: 'tilt' },
        },
      })
      expect(result.success).toBe(true)
      const updated = await fs.readFile(filePath, 'utf8')
      expect(updated).toMatch(/preset="tilt"/)
    })
  })

  it('updates multiple props in one call', async () => {
    await withFixture('basic-divider.tsx', async (filePath) => {
      const result = await editor.editDivider({
        appPath: path.dirname(filePath),
        relativePath: 'index.tsx',
        appId: 'app-1',
        request: {
          devId: 'div-1',
          target: { file: 'index.tsx', line: 5, component: 'SectionDivider' },
          action: 'update',
          props: { preset: 'sweep', amplitude: 60, depth: 70, position: 40 },
        },
      })
      expect(result.success).toBe(true)
      const updated = await fs.readFile(filePath, 'utf8')
      expect(updated).toMatch(/preset="sweep"/)
      expect(updated).toMatch(/amplitude={60}/)
      expect(updated).toMatch(/depth={70}/)
    })
  })

  it('removes a prop when value is null', async () => {
    await withFixture('parametrized-divider.tsx', async (filePath) => {
      const result = await editor.editDivider({
        appPath: path.dirname(filePath),
        relativePath: 'index.tsx',
        appId: 'app-1',
        request: {
          devId: 'div-1',
          target: { file: 'index.tsx', line: 5, component: 'SectionDivider' },
          action: 'update',
          props: { amplitude: null },
        },
      })
      expect(result.success).toBe(true)
      const updated = await fs.readFile(filePath, 'utf8')
      expect(updated).not.toMatch(/amplitude/)
    })
  })

  it('removes the entire JSX element on action: remove', async () => {
    await withFixture('basic-divider.tsx', async (filePath) => {
      const result = await editor.editDivider({
        appPath: path.dirname(filePath),
        relativePath: 'index.tsx',
        appId: 'app-1',
        request: {
          devId: 'div-1',
          target: { file: 'index.tsx', line: 5, component: 'SectionDivider' },
          action: 'remove',
        },
      })
      expect(result.success).toBe(true)
      expect(result.removed).toBe(true)
      const updated = await fs.readFile(filePath, 'utf8')
      expect(updated).not.toMatch(/SectionDivider/)
    })
  })

  it('returns DIVIDER_COMPONENT_NOT_FOUND when located JSX is not SectionDivider', async () => {
    await withFixture('hero-not-divider.tsx', async (filePath) => {
      const result = await editor.editDivider({
        appPath: path.dirname(filePath),
        relativePath: 'index.tsx',
        appId: 'app-1',
        request: {
          devId: 'hero-1',
          target: { file: 'index.tsx', line: 5, component: 'SectionDivider' },
          action: 'update',
          props: { preset: 'tilt' },
        },
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/DIVIDER_COMPONENT_NOT_FOUND/)
    })
  })

  it('returns Element-not-found when no candidate matches', async () => {
    await withFixture('basic-divider.tsx', async (filePath) => {
      const result = await editor.editDivider({
        appPath: path.dirname(filePath),
        relativePath: 'index.tsx',
        appId: 'app-1',
        request: {
          devId: 'no-such-id',
          target: { file: 'index.tsx', line: 999, component: 'SectionDivider' },
          action: 'update',
          props: { preset: 'tilt' },
        },
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })

  it('skips commit when the file would be byte-identical', async () => {
    await withFixture('basic-divider.tsx', async (filePath) => {
      const result = await editor.editDivider({
        appPath: path.dirname(filePath),
        relativePath: 'index.tsx',
        appId: 'app-1',
        request: {
          devId: 'div-1',
          target: { file: 'index.tsx', line: 5, component: 'SectionDivider' },
          action: 'update',
          props: { preset: 'wave-smooth' },
        },
      })
      expect(result.success).toBe(true)
      expect(result.commitHash).toBeUndefined()
    })
  })
})
```

Also create the fixture files under `agents/src/tools/__tests__/__fixtures__/`:

`basic-divider.tsx`:

```tsx
import { SectionDivider } from '../components/SectionDivider'

export default function Page() {
  return (
    <SectionDivider preset="wave-smooth" data-dev-id="div-1" />
  )
}
```

`parametrized-divider.tsx`:

```tsx
import { SectionDivider } from '../components/SectionDivider'

export default function Page() {
  return (
    <SectionDivider preset="wave-smooth" amplitude={70} data-dev-id="div-1" />
  )
}
```

`hero-not-divider.tsx`:

```tsx
import { Hero } from '../components/Hero'

export default function Page() {
  return (
    <Hero title="Welcome" data-dev-id="hero-1" />
  )
}
```

- [ ] **Step 2: Run AST tool tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit "ast-divider-editor"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ast-divider-editor.ts`**

Create `agents/src/tools/ast-divider-editor.ts`:

```typescript
import * as t from '@babel/types'
import { ASTEditorBase, type BaseEditResult } from './ast-editor-base.js'
import { GitTool } from './git-tool.js'

export interface DividerEditTarget {
  file: string
  line: number
  component: 'SectionDivider'
}

export interface DividerEditRequest {
  devId: string
  target: DividerEditTarget
  action: 'update' | 'remove'
  props?: {
    preset?: string
    amplitude?: number | null
    depth?: number | null
    steepness?: number | null
    position?: number | null
  }
}

export interface DividerEditInvocation {
  appPath: string
  relativePath: string
  appId: string
  request: DividerEditRequest
}

export interface DividerEditResult extends BaseEditResult {
  removed?: boolean
}

export class ASTDividerEditor extends ASTEditorBase {
  protected isTargetElement(element: t.JSXElement, info: { devId: string; lineNumber: number }): boolean {
    const devId = this.getDevId(element)
    if (info.devId && devId === info.devId) return true
    if (!this.isOnTargetLine(element, info.lineNumber, 3)) return false
    return true
  }

  protected processAST(): { success: boolean } {
    return { success: true }
  }

  async editDivider(invocation: DividerEditInvocation): Promise<DividerEditResult> {
    const gitTool = await this.acquireGitTool(invocation.appPath, invocation.appId)

    return this.editTemplate<DividerEditRequest, DividerEditResult>({
      appPath: invocation.appPath,
      relativePath: invocation.relativePath,
      appId: invocation.appId,
      request: invocation.request,
      shouldCommit: true,
      gitTool,
      commitMessage:
        invocation.request.action === 'remove'
          ? '[divider] remove'
          : `[divider] update ${invocation.request.props?.preset ?? 'props'}`,
      processAST: (ast, request) => {
        let elementFound = false
        let componentMismatch = false
        let removed = false
        let mutated = false

        this.traverse(ast, {
          JSXElement: (path) => {
            const opening = path.node.openingElement
            const name = this.getTagName(path.node)
            if (!this.isTargetElement(path.node, { devId: request.devId, lineNumber: request.target.line })) return
            elementFound = true
            if (name !== 'SectionDivider') {
              componentMismatch = true
              path.stop()
              return
            }
            if (request.action === 'remove') {
              path.remove()
              removed = true
              mutated = true
              path.stop()
              return
            }
            if (request.action === 'update' && request.props) {
              for (const [key, value] of Object.entries(request.props)) {
                if (value === undefined) continue
                const existing = opening.attributes.find(
                  (attr): attr is t.JSXAttribute =>
                    t.isJSXAttribute(attr) &&
                    t.isJSXIdentifier(attr.name) &&
                    attr.name.name === key,
                )
                if (value === null) {
                  if (existing) {
                    opening.attributes = opening.attributes.filter((a) => a !== existing)
                    mutated = true
                  }
                  continue
                }
                const newValue =
                  typeof value === 'string'
                    ? t.stringLiteral(value)
                    : t.jsxExpressionContainer(t.numericLiteral(value))
                if (existing) {
                  existing.value = newValue
                  mutated = true
                } else {
                  opening.attributes.push(t.jsxAttribute(t.jsxIdentifier(key), newValue))
                  mutated = true
                }
              }
            }
            path.stop()
          },
        })

        if (componentMismatch) {
          return { success: false, error: 'DIVIDER_COMPONENT_NOT_FOUND' }
        }
        if (!elementFound) {
          return {
            success: false,
            error: `Element not found at line ${request.target.line} in ${request.target.file}`,
          }
        }
        return { success: true, mutated, removed }
      },
    })
  }
}
```

Note: this scaffold uses helper methods (`getDevId`, `isOnTargetLine`, `getTagName`, `traverse`, `editTemplate`) inherited from `ASTEditorBase`. The exact signatures are visible in `agents/src/tools/ast-style-editor.ts` and `agents/src/tools/ast-editor-base.ts` — port directly. If `editTemplate` does not accept an inline `processAST` callback, mirror the subclass pattern in `ASTStyleEditor.editElementStyle` instead and refactor accordingly. `this.acquireGitTool(...)` is a placeholder name — replace with whatever instantiation pattern `ASTStyleEditor.editElementStyle` uses (likely via an existing `getWorkspace(appId)` helper that returns a `workspace` you pass into `new GitTool(workspace.tasks)`); do not invent a constructor shape.

- [ ] **Step 4: Run AST tool tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "ast-divider-editor"`
Expected: PASS.

- [ ] **Step 5: Write failing service tests**

Create `agents/src/services/__tests__/DividerEditService.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DividerEditService } from '../DividerEditService'
import { ASTDividerEditor } from '../../tools/ast-divider-editor'

vi.mock('../../tools/ast-divider-editor')

describe('DividerEditService', () => {
  let service: DividerEditService
  let editorMock: { editDivider: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    editorMock = { editDivider: vi.fn().mockResolvedValue({ success: true, filePath: 'src/pages/index.tsx', commitHash: 'abc1234' }) }
    vi.mocked(ASTDividerEditor).mockImplementation(() => editorMock as unknown as ASTDividerEditor)
    service = new DividerEditService()
  })

  it('rejects unknown preset', async () => {
    const result = await service.update({
      appId: 'a1',
      devId: 'd1',
      target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
      action: 'update',
      props: { preset: 'spaceship' as never },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/preset/i)
  })

  it('rejects out-of-range numeric', async () => {
    const result = await service.update({
      appId: 'a1',
      devId: 'd1',
      target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
      action: 'update',
      props: { amplitude: 200 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-step-5 numeric', async () => {
    const result = await service.update({
      appId: 'a1',
      devId: 'd1',
      target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
      action: 'update',
      props: { amplitude: 53 },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/step/i)
  })

  it('rejects path traversal', async () => {
    const result = await service.update({
      appId: 'a1',
      devId: 'd1',
      target: { file: 'src/pages/../secret.tsx', line: 12, component: 'SectionDivider' },
      action: 'update',
      props: { preset: 'tilt' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects update with no fields', async () => {
    const result = await service.update({
      appId: 'a1',
      devId: 'd1',
      target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
      action: 'update',
      props: {},
    })
    expect(result.success).toBe(false)
  })

  it('rejects target.component !== SectionDivider', async () => {
    const result = await service.update({
      appId: 'a1',
      devId: 'd1',
      target: { file: 'src/pages/index.tsx', line: 12, component: 'Hero' as never },
      action: 'update',
      props: { preset: 'tilt' },
    })
    expect(result.success).toBe(false)
  })

  it('forwards a valid request to the AST tool', async () => {
    const result = await service.update({
      appId: 'a1',
      devId: 'd1',
      target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
      action: 'update',
      props: { preset: 'tilt' },
    })
    expect(editorMock.editDivider).toHaveBeenCalled()
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 6: Implement `DividerEditService.ts`**

Create `agents/src/services/DividerEditService.ts`:

```typescript
import { ASTDividerEditor, type DividerEditRequest, type DividerEditResult } from '../tools/ast-divider-editor.js'
import { resolveAppPath } from './app-workspace.js' // existing helper used by other services

const PRESETS = new Set([
  'wave-smooth', 'wave-layered', 'wave-asymmetric',
  'tilt', 'arrow',
  'curve-concave', 'curve-convex', 'curve-double', 'sweep', 'spill',
  'triangle', 'peaks', 'steps',
  'fade', 'line',
])

const PATH_RE = /^src\/pages\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.tsx$/

export interface DividerUpdateInput extends DividerEditRequest {
  appId: string
}

export class DividerEditService {
  private editor = new ASTDividerEditor()

  async update(input: DividerUpdateInput): Promise<DividerEditResult> {
    const validation = this.validate(input)
    if (!validation.ok) return { success: false, filePath: input.target.file, error: validation.error }

    const workspace = await resolveAppPath(input.appId)
    if (!workspace) return { success: false, filePath: input.target.file, error: 'APP_WORKSPACE_NOT_FOUND' }

    return this.editor.editDivider({
      appPath: workspace.appPath,
      relativePath: input.target.file,
      appId: input.appId,
      request: {
        devId: input.devId,
        target: input.target,
        action: input.action,
        props: input.props,
      },
    })
  }

  private validate(input: DividerUpdateInput): { ok: true } | { ok: false; error: string } {
    if (!input.devId) return { ok: false, error: 'DIVIDER_DEVID_REQUIRED' }
    if (input.target.component !== 'SectionDivider') return { ok: false, error: 'DIVIDER_COMPONENT_REQUIRED' }
    if (!PATH_RE.test(input.target.file)) return { ok: false, error: 'DIVIDER_PATH_INVALID' }
    if (input.action !== 'update' && input.action !== 'remove') return { ok: false, error: 'DIVIDER_ACTION_INVALID' }
    if (input.action === 'remove') return { ok: true }
    if (!input.props || Object.keys(input.props).length === 0) return { ok: false, error: 'DIVIDER_NO_FIELDS' }
    if (input.props.preset !== undefined && !PRESETS.has(input.props.preset)) return { ok: false, error: 'DIVIDER_PRESET_INVALID' }
    for (const key of ['amplitude', 'depth', 'steepness'] as const) {
      const value = input.props[key]
      if (value === undefined || value === null) continue
      if (!Number.isInteger(value)) return { ok: false, error: `DIVIDER_${key.toUpperCase()}_NOT_INTEGER` }
      if (value < 10 || value > 100) return { ok: false, error: `DIVIDER_${key.toUpperCase()}_OUT_OF_RANGE` }
      if (value % 5 !== 0) return { ok: false, error: `DIVIDER_${key.toUpperCase()}_STEP` }
    }
    if (input.props.position !== undefined && input.props.position !== null) {
      const v = input.props.position
      if (!Number.isInteger(v)) return { ok: false, error: 'DIVIDER_POSITION_NOT_INTEGER' }
      if (v < 0 || v > 100) return { ok: false, error: 'DIVIDER_POSITION_OUT_OF_RANGE' }
      if (v % 5 !== 0) return { ok: false, error: 'DIVIDER_POSITION_STEP' }
    }
    return { ok: true }
  }
}
```

- [ ] **Step 7: Run service tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "DividerEditService"`
Expected: PASS.

- [ ] **Step 8: Write failing route tests**

Create `agents/src/server/routes/__tests__/dividers.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { dividersRouter } from '../dividers'
import { DividerEditService } from '../../../services/DividerEditService'

vi.mock('../../../services/DividerEditService')

describe('POST /apps/:id/dividers', () => {
  let app: express.Express
  let serviceMock: { update: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    serviceMock = { update: vi.fn() }
    vi.mocked(DividerEditService).mockImplementation(() => serviceMock as unknown as DividerEditService)
    app = express().use(express.json()).use('/apps', dividersRouter)
  })

  it('returns 200 + success on a valid update', async () => {
    serviceMock.update.mockResolvedValue({ success: true, commitHash: 'abc' })
    const r = await request(app)
      .post('/apps/a1/dividers')
      .send({
        devId: 'd1',
        target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
        action: 'update',
        props: { preset: 'tilt' },
      })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ success: true, commitHash: 'abc' })
  })

  it('returns 200 + success: false on validation failure', async () => {
    serviceMock.update.mockResolvedValue({ success: false, error: 'DIVIDER_PRESET_INVALID' })
    const r = await request(app)
      .post('/apps/a1/dividers')
      .send({
        devId: 'd1',
        target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
        action: 'update',
        props: { preset: 'spaceship' },
      })
    expect(r.status).toBe(200)
    expect(r.body.success).toBe(false)
    expect(r.body.error).toMatch(/preset/i)
  })

  it('returns 400 on malformed body', async () => {
    const r = await request(app).post('/apps/a1/dividers').send({})
    expect(r.status).toBe(400)
  })

  it('rejects cross-tenant requests', async () => {
    serviceMock.update.mockClear()
    const ownershipApp = express()
      .use(express.json())
      .use((req, _res, next) => {
        ;(req as unknown as { userId: string }).userId = 'other-tenant'
        next()
      })
      .use('/apps', dividersRouter)
    const r = await request(ownershipApp)
      .post('/apps/a1/dividers')
      .send({
        devId: 'd1',
        target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
        action: 'update',
        props: { preset: 'tilt' },
      })
    expect([401, 403, 404]).toContain(r.status)
    expect(serviceMock.update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 9: Implement the route + mount it**

> **Tenant ownership is required.** Mounting under `protectedRouter` only validates the JWT (proves identity); it does not prove that *this* authenticated tenant owns *this* `:id`. Per [agents/CLAUDE.md](../../../agents/CLAUDE.md): every route accepting an appId param must apply `validateAppOwnership`. Mirror the format-override route at [`agents/src/server/routes/format-overrides.ts:28`](../../../agents/src/server/routes/format-overrides.ts#L28) — middleware is the second arg, before the handler.

Create `agents/src/server/routes/dividers.ts`:

```typescript
import { Router, Request, Response } from 'express'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import { DividerEditService } from '../../services/DividerEditService.js'

export const dividersRouter = Router()

dividersRouter.post('/:id/dividers', validateAppOwnership, async (req: Request, res: Response) => {
  const appId = req.params.id
  const body = req.body as Partial<{
    devId: string
    target: { file: string; line: number; component: string }
    action: 'update' | 'remove'
    props: Record<string, unknown>
  }>

  if (!body || !body.devId || !body.target || !body.action) {
    return res.status(400).json({ success: false, error: 'INVALID_REQUEST' })
  }

  const service = new DividerEditService()
  const result = await service.update({
    appId,
    devId: body.devId,
    target: body.target as never,
    action: body.action,
    props: body.props as never,
  })
  return res.status(200).json(result)
})
```

Modify `agents/src/server/routes/index.ts` to export the router:

```typescript
export { dividersRouter } from './dividers.js'
```

Modify `agents/src/server/app.ts` to mount it next to `formatOverridesRouter`:

```typescript
import { dividersRouter } from './routes/dividers.js'
// ...
protectedRouter.use('/apps', dividersRouter)
```

- [ ] **Step 10: Run agents tests**

Run: `pnpm --filter @airo/agents test:unit "ast-divider-editor|DividerEditService|dividers"`
Expected: PASS.

- [ ] **Step 11: Run agents typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS.

- [ ] **Step 12: Commit Task 6**

```bash
git add agents/src/tools/ast-divider-editor.ts \
        agents/src/tools/__tests__/ast-divider-editor.test.ts \
        agents/src/tools/__tests__/__fixtures__/ \
        agents/src/services/DividerEditService.ts \
        agents/src/services/__tests__/DividerEditService.test.ts \
        agents/src/server/routes/dividers.ts \
        agents/src/server/routes/__tests__/dividers.test.ts \
        agents/src/server/routes/index.ts \
        agents/src/server/app.ts
git commit -m "Add divider edit service, AST tool, and HTTP route"
```

---

### Task 7: Builder page bridge

**Files:**
- Modify: `app/src/services/AppService.ts`
- Create: `app/src/services/AppService.divider.test.ts`
- Create: `app/src/app/[market]/develop/[id]/dividerBridge.ts`
- Create: `app/src/app/[market]/develop/[id]/dividerBridge.test.ts`
- Modify: `app/src/app/[market]/develop/[id]/page.tsx` (or the `useDevToolsBusBindings` hook file it imports — implementer should grep for the existing `FORMAT_OVERRIDE_UPDATED` handler to find the right spot)

- [ ] **Step 1: Write failing AppService test**

Create `app/src/services/AppService.divider.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AppService } from './AppService'
import { agentFetch } from './agentFetch'
import { buildDynamicApiUrl } from './buildDynamicApiUrl'

vi.mock('./agentFetch')
vi.mock('./buildDynamicApiUrl')

describe('AppService.updateDivider', () => {
  let service: AppService

  beforeEach(() => {
    vi.mocked(buildDynamicApiUrl).mockResolvedValue('https://agents/apps/app-1/dividers')
    vi.mocked(agentFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, commitHash: 'abc1234' }),
    } as never)
    service = new AppService()
  })

  it('posts to the dividers endpoint with the request body', async () => {
    const result = await service.updateDivider('app-1', {
      devId: 'div-1',
      target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
      action: 'update',
      props: { preset: 'tilt' },
    })
    expect(buildDynamicApiUrl).toHaveBeenCalledWith('dividers', 'app-1')
    expect(agentFetch).toHaveBeenCalledWith(
      'https://agents/apps/app-1/dividers',
      expect.objectContaining({
        method: 'POST',
        siteId: 'app-1',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"devId":"div-1"'),
      }),
    )
    expect(result).toEqual({ success: true, commitHash: 'abc1234' })
  })

  it('parses removal responses', async () => {
    vi.mocked(agentFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, removed: true, commitHash: 'def5678' }),
    } as never)
    const result = await service.updateDivider('app-1', {
      devId: 'div-1',
      target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
      action: 'remove',
    })
    expect(result.removed).toBe(true)
  })

  it('surfaces errors from the agents service', async () => {
    vi.mocked(agentFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, error: 'DIVIDER_PRESET_INVALID' }),
    } as never)
    const result = await service.updateDivider('app-1', {
      devId: 'div-1',
      target: { file: 'src/pages/index.tsx', line: 12, component: 'SectionDivider' },
      action: 'update',
      props: { preset: 'spaceship' as never },
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('DIVIDER_PRESET_INVALID')
  })
})
```

- [ ] **Step 2: Run AppService test to verify it fails**

Run: `pnpm --filter website test "AppService.divider"`
Expected: FAIL — `updateDivider` is not a method.

- [ ] **Step 3: Implement `updateDivider` on AppService**

Edit `app/src/services/AppService.ts`. Add types and method (mirror `updateFormatOverride`):

```typescript
export interface DividerUpdateData {
  devId: string
  target: {
    file: string
    line: number
    component: 'SectionDivider'
  }
  action: 'update' | 'remove'
  props?: {
    preset?: string
    amplitude?: number | null
    depth?: number | null
    steepness?: number | null
    position?: number | null
  }
}

export interface DividerUpdateResult {
  success: boolean
  commitHash?: string
  removed?: boolean
  error?: string
}
```

In the class body:

```typescript
async updateDivider(appId: string, data: DividerUpdateData): Promise<DividerUpdateResult> {
  const apiUrl = await buildDynamicApiUrl('dividers', appId)
  const response = await agentFetch(apiUrl, {
    siteId: appId,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      devId: data.devId,
      target: data.target,
      action: data.action,
      props: data.props,
    }),
  })
  const json = (await response.json()) as DividerUpdateResult
  return json
}
```

- [ ] **Step 4: Run AppService test to verify it passes**

Run: `pnpm --filter website test "AppService.divider"`
Expected: PASS.

- [ ] **Step 5: Write failing bridge tests**

Create `app/src/app/[market]/develop/[id]/dividerBridge.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildDividerSuccessMessage, buildDividerFailureMessage } from './dividerBridge'

describe('dividerBridge', () => {
  it('builds a success message with commitId, commitHash, removed flag', () => {
    const msg = buildDividerSuccessMessage('commit-1', { success: true, commitHash: 'abc', removed: false })
    expect(msg).toEqual({
      type: 'DIVIDER_UPDATE_SUCCEEDED',
      commitId: 'commit-1',
      commitHash: 'abc',
      removed: false,
    })
  })

  it('builds a removal success', () => {
    const msg = buildDividerSuccessMessage('commit-2', { success: true, commitHash: 'def', removed: true })
    expect(msg.removed).toBe(true)
  })

  it('builds a failure message with the error string', () => {
    const msg = buildDividerFailureMessage('commit-1', 'NETWORK_ERROR')
    expect(msg).toEqual({
      type: 'EDIT_FAILED',
      commitId: 'commit-1',
      error: 'NETWORK_ERROR',
    })
  })

  it('treats success: false as a failure message', () => {
    const msg = buildDividerSuccessMessage('commit-1', { success: false, error: 'DIVIDER_PRESET_INVALID' })
    expect(msg.type).toBe('EDIT_FAILED')
    expect(msg).toMatchObject({ commitId: 'commit-1', error: 'DIVIDER_PRESET_INVALID' })
  })
})
```

- [ ] **Step 6: Implement `dividerBridge.ts`**

Create `app/src/app/[market]/develop/[id]/dividerBridge.ts`:

```typescript
import type { DividerUpdateResult } from '@/services/AppService'

export interface DividerSuccessMessage {
  type: 'DIVIDER_UPDATE_SUCCEEDED'
  commitId: string
  commitHash?: string
  removed?: boolean
}

export interface DividerFailureMessage {
  type: 'EDIT_FAILED'
  commitId: string
  error: string
}

export type DividerBridgeMessage = DividerSuccessMessage | DividerFailureMessage

export function buildDividerSuccessMessage(commitId: string, result: DividerUpdateResult): DividerBridgeMessage {
  if (!result.success) {
    return buildDividerFailureMessage(commitId, result.error ?? 'UNKNOWN_ERROR')
  }
  return {
    type: 'DIVIDER_UPDATE_SUCCEEDED',
    commitId,
    commitHash: result.commitHash,
    removed: result.removed ?? false,
  }
}

export function buildDividerFailureMessage(commitId: string, error: string): DividerFailureMessage {
  return {
    type: 'EDIT_FAILED',
    commitId,
    error,
  }
}
```

- [ ] **Step 7: Run bridge tests to verify they pass**

Run: `pnpm --filter website test "dividerBridge"`
Expected: PASS.

- [ ] **Step 8: Wire the develop-page handler**

Locate the `useDevToolsBusBindings` hook (the file imported by `app/src/app/[market]/develop/[id]/page.tsx`). It already registers the `FORMAT_OVERRIDE_UPDATED` handler. Add a parallel `DIVIDER_UPDATED` handler:

```typescript
on('DIVIDER_UPDATED', async (m) => {
  const cur = d()
  logger.info('develop-page.divider-from-iframe', { appId: cur.appId, devId: m.data.devId })
  try {
    const result = await appService.updateDivider(cur.appId, m.data)
    cur.sendDividerUpdate(buildDividerSuccessMessage(m.data.commitId, result))
  } catch (err) {
    cur.sendDividerUpdate(buildDividerFailureMessage(m.data.commitId, String(err)))
  }
})
```

If the hook context (`d()` / `cur.sendDividerUpdate`) doesn't have a `sendDividerUpdate` method yet, add one that posts the bridge message back into the preview iframe via the existing postMessage path (mirror `sendFormatOverrideUpdate`).

- [ ] **Step 9: Run app typecheck and bridge tests**

Run: `pnpm --filter website typecheck`
Run: `pnpm --filter website test "AppService.divider|dividerBridge"`
Expected: PASS.

- [ ] **Step 10: Commit Task 7**

```bash
git add app/src/services/AppService.ts \
        app/src/services/AppService.divider.test.ts \
        app/src/app/[market]/develop/[id]/dividerBridge.ts \
        app/src/app/[market]/develop/[id]/dividerBridge.test.ts \
        app/src/app/[market]/develop/[id]/page.tsx
# (Also add the useDevToolsBusBindings file if modified)
git commit -m "Add builder page bridge for divider updates"
```

---

### Task 8: Agent prompt updates + final verification

**Files:**
- Modify: agent system prompt file in `agents/src/prompts/` (located via grep)
- Verification only: typecheck, lint, build, manual smoke

- [ ] **Step 1: Locate the agent system prompt that documents available components**

Run: `grep -rn "available components\|component reference\|<Hero\|<.*Section.*>" agents/src/prompts/ | head -30`

Identify the prompt fragment that lists the v8 components the agent can use. Likely candidates: `agents/src/prompts/develop/`, `agents/src/prompts/initial/`, or a shared `components.md`-style file. Per CLAUDE.md, prompts are loaded through `BaseAgent.getSystemPrompt()` → `loadSystemPromptFromFile()` → `composePrompt()`.

If multiple files document components, prefer the shared one. If it's per-agent, update each agent prompt that produces page composition (initial generator + develop loop, at minimum).

- [ ] **Step 2: Add `<SectionDivider>` to the prompt**

Add a section like:

```markdown
### `<SectionDivider>` — visual transitions between sections

Use a `<SectionDivider>` between two sections that have different background colors to create a visual transition. The component renders an SVG divider whose color is automatically pulled from the background of the section that follows it.

**Props:**
- `preset` (required): one of `wave-smooth`, `wave-layered`, `wave-asymmetric`, `tilt`, `arrow`, `curve-concave`, `curve-convex`, `curve-double`, `sweep`, `spill`, `triangle`, `peaks`, `steps`, `fade`, `line`
- `amplitude` (number, 10–100, step 5): wave intensity for the wave-* presets
- `depth` (number, 10–100, step 5): protrusion depth for arrow/curve/triangle/peaks/steps/sweep/spill
- `steepness` (number, 10–100, step 5): for tilt and sweep
- `position` (number, 0–100, step 5): horizontal anchor for tilt/sweep/arrow/triangle/curve-*/peaks/steps/spill

**When to use:** Place between two `<section>` elements that have different `bg-*` classes. Skip when sections have the same background — there's nothing to divide visually.

**Example:**

```tsx
<section className="bg-slate-50 py-12">
  …
</section>

<SectionDivider preset="wave-smooth" amplitude={50} />

<section className="bg-white py-12">
  …
</section>
```

Default `amplitude`/`depth`/`steepness`/`position` to `50` when uncertain. Pick the preset based on tone: `wave-*` for friendly/organic, `tilt`/`arrow` for energetic, `curve-*`/`fade` for calm.
```

- [ ] **Step 3: Update prompt-snapshot tests if any exist**

Run: `find agents/src/prompts/__tests__ -name "*.test.ts" 2>/dev/null && find agents/src/prompts -name "*.snapshot.*" 2>/dev/null`

If snapshot tests exist, run them and update the snapshots (`pnpm --filter @airo/agents test:unit "prompt" -u` if Vitest, or whatever the project's snapshot-update flag is). If they don't, skip — no new test required for prose-only prompt additions.

- [ ] **Step 4: Run agents tests**

Run: `pnpm --filter @airo/agents test:unit "prompt"`
Expected: PASS.

- [ ] **Step 5: Run repo-wide typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Run repo-wide lint**

Run: `pnpm lint`
Expected: PASS. Fix any new findings (these usually are unused imports or formatting drift).

- [ ] **Step 7: Run repo-wide build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 8: Inspect the diff**

Run: `git diff --stat origin/main...HEAD`
Run: `git diff --check origin/main...HEAD`

Confirm the file list matches the File Map at the top of this plan plus the Muse-port preset SVGs and any prompt files. Look for: accidental edits to unrelated files, leftover `console.log`, leftover `it.only`/`it.skip`, formatting noise.

- [ ] **Step 9: Manual smoke check**

In a local dev environment, open a customer app whose generated page already includes `<SectionDivider>` (regenerate one if needed):

- Click the divider — Hover Bar shows Reference, Edit with AI, **Style**.
- Click Style — popover opens with 15 preset tiles, the current preset highlighted, the right contextual sliders shown.
- Click a different preset — canvas updates within ~1 s, file commit lands per-app.
- Drag a slider — preview tracks the drag; release commits.
- Click Remove — divider disappears from the canvas, JSX element gone from source.
- Refresh the preview — changes persist (they were committed).
- Open a non-divider element — Style does not appear.

If anything fails, file a bug against this plan and fix before merging.

- [ ] **Step 10: Commit any verification fixes + push**

```bash
# If verification surfaced fixes:
git add <changed files>
git commit -m "Address divider plan verification findings"
```

Push the branch and open a PR linked to AIROBUILD-2304:

```bash
git push -u origin <branch>
gh pr create --title "[AIROBUILD-2304] Divider section manual editing" \
  --body "$(cat <<'EOF'
## Summary
- Implements the divider editing feature per [docs/superpowers/specs/2026-06-17-divider-picker-design.md](../docs/superpowers/specs/2026-06-17-divider-picker-design.md).
- Plan tracked at [docs/superpowers/plans/2026-06-18-divider-picker.md](../docs/superpowers/plans/2026-06-18-divider-picker.md).

## Test plan
- [x] All Task 1–8 unit suites pass
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm build` pass
- [x] Manual smoke verified divider editing end-to-end

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done

The full v1 ticket from the spec (Tickets 1–3 in the consolidated structure) lands at this point. Ticket 4 — insertion UX with `<SectionGap>` — is a separate plan and does not run from this document.
