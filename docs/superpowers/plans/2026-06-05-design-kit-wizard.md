# Design Kit Wizard (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an agent-profile-gated, full-canvas 5-step interactive brand wizard (Understanding → Planning → Designing visuals → Building app → Finalizing) that lets the user refine the agent-assembled brand with live preview, then hands off to the develop agent.

**Architecture:** A cloned `design-kit` initial-agent prompt variant drives the flow and emits a `build_phase` event + persists `brand.wizard.step`. Parameter edits go through thin agents routes that reuse existing write functions (`updateCssColorPalette`, `updateCssFontVariables`, `memoryStore.set`, media-slot PUT) with live `postMessage` preview; generation stays on the agent. Memory is the single source of truth. Step 4 renders a standalone `public/brand-showcase.html` that consumes a memory-synced `public/brand-tokens.css`.

**Tech Stack:** TypeScript, `@airo/ai-lib` (`createTool`), Express (agents routes), Next.js App Router + Zustand (app BFF/UI), Socket.IO + SSE (`packages/ai-transport`), Vitest, Playwright, Vite (v8 template).

**Spec:** `docs/superpowers/specs/2026-06-05-design-kit-wizard-design.md`

**Branch:** `feat/design-kit-wizard` (already created off `origin/main`).

---

## Conventions used in every task

- **agents tests:** `pnpm --filter @airo/agents test:unit <path-or-pattern>` or `-t "test name"`.
- **app tests:** `pnpm --filter website test <pattern>` (add `@vitest-environment jsdom` docblock for React/DOM tests).
- **Commit** after each task with the message shown. Branch is already `feat/design-kit-wizard`.
- Memory keys are plain strings, scoped via `workspaceScopeFromAppId(appId, customerIdFromContext(context))`.
- Workspace file writes use `createForWorkspace(appId, 'preview').files.write({ path, content })` with **workspace-relative paths, no leading slash** (e.g. `'public/brand-tokens.css'`).

---

## Phase 1 — Shared types + brand-data extension

New memory keys: `brand.summary` = `{ text: string }`, `brand.imagery` = `{ keyword: string }`, `brand.wizard.step` = `{ step: 1|2|3|4|5 }`. The `GET /apps/:id/brand-data` route surfaces all three so the UI hydrates from one fetch.

### Task 1: Extend shared `BrandData` types

**Files:**
- Modify: `packages/shared/src/brand-data/types.ts`

- [ ] **Step 1: Add the new interfaces + fields**

In `packages/shared/src/brand-data/types.ts`, add these interfaces before the `BrandData` interface:

```typescript
export interface BrandDataSummary {
  text?: string;
}

export interface BrandDataImagery {
  /** A single descriptor phrase used as the stock-search key, e.g.
   * "Minimal neutral fashion lifestyle, airy whites, soft textures, quiet luxury". */
  keyword?: string;
}

export interface BrandDataWizard {
  /** Active wizard step, 1–5. */
  step?: 1 | 2 | 3 | 4 | 5;
}
```

Then add three optional fields to the existing `BrandData` interface (after `toneMatrix`):

```typescript
  summary?: BrandDataSummary;
  imagery?: BrandDataImagery;
  wizard?: BrandDataWizard;
```

- [ ] **Step 2: Typecheck the shared package**

Run: `pnpm --filter @airo/shared typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/brand-data/types.ts
git commit -m "feat(shared): add summary, imagery, wizard fields to BrandData"
```

### Task 2: Surface new keys from the brand-data route

**Files:**
- Modify: `agents/src/server/routes/brand-data.ts`
- Test: `agents/src/server/routes/__tests__/brand-data.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/extend `agents/src/server/routes/__tests__/brand-data.test.ts`. This test mounts the router with a mocked memory store and asserts the new fields are surfaced:

```typescript
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the memory store before importing the router
const memValues: Record<string, unknown> = {}
vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({
    get: async (_scope: unknown, key: string) =>
      key in memValues
        ? { success: true, exists: true, value: memValues[key] }
        : { success: true, exists: false },
  }),
}))
// Bypass ownership middleware (sets agentContext) for the test
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (req: any, _res: unknown, next: () => void) => {
    req.agentContext = { customerId: 'cust1', siteId: 'app1234567' }
    next()
  },
}))

import brandDataRouter from '../brand-data.js'

describe('GET /apps/:id/brand-data', () => {
  beforeEach(() => {
    for (const k of Object.keys(memValues)) delete memValues[k]
  })

  it('surfaces brand.summary, brand.imagery, and brand.wizard.step', async () => {
    memValues['brand.summary'] = { text: 'A calm, considered brand.' }
    memValues['brand.imagery'] = { keyword: 'minimal neutral, airy whites' }
    memValues['brand.wizard.step'] = { step: 3 }

    const app = express()
    app.use(brandDataRouter)
    const res = await request(app).get('/apps/app1234567/brand-data')

    expect(res.status).toBe(200)
    expect(res.body.summary).toEqual({ text: 'A calm, considered brand.' })
    expect(res.body.imagery).toEqual({ keyword: 'minimal neutral, airy whites' })
    expect(res.body.wizard).toEqual({ step: 3 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit brand-data`
Expected: FAIL — `res.body.summary` is `undefined`.

- [ ] **Step 3: Implement — read the new keys and add them to the response**

In `agents/src/server/routes/brand-data.ts`, add the three keys to the `Promise.all` read block:

```typescript
    const [
      paletteResult, typographyResult, identityResult,
      personalityResult, voiceResult, iconographyResult, layoutResult, audienceResult,
      summaryResult, imageryResult, wizardResult,
    ] = await Promise.all([
      memory.get(scope, 'brand.colors.palette'),
      memory.get(scope, 'brand.typography'),
      memory.get(scope, 'brand.identity'),
      memory.get(scope, 'design.brand-personality'),
      memory.get(scope, 'design.voice-messaging'),
      memory.get(scope, 'design.iconography'),
      memory.get(scope, 'design.layout'),
      memory.get(scope, 'design.audience'),
      memory.get(scope, 'brand.summary'),
      memory.get(scope, 'brand.imagery'),
      memory.get(scope, 'brand.wizard.step'),
    ]);
```

Then add the three fields to the assembled `brandData` object (after `toneMatrix`):

```typescript
      summary: summaryResult.exists ? summaryResult.value as BrandData['summary'] : undefined,
      imagery: imageryResult.exists ? imageryResult.value as BrandData['imagery'] : undefined,
      wizard: wizardResult.exists ? wizardResult.value as BrandData['wizard'] : undefined,
```

Add `summaryResult`, `imageryResult`, `wizardResult` to the `allResults` array used for failure logging, mirroring the existing entries.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit brand-data`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/routes/brand-data.ts agents/src/server/routes/__tests__/brand-data.test.ts
git commit -m "feat(agents): surface brand.summary/imagery/wizard.step from brand-data route"
```

---

## Phase 2 — `build_phase` event + `setWizardStep` tool + client handler

The agent advances the stepper by calling `setWizardStep`, which (a) persists `brand.wizard.step` and (b) pushes a `build_phase` event to the client for an instant stepper update. The client handler updates a Zustand store the wizard subscribes to.

### Task 3: Register the `build_phase` streaming event type

**Files:**
- Modify: `packages/ai-transport/src/interfaces.ts:324-349`

- [ ] **Step 1: Add the event type**

In `packages/ai-transport/src/interfaces.ts`, add `'build_phase'` to the `STREAMING_EVENT_TYPES` array (insert before `'request_grant_refresh'`):

```typescript
  'stream_retry',
  'video',
  'build_phase',
  'request_grant_refresh',
] as const
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @airo/ai-transport typecheck`
Expected: PASS — `StreamingEventType` now includes `'build_phase'`.

- [ ] **Step 3: Commit**

```bash
git add packages/ai-transport/src/interfaces.ts
git commit -m "feat(ai-transport): add build_phase streaming event type"
```

### Task 4: `setWizardStep` agent tool (persist + emit)

The emit mirrors `agents/src/tools/video-generation-tool.ts:319-334` exactly (WS via `emitToApp`, SSE via the SSE registry) so WS and SSE stay in sync. Reuse the same `emitToApp` import and SSE-registry accessor that `video-generation-tool.ts` uses.

**Files:**
- Create: `agents/src/tools/ai-lib-tools/set-wizard-step.ts`
- Modify: `agents/src/tools/ai-lib-tools/index.ts`
- Test: `agents/src/tools/ai-lib-tools/__tests__/set-wizard-step.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/tools/ai-lib-tools/__tests__/set-wizard-step.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const setMock = vi.fn(async () => ({ success: true }))
vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ set: setMock }),
}))
const emitMock = vi.fn()
vi.mock('../../../server/websocket/emit-to-app.js', () => ({ emitToApp: emitMock }))

import { setWizardStepAITool, StepSchema } from '../set-wizard-step.js'

// Tools built with createTool are invoked the same way brand-identity.test.ts does:
// the AI SDK passes { experimental_context: { metadata } } and createTool remaps it
// to the context.metadata the execute fn reads.
const createContext = (appId: string) => ({ experimental_context: { metadata: { appId, customerId: 'cust1' } } })

describe('setWizardStep tool', () => {
  beforeEach(() => { setMock.mockClear(); emitMock.mockClear() })

  it('persists brand.wizard.step and emits a build_phase event', async () => {
    const result = await setWizardStepAITool.execute({ step: 3 }, createContext('app1234567') as never)
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'app1234567' }),
      'brand.wizard.step',
      { step: 3 },
    )
    expect(emitMock).toHaveBeenCalledWith(
      'app1234567',
      'message',
      expect.objectContaining({ type: 'build_phase', data: expect.objectContaining({ step: 3, appId: 'app1234567' }) }),
    )
    expect(typeof result).toBe('string')
  })

  it('rejects an out-of-range step at the schema level', () => {
    expect(StepSchema.safeParse({ step: 9 }).success).toBe(false)
    expect(StepSchema.safeParse({ step: 3 }).success).toBe(true)
  })
})
```

> Notes: (1) confirm the exact `emitToApp` import path by opening `agents/src/tools/video-generation-tool.ts` and match it in both the tool and the `vi.mock` path. (2) confirm the `createContext`/`.execute(input, context)` invocation against `agents/src/tools/ai-lib-tools/__tests__/brand-identity.test.ts` and mirror it exactly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit set-wizard-step`
Expected: FAIL — module `../set-wizard-step.js` not found.

- [ ] **Step 3: Implement the tool**

Create `agents/src/tools/ai-lib-tools/set-wizard-step.ts`. Match the `emitToApp` import to `video-generation-tool.ts`; the SSE emit mirrors that tool's `emitVideoEvent` (call the SSE registry the same way it does — copy that exact pattern):

```typescript
import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { customerIdFromContext, workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { Logger } from '../../logging/index.js'
// Import emitToApp from the SAME path video-generation-tool.ts uses:
import { emitToApp } from '../../server/websocket/emit-to-app.js'

const logger = Logger.create({ component: 'set-wizard-step-tool' })
const memoryStore = getKvMemoryStore()
const MEMORY_KEY = 'brand.wizard.step'

export const StepSchema = z.object({
  step: z.number().int().min(1).max(5).describe(
    'Active design-kit wizard step: 1=Understanding, 2=Planning, 3=Designing visuals, 4=Building app, 5=Finalizing.',
  ),
})

export const setWizardStepAITool: Tool = createTool(
  'Advance the Design Kit Wizard to a step (1-5) and notify the UI. Call this at each phase transition: 1 when you start asking questions, 2 when you begin planning (kit/colors/fonts/keywords/logo), 3 when planning is complete and the user can edit, 4 when you start building the brand showcase, 5 when you hand off to develop.',
  StepSchema,
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined
    if (!appId) return '**Error:** No app ID available in context'

    const scope = workspaceScopeFromAppId(appId, customerIdFromContext(context))
    const value = { step: input.step }

    const writeResult = await memoryStore.set(scope, MEMORY_KEY, value)
    if (!writeResult.success) {
      logger.warn('setWizardStep.write.failed', { appId, error: writeResult.error ?? 'Unknown error' })
      return '**Error:** Failed to save wizard step. Please try again.'
    }

    try {
      emitToApp(appId, 'message', { type: 'build_phase', content: '', data: { step: input.step, appId } })
      // SSE parity: emit via the SSE registry exactly as video-generation-tool.ts does.
      // (sseRegistry.sendEvent(appId, 'build_phase', { step: input.step, appId }))
    } catch (error) {
      logger.warn('setWizardStep.emit.failed', { appId, error: error instanceof Error ? error.message : String(error) })
    }

    logger.info('setWizardStep.success', { appId, step: input.step })
    return `Wizard advanced to step ${input.step}.`
  },
)
```

- [ ] **Step 4: Register the tool**

In `agents/src/tools/ai-lib-tools/index.ts`: add an export (`export { setWizardStepAITool } from './set-wizard-step.js'`) and add to `allAILibTools`:

```typescript
  setWizardStep: setWizardStepAITool,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit set-wizard-step`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add agents/src/tools/ai-lib-tools/set-wizard-step.ts agents/src/tools/ai-lib-tools/index.ts agents/src/tools/ai-lib-tools/__tests__/set-wizard-step.test.ts
git commit -m "feat(agents): add setWizardStep tool (persist brand.wizard.step + emit build_phase)"
```

### Task 5: Client `build_phase` handler + wizard store

**Files:**
- Create: `app/src/stores/useWizardStore.ts`
- Create: `app/src/hooks/shared/buildPhaseNotification.ts`
- Create: `app/src/hooks/websocket/handlers/BuildPhaseHandler.ts`
- Modify: `app/src/services/websocket/TransportSupervisor.ts:402-428`
- Test: `app/src/hooks/websocket/handlers/__tests__/BuildPhaseHandler.test.ts`

- [ ] **Step 1: Create the wizard store**

Create `app/src/stores/useWizardStore.ts`:

```typescript
import { create } from 'zustand'

export type WizardStep = 1 | 2 | 3 | 4 | 5

interface WizardState {
  /** Per-app current step. Key = appId. */
  stepByApp: Record<string, WizardStep>
  setStep: (appId: string, step: WizardStep) => void
  getStep: (appId: string) => WizardStep | undefined
}

export const useWizardStore = create<WizardState>((set, get) => ({
  stepByApp: {},
  setStep: (appId, step) =>
    set((state) => ({ stepByApp: { ...state.stepByApp, [appId]: step } })),
  getStep: (appId) => get().stepByApp[appId],
}))
```

- [ ] **Step 2: Create the shared notification (WS + SSE parity)**

Create `app/src/hooks/shared/buildPhaseNotification.ts`:

```typescript
import { logger } from '@/lib/request-context'
import { useWizardStore, type WizardStep } from '@/stores/useWizardStore'

export function handleBuildPhaseNotification(params: {
  raw: Record<string, unknown>
  clientAppId: string
  logPrefix: string
}): void {
  const { raw, clientAppId, logPrefix } = params
  const eventAppId = typeof raw.appId === 'string' ? raw.appId : clientAppId
  if (eventAppId !== clientAppId) return // ignore events for other apps

  const step = Number(raw.step)
  if (!Number.isInteger(step) || step < 1 || step > 5) {
    logger.warn(`${logPrefix}.invalid_step`, { appId: clientAppId, step: raw.step })
    return
  }
  useWizardStore.getState().setStep(clientAppId, step as WizardStep)
}
```

- [ ] **Step 3: Write the failing handler test**

Create `app/src/hooks/websocket/handlers/__tests__/BuildPhaseHandler.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { BuildPhaseHandler } from '../BuildPhaseHandler'
import { useWizardStore } from '@/stores/useWizardStore'

describe('BuildPhaseHandler', () => {
  beforeEach(() => useWizardStore.setState({ stepByApp: {} }))

  it('updates the wizard store for the current app', async () => {
    const handler = new BuildPhaseHandler()
    await handler.handle(
      { data: { step: 2, appId: 'app1234567' } } as never,
      { currentAppId: 'app1234567', t: ((k: string) => k) as never, actions: {} as never } as never,
    )
    expect(useWizardStore.getState().getStep('app1234567')).toBe(2)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter website test BuildPhaseHandler`
Expected: FAIL — `../BuildPhaseHandler` not found.

- [ ] **Step 5: Implement the handler (mirrors `VideoHandler.ts`)**

Create `app/src/hooks/websocket/handlers/BuildPhaseHandler.ts`:

```typescript
/**
 * Handles build_phase events that advance the Design Kit Wizard stepper.
 * Delegates to the shared handleBuildPhaseNotification so WS and SSE produce
 * the same outcome (wizard store update).
 */
import { handleBuildPhaseNotification } from '@/hooks/shared/buildPhaseNotification'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class BuildPhaseHandler implements MessageHandler {
  readonly type = 'build_phase'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    handleBuildPhaseNotification({
      raw: (data.data ?? {}) as Record<string, unknown>,
      clientAppId: context.currentAppId,
      logPrefix: 'build_phase.websocket',
    })
  }
}
```

- [ ] **Step 6: Register the handler**

In `app/src/services/websocket/TransportSupervisor.ts`, import `BuildPhaseHandler` alongside the other handler imports and add inside `setupEventHandlers` (next to `registry.register(new VideoHandler())`):

```typescript
    registry.register(new BuildPhaseHandler())
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter website test BuildPhaseHandler`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/stores/useWizardStore.ts app/src/hooks/shared/buildPhaseNotification.ts app/src/hooks/websocket/handlers/BuildPhaseHandler.ts app/src/services/websocket/TransportSupervisor.ts app/src/hooks/websocket/handlers/__tests__/BuildPhaseHandler.test.ts
git commit -m "feat(app): handle build_phase event into wizard store"
```

> SSE parity: if the SSE transport uses a separate dispatch path from `TransportSupervisor`, register the same `build_phase`→`handleBuildPhaseNotification` mapping there too (grep for where `VideoHandler`/`handleVideoNotification` is wired on the SSE side and mirror it).

---

## Phase 3 — `brand-tokens.css` sync service

`public/brand-tokens.css` holds the `:root` CSS variables (HSL) + the Google-Fonts `@import`, assembled from memory (`brand.colors.palette` + `brand.typography`). The standalone showcase links it; `globals.css` is left untouched (the real site keeps its own `:root`). This is the single source for the showcase tokens and avoids any `@import` resolution risk in the Tailwind pipeline.

### Task 6: `syncBrandTokensCss` service

**Files:**
- Create: `agents/src/services/design-system/brand-tokens-css.ts`
- Test: `agents/src/services/design-system/__tests__/brand-tokens-css.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/services/design-system/__tests__/brand-tokens-css.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildBrandTokensCss } from '../brand-tokens-css.js'

describe('buildBrandTokensCss', () => {
  it('emits :root HSL color vars and a font @import', () => {
    const css = buildBrandTokensCss(
      { primary: '#3b5bdb', background: '#ffffff', foreground: '#111111' },
      { heading: { family: 'Oswald', weights: ['600', '700'] }, body: { family: 'Inter', weights: ['400'] } },
    )
    // Google Fonts import for both families
    expect(css).toContain("@import url('https://fonts.googleapis.com/css2?family=Oswald")
    expect(css).toContain('family=Inter')
    // HSL conversion (space-separated, no leading #)
    expect(css).toContain('--background: 0 0% 100%;')
    expect(css).toMatch(/--primary: \d+ \d+% \d+%;/)
    // Font vars reference the families
    expect(css).toContain('--font-heading: "Oswald"')
    expect(css).toContain('--font-sans: "Inter"')
  })

  it('omits color vars that are absent', () => {
    const css = buildBrandTokensCss({ primary: '#000000' }, {})
    expect(css).toContain('--primary:')
    expect(css).not.toContain('--secondary:')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit brand-tokens-css`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildBrandTokensCss` + `syncBrandTokensCss`**

Create `agents/src/services/design-system/brand-tokens-css.ts`. The `hexToHsl` is the exact algorithm used by the template's preview listener (`DevelopmentMode.tsx`), so the showcase matches the live preview:

```typescript
import type { WorkspaceFiles } from '../../workspace/files.js'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { buildGoogleFontsUrl } from '../../tools/ai-lib-tools/font-theme.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'brand-tokens-css' })

/** Convert "#rrggbb" to space-separated "H S% L%" (shadcn/globals.css format). */
function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '0 0% 0%'
  const r = parseInt(result[1]!, 16) / 255
  const g = parseInt(result[2]!, 16) / 255
  const b = parseInt(result[3]!, 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

// palette key (memory) -> CSS var name. Mirrors DevelopmentMode.applyThemePreview.
const COLOR_VAR_MAP: Array<[string, string]> = [
  ['background', '--background'], ['foreground', '--foreground'],
  ['card', '--card'], ['cardForeground', '--card-foreground'],
  ['primary', '--primary'], ['primaryForeground', '--primary-foreground'],
  ['secondary', '--secondary'], ['secondaryForeground', '--secondary-foreground'],
  ['muted', '--muted'], ['mutedForeground', '--muted-foreground'],
  ['accent', '--accent'], ['accentForeground', '--accent-foreground'],
  ['destructive', '--destructive'], ['destructiveForeground', '--destructive-foreground'],
  ['border', '--border'], ['border', '--input'], ['primary', '--ring'],
  ['chart1', '--chart-1'], ['chart2', '--chart-2'], ['chart3', '--chart-3'],
  ['chart4', '--chart-4'], ['chart5', '--chart-5'],
]

type PaletteLike = Record<string, unknown>
type TypographyLike = { heading?: { family?: string; weights?: string[] }; body?: { family?: string; weights?: string[] } }

export function buildBrandTokensCss(palette: PaletteLike | undefined, typography: TypographyLike | undefined): string {
  const lines: string[] = []

  // Font @import (top of file, before :root)
  const fonts: Array<{ name: string; weights: string[] }> = []
  if (typography?.heading?.family) fonts.push({ name: typography.heading.family, weights: typography.heading.weights ?? ['400', '700'] })
  if (typography?.body?.family) fonts.push({ name: typography.body.family, weights: typography.body.weights ?? ['400'] })
  if (fonts.length > 0) lines.push(`@import url('${buildGoogleFontsUrl(fonts)}');`, '')

  const rootLines: string[] = []
  if (palette) {
    for (const [paletteKey, cssVar] of COLOR_VAR_MAP) {
      const hex = palette[paletteKey]
      if (typeof hex === 'string' && /^#?[a-f\d]{6}$/i.test(hex)) {
        rootLines.push(`  ${cssVar}: ${hexToHsl(hex)};`)
      }
    }
  }
  if (typography?.heading?.family) {
    rootLines.push(`  --font-heading: "${typography.heading.family}", ui-sans-serif, system-ui, sans-serif;`)
  }
  if (typography?.body?.family) {
    rootLines.push(`  --font-sans: "${typography.body.family}", ui-sans-serif, system-ui, sans-serif;`)
  }

  lines.push(':root {', ...rootLines, '}', '')
  return lines.join('\n')
}

/** Read palette + typography from memory and write public/brand-tokens.css. */
export async function syncBrandTokensCss(
  appId: string,
  customerId: string | undefined,
  files: WorkspaceFiles,
): Promise<void> {
  const memory = getKvMemoryStore()
  const scope = workspaceScopeFromAppId(appId, customerId)
  const [paletteRes, typoRes] = await Promise.all([
    memory.get(scope, 'brand.colors.palette'),
    memory.get(scope, 'brand.typography'),
  ])
  const palette = paletteRes.exists ? (paletteRes.value as PaletteLike) : undefined
  const typography = typoRes.exists ? (typoRes.value as TypographyLike) : undefined
  const css = buildBrandTokensCss(palette, typography)
  try {
    await files.write({ path: 'public/brand-tokens.css', content: css })
  } catch (error) {
    logger.warn('brandTokensCss.write.failed', { appId, error: error instanceof Error ? error.message : String(error) })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit brand-tokens-css`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/services/design-system/brand-tokens-css.ts agents/src/services/design-system/__tests__/brand-tokens-css.test.ts
git commit -m "feat(agents): add brand-tokens.css sync service (memory -> public/brand-tokens.css)"
```

---

## Phase 4 — Direct-edit routes (agents) + BFF proxy (app)

Thin routes under `/apps/:id/design-kit/*` that reuse existing write functions so a Step-3 edit persists without an agent turn. Live preview is the UI's job (postMessage); these routes own persistence. The **Image & Video search and slot-pick reuse existing endpoints** (`/media/:appId/search` + `PUT /media/:appId/slots/:slotName`) — no new media route here.

### Task 7: design-kit router — colours, fonts, voice, summary, imagery, wizard-step

**Files:**
- Create: `agents/src/server/routes/design-kit.ts`
- Modify: `agents/src/server/routes/index.ts`
- Modify: `agents/src/server/app.ts` (mount the router)
- Test: `agents/src/server/routes/__tests__/design-kit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/server/routes/__tests__/design-kit.test.ts`. Mocks the memory store, the workspace, the CSS writers, and the token sync, then asserts each route persists + reuses the right function:

```typescript
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const setMock = vi.fn(async () => ({ success: true }))
const getMock = vi.fn(async () => ({ success: true, exists: false }))
vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ set: setMock, get: getMock }),
}))
const filesWrite = vi.fn(async () => ({ bytesWritten: 1 }))
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: () => ({ files: { write: filesWrite, view: vi.fn() } }),
}))
const updateCssColorPalette = vi.fn(async () => ({ success: true, palette: { primary: '#3b5bdb', background: '#ffffff' }, message: 'ok' }))
vi.mock('../../../tools/css-color-tool.js', () => ({ updateCssColorPalette }))
const updateCssFontVariables = vi.fn(async () => ({ success: true, message: 'ok' }))
vi.mock('../../../tools/ai-lib-tools/font-theme.js', () => ({ updateCssFontVariables, buildGoogleFontsUrl: () => 'https://fonts.googleapis.com/css2?family=Inter&display=swap' }))
const syncBrandTokensCss = vi.fn(async () => undefined)
vi.mock('../../../services/design-system/brand-tokens-css.js', () => ({ syncBrandTokensCss }))
const emitToApp = vi.fn()
vi.mock('../../websocket/emit-to-app.js', () => ({ emitToApp }))
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (req: any, _res: unknown, next: () => void) => {
    req.agentContext = { customerId: 'cust1', siteId: 'app1234567' }
    next()
  },
}))

import designKitRouter from '../design-kit.js'

function makeApp() { const app = express(); app.use(express.json()); app.use(designKitRouter); return app }

describe('design-kit direct-edit routes', () => {
  beforeEach(() => { setMock.mockClear(); filesWrite.mockClear(); updateCssColorPalette.mockClear(); updateCssFontVariables.mockClear(); syncBrandTokensCss.mockClear(); emitToApp.mockClear() })

  it('PUT colors applies the palette, persists memory, syncs tokens', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/colors')
      .send({ name: 'Indigo', palette: { primary: '#3b5bdb', background: '#ffffff' } })
    expect(res.status).toBe(200)
    expect(updateCssColorPalette).toHaveBeenCalled()
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.colors.palette', expect.objectContaining({ name: 'Indigo' }))
    expect(syncBrandTokensCss).toHaveBeenCalled()
  })

  it('PUT fonts applies fonts, persists typography, syncs tokens', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({ heading: { name: 'Oswald', weights: ['600'], category: 'sans-serif' }, body: { name: 'Inter', weights: ['400'], category: 'sans-serif' } })
    expect(res.status).toBe(200)
    expect(updateCssFontVariables).toHaveBeenCalled()
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.typography', expect.objectContaining({ heading: { family: 'Oswald', weights: ['600'] } }))
    expect(syncBrandTokensCss).toHaveBeenCalled()
  })

  it('PUT summary persists brand.summary', async () => {
    const res = await request(makeApp()).put('/apps/app1234567/design-kit/summary').send({ text: 'Hello' })
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.summary', { text: 'Hello' })
  })

  it('PUT imagery persists brand.imagery', async () => {
    const res = await request(makeApp()).put('/apps/app1234567/design-kit/imagery').send({ keyword: 'minimal neutral' })
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.imagery', { keyword: 'minimal neutral' })
  })

  it('PUT wizard-step persists and emits build_phase', async () => {
    const res = await request(makeApp()).put('/apps/app1234567/design-kit/wizard-step').send({ step: 3 })
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.wizard.step', { step: 3 })
    expect(emitToApp).toHaveBeenCalledWith('app1234567', 'message', expect.objectContaining({ type: 'build_phase' }))
  })

  it('PUT voice merges into brand.identity', async () => {
    getMock.mockResolvedValueOnce({ success: true, exists: true, value: { brandName: 'X' } })
    const res = await request(makeApp()).put('/apps/app1234567/design-kit/voice').send({ voice: { weAre: ['warm'] } })
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.anything(), 'brand.identity', expect.objectContaining({ brandName: 'X', voice: { weAre: ['warm'] } }))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit design-kit`
Expected: FAIL — `../design-kit.js` not found.

- [ ] **Step 3: Implement the router**

Create `agents/src/server/routes/design-kit.ts`:

```typescript
/**
 * Design Kit Wizard direct-edit routes.
 *
 * Thin endpoints that persist Step-3 parameter edits without an agent turn,
 * reusing the same write functions the agent tools use. Live preview is the
 * UI's responsibility (postMessage); these own persistence + token sync.
 */
import { Router, type Request, type Response } from 'express'
import { log } from '../../logging/index.js'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { createForWorkspace } from '../../workspace/index.js'
import { updateCssColorPalette } from '../../tools/css-color-tool.js'
import { updateCssFontVariables } from '../../tools/ai-lib-tools/font-theme.js'
import { syncBrandTokensCss } from '../../services/design-system/brand-tokens-css.js'
import { emitToApp } from '../websocket/emit-to-app.js' // match video-generation-tool.ts import

const router: Router = Router()
const memory = getKvMemoryStore()

function ctx(req: Request): { appId: string; customerId: string | undefined } {
  return { appId: req.params.id!, customerId: (req as AuthenticatedRequest).agentContext?.customerId }
}

// PUT /apps/:id/design-kit/colors  { name?, palette: { primary, background, ... } }
router.put('/apps/:id/design-kit/colors', validateAppOwnership, async (req: Request, res: Response) => {
  const { appId, customerId } = ctx(req)
  const logger = log.forApp(appId)
  try {
    const { name, palette } = req.body ?? {}
    if (!palette || typeof palette.primary !== 'string' || typeof palette.background !== 'string') {
      res.status(400).json({ error: 'palette.primary and palette.background are required' }); return
    }
    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) { res.status(404).json({ error: 'Workspace not available' }); return }
    const result = await updateCssColorPalette(workspace.files, palette)
    const stored = { name: typeof name === 'string' ? name : 'Custom', ...result.palette }
    await memory.set(workspaceScopeFromAppId(appId, customerId), 'brand.colors.palette', stored)
    await syncBrandTokensCss(appId, customerId, workspace.files)
    res.json({ success: true, palette: stored })
  } catch (error) {
    logger.error('designKit.colors.failed', { appId, error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to apply colors' })
  }
})

// PUT /apps/:id/design-kit/fonts  { heading: {name,weights,category}, body: {name,weights,category} }
router.put('/apps/:id/design-kit/fonts', validateAppOwnership, async (req: Request, res: Response) => {
  const { appId, customerId } = ctx(req)
  const logger = log.forApp(appId)
  try {
    const { heading, body } = req.body ?? {}
    if (!heading?.name || !body?.name) { res.status(400).json({ error: 'heading.name and body.name are required' }); return }
    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) { res.status(404).json({ error: 'Workspace not available' }); return }
    await updateCssFontVariables(workspace.files, heading, body)
    const typography = {
      heading: { family: heading.name, weights: heading.weights ?? ['400', '700'] },
      body: { family: body.name, weights: body.weights ?? ['400'] },
    }
    await memory.set(workspaceScopeFromAppId(appId, customerId), 'brand.typography', typography)
    await syncBrandTokensCss(appId, customerId, workspace.files)
    res.json({ success: true, typography })
  } catch (error) {
    logger.error('designKit.fonts.failed', { appId, error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to apply fonts' })
  }
})

// PUT /apps/:id/design-kit/voice  { voice: { weAre?, weAreNot?, sampleCopy? } }  (merges into brand.identity)
router.put('/apps/:id/design-kit/voice', validateAppOwnership, async (req: Request, res: Response) => {
  const { appId, customerId } = ctx(req)
  const logger = log.forApp(appId)
  try {
    const { voice } = req.body ?? {}
    if (!voice || typeof voice !== 'object') { res.status(400).json({ error: 'voice object required' }); return }
    const scope = workspaceScopeFromAppId(appId, customerId)
    const existing = await memory.get(scope, 'brand.identity')
    if (!existing.success) { res.status(500).json({ error: 'Failed to read brand identity' }); return }
    const current = (existing.exists && existing.value && typeof existing.value === 'object' ? existing.value : {}) as Record<string, unknown>
    await memory.set(scope, 'brand.identity', { ...current, voice })
    res.json({ success: true, voice })
  } catch (error) {
    logger.error('designKit.voice.failed', { appId, error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to save voice' })
  }
})

// PUT /apps/:id/design-kit/summary  { text }
router.put('/apps/:id/design-kit/summary', validateAppOwnership, async (req: Request, res: Response) => {
  const { appId, customerId } = ctx(req)
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : undefined
    if (text === undefined) { res.status(400).json({ error: 'text required' }); return }
    await memory.set(workspaceScopeFromAppId(appId, customerId), 'brand.summary', { text })
    res.json({ success: true, summary: { text } })
  } catch (error) {
    log.forApp(appId).error('designKit.summary.failed', { appId, error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to save summary' })
  }
})

// PUT /apps/:id/design-kit/imagery  { keyword }
router.put('/apps/:id/design-kit/imagery', validateAppOwnership, async (req: Request, res: Response) => {
  const { appId, customerId } = ctx(req)
  try {
    const keyword = typeof req.body?.keyword === 'string' ? req.body.keyword : undefined
    if (keyword === undefined) { res.status(400).json({ error: 'keyword required' }); return }
    await memory.set(workspaceScopeFromAppId(appId, customerId), 'brand.imagery', { keyword })
    res.json({ success: true, imagery: { keyword } })
  } catch (error) {
    log.forApp(appId).error('designKit.imagery.failed', { appId, error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to save imagery keyword' })
  }
})

// PUT /apps/:id/design-kit/wizard-step  { step }  (user jumping back to step 3, etc.)
router.put('/apps/:id/design-kit/wizard-step', validateAppOwnership, async (req: Request, res: Response) => {
  const { appId, customerId } = ctx(req)
  try {
    const step = Number(req.body?.step)
    if (!Number.isInteger(step) || step < 1 || step > 5) { res.status(400).json({ error: 'step must be 1-5' }); return }
    await memory.set(workspaceScopeFromAppId(appId, customerId), 'brand.wizard.step', { step })
    try { emitToApp(appId, 'message', { type: 'build_phase', content: '', data: { step, appId } }) } catch { /* non-fatal */ }
    res.json({ success: true, wizard: { step } })
  } catch (error) {
    log.forApp(appId).error('designKit.wizardStep.failed', { appId, error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to set wizard step' })
  }
})

export default router
```

- [ ] **Step 4: Register the router**

In `agents/src/server/routes/index.ts` add: `export { default as designKitRouter } from './design-kit.js'`.

In `agents/src/server/app.ts`, import `designKitRouter` with the other route imports and mount it next to `brandDataRouter`:

```typescript
protectedRouter.use('/', designKitRouter);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit design-kit`
Expected: PASS (all six cases).

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/routes/design-kit.ts agents/src/server/routes/index.ts agents/src/server/app.ts agents/src/server/routes/__tests__/design-kit.test.ts
git commit -m "feat(agents): add design-kit direct-edit routes (colors/fonts/voice/summary/imagery/wizard-step)"
```

### Task 8: App BFF proxy for design-kit routes

A single dynamic proxy forwards `PUT /api/design-kit/:appId/:action` to `${agent_url}/apps/:appId/design-kit/:action`, mirroring `app/src/app/api/database/[appId]/tables/route.ts`.

**Files:**
- Create: `app/src/app/api/design-kit/[appId]/[action]/route.ts`
- Test: `app/src/app/api/design-kit/[appId]/[action]/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/app/api/design-kit/[appId]/[action]/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => handler,
  customerHasAccount: () => true,
  createCustomerAuthError: (msg: string, status: number) => new Response(msg, { status }),
}))
const getSite = vi.fn(async () => ({ agent_url: 'https://agent.example', id: 'app1234567' }))
vi.mock('@/lib/control-plane', () => ({ getControlPlaneAdapter: () => ({ getSite }) }))
const agentFetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
vi.mock('@/lib/agent-fetch', () => ({ agentFetch }))
vi.mock('@/lib/request-context', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))

import { PUT } from '../route'

describe('design-kit BFF proxy', () => {
  it('forwards PUT to the agent design-kit route', async () => {
    const req = new Request('https://app/api/design-kit/app1234567/colors', {
      method: 'PUT', body: JSON.stringify({ palette: { primary: '#000', background: '#fff' } }),
    })
    const res = await PUT(req as never, { user: {}, jwt: 'jwt' } as never, { params: Promise.resolve({ appId: 'app1234567', action: 'colors' }) } as never)
    expect(res.status).toBe(200)
    expect(agentFetch).toHaveBeenCalledWith(
      'https://agent.example/apps/app1234567/design-kit/colors',
      expect.objectContaining({ siteId: 'app1234567', method: 'PUT' }),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test design-kit`
Expected: FAIL — `../route` not found.

- [ ] **Step 3: Implement the proxy**

Create `app/src/app/api/design-kit/[appId]/[action]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { agentFetch } from '@/lib/agent-fetch'
import { getControlPlaneAdapter } from '@/lib/control-plane'
import { type CustomerAuthContext, customerHasAccount, createCustomerAuthError, withCustomerAuth } from '@/lib/customer-auth'
import { logger } from '@/lib/request-context'

const ALLOWED_ACTIONS = new Set(['colors', 'fonts', 'voice', 'summary', 'imagery', 'wizard-step'])

async function proxy(
  request: NextRequest,
  authContext: CustomerAuthContext,
  params: Promise<{ appId: string; action: string }>,
  method: 'PUT',
): Promise<NextResponse> {
  const { user } = authContext
  const { appId, action } = await params
  if (!customerHasAccount(user)) return createCustomerAuthError('Account required', 403) as unknown as NextResponse
  if (!appId || !ALLOWED_ACTIONS.has(action)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (!authContext.jwt) return NextResponse.json({ error: 'Authentication token required' }, { status: 401 })

  const site = await getControlPlaneAdapter().getSite(appId, authContext.jwt)
  if (!site?.agent_url) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const body = await request.text()
  const response = await agentFetch(`${site.agent_url}/apps/${appId}/design-kit/${action}`, {
    siteId: appId, method, body,
  })
  if (!response.ok) {
    logger.error('design-kit.proxy.error', { appId, action, status: response.status })
    return NextResponse.json({ error: 'Design kit update failed', status: response.status }, { status: response.status })
  }
  return NextResponse.json(await response.json())
}

export const PUT = withCustomerAuth(
  (request: NextRequest, authContext: CustomerAuthContext, ctx: { params: Promise<{ appId: string; action: string }> }) =>
    proxy(request, authContext, ctx.params, 'PUT'),
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter website test design-kit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/design-kit
git commit -m "feat(app): add BFF proxy for design-kit direct-edit routes"
```

---

## Phase 5 — Agent profile + `design-kit` prompt variant + showcase guidance

The new profile clones the design-system flow into a `design-kit` variant that auto-advances 1→2→3, pauses, generates one square logo, writes summary/imagery/voice to memory, calls `setWizardStep` at each transition, and on the user's gates builds `public/brand-showcase.html` (Step 4) then hands off (Step 5).

### Task 9: Profile JSON + registration

**Files:**
- Create: `agents/src/profiles/initial-agent-design-kit.json`
- Modify: `agents/src/profiles/index.ts`
- Test: `agents/src/profiles/__tests__/design-kit-profile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/profiles/__tests__/design-kit-profile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getProfileRegistry } from '../index.js'

describe('initial-agent-design-kit profile', () => {
  it('is registered and maps to the design-kit prompt version', () => {
    const profile = getProfileRegistry().get('initial-agent-design-kit')
    expect(profile).toBeDefined()
    expect(profile?.properties['initial.promptVersion']).toBe('design-kit')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit design-kit-profile`
Expected: FAIL — profile is `undefined`.

- [ ] **Step 3: Create the profile + register it**

Create `agents/src/profiles/initial-agent-design-kit.json`:

```json
{
  "name": "initial-agent-design-kit",
  "description": "Initial agent variant: Design Kit Wizard. Questions the user, plans the kit/colours/fonts/keywords/logo, then pauses for interactive editing before building the brand showcase and handing off to develop.",
  "properties": {
    "initial.promptVersion": "design-kit"
  }
}
```

In `agents/src/profiles/index.ts`: add the import near the other profile imports and add it to `rawProfiles`:

```typescript
import initialAgentDesignKitProfile from './initial-agent-design-kit.json' with { type: 'json' }
```
```typescript
  initialAgentDesignSystemHomepageBuildProfile,
  initialAgentDesignKitProfile,
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit design-kit-profile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/src/profiles/initial-agent-design-kit.json agents/src/profiles/index.ts agents/src/profiles/__tests__/design-kit-profile.test.ts
git commit -m "feat(agents): register initial-agent-design-kit profile"
```

### Task 10: `design-kit` prompt variant

**Files:**
- Create: `agents/src/prompts/initial/design-kit/manifest.json`
- Copy: `agents/src/prompts/initial/design-system/questioning-phase1.md` → `agents/src/prompts/initial/design-kit/questioning-phase1.md` (verbatim)
- Create: `agents/src/prompts/initial/design-kit/wizard-flow.md`
- Create: `agents/src/prompts/initial/design-kit/brand-showcase.md`

- [ ] **Step 1: Copy the questioning file verbatim**

```bash
mkdir -p agents/src/prompts/initial/design-kit
cp agents/src/prompts/initial/design-system/questioning-phase1.md agents/src/prompts/initial/design-kit/questioning-phase1.md
```

- [ ] **Step 2: Create the manifest**

Create `agents/src/prompts/initial/design-kit/manifest.json`:

```json
{
  "base": "3.0",
  "preflightTools": ["listDesignSystems"],
  "files": [
    { "src": "base", "file": "identity.md" },
    { "src": "base", "file": "project-name.md" },
    { "src": "variant", "file": "questioning-phase1.md" },
    { "src": "variant", "file": "wizard-flow.md" },
    { "src": "variant", "file": "brand-showcase.md" },
    { "src": "base", "file": "feature-list.md" }
  ]
}
```

- [ ] **Step 3: Create `wizard-flow.md`**

Create `agents/src/prompts/initial/design-kit/wizard-flow.md`:

```markdown
# Design Kit Wizard Flow

You drive a 5-step interactive wizard. Call the `setWizardStep` tool at EVERY transition
so the user's stepper stays in sync. The steps are:
1 Understanding · 2 Planning features · 3 Designing visuals · 4 Building app · 5 Finalizing

## Step 1 — Understanding
- Call `setWizardStep({ step: 1 })` before your first question.
- Ask the Phase 1 questions (see questioning instructions). Keep it brief.

## Step 2 — Planning features (assemble the kit)
After the user answers, call `setWizardStep({ step: 2 })`, then in order:
1. Score the catalog and call `installDesignSystem({ slug })` for the single best match.
   If the catalog is empty or install fails, proceed without a kit (standard styling).
2. `loadUiKit` to read the kit's primitives + components.
3. `colorScheme` — apply the kit's palette to `globals.css`.
4. `fontTheme` — apply the kit's display + body fonts.
5. `setProjectName` from the Phase 1 answer.
6. Derive an **image/video keyword phrase** — a single comma-separated descriptor that
   merges the kit's aesthetic with the customer's vertical, e.g.
   "Minimal neutral fashion lifestyle, airy whites, soft textures, quiet luxury".
   Save it with `memorySet({ key: "brand.imagery", value: { keyword: "<phrase>" } })`.
7. Write brand voice with `brandBook({ mode: "set", voice: { weAre: [...], weAreNot: [...] }, tagline, audience, personality })`.
8. Write a 2–3 sentence brand summary with `memorySet({ key: "brand.summary", value: { text: "<summary>" } })`.
9. Generate ONE square logo: use the `skill` tool to run media-logo `generate_logo`
   with `layout: "square"` and a prompt describing the mark in the kit's style. Do NOT
   generate horizontal/vertical variants in this slice.

## Step 3 — Designing visuals (STOP and wait)
- When planning is complete, call `setWizardStep({ step: 3 })` and then STOP.
- Do NOT build the showcase or hand off yet. The user now edits colours, fonts, the logo,
  the image/video keyword, voice, and summary directly in the UI (auto-saved).
- Only act again if the user sends a message (e.g. asks to regenerate the logo — run
  `generate_logo` again with `layout: "square"`), or triggers Build.

## Step 4 — Building app (on the user's "Build")
- When the user triggers Build, call `setWizardStep({ step: 4 })`, then build the brand
  showcase as a standalone HTML file — see "Brand Showcase" instructions.

## Step 5 — Finalizing (on the user's "Create website")
- When the user triggers Create-website, call `setWizardStep({ step: 5 })`, then `handoff`
  to `develop`. Keep the handoff prompt short:
  - Project name + type (one line).
  - "Design system at `docs/ui-kit/`. Load with `loadUiKit` before building. CSS tokens
    and fonts already applied. Read brand content from memory: `brand.identity`,
    `brand.summary`, `brand.imagery` (via `memoryRead`)."
  - "The kit is the source of truth. Build the homepage first; other pages on request."

## Rules
- Read/write ALL brand content via memory (`memoryRead`/`memorySet`) and the brand tools —
  never a `brand.md` file.
- Do not ask about visual preferences in Step 1 — the kit defines visual direction.
- Keep messages short and action-oriented.
```

- [ ] **Step 4: Create `brand-showcase.md` (Step-4 HTML guidance + scaffold)**

Create `agents/src/prompts/initial/design-kit/brand-showcase.md`. This adapts the original brand-showcase guidance to a standalone HTML file that reads content from memory and consumes `/brand-tokens.css`, with the inline preview listener (so live edits reflect instantly). The listener body is the verbatim `hexToHsl` / `applyThemePreview` / `applyFontPreview` logic from the template's `DevelopmentMode.tsx`:

````markdown
# Brand Showcase (Step 4)

When the user triggers Build, write a self-contained brand specimen page to
`public/brand-showcase.html` using `str_replace_based_edit_tool` (create the file).
It is iframed standalone by the builder — it is NOT a website page and is never published.

## Read content from memory first
Use `memoryRead` for: `brand.identity` (brandName, tagline, voice, audience, personality,
mission), `brand.summary` (text), `brand.imagery` (keyword). Use the kit's `anchor.json`
(via `loadUiKit`) for colour/typography/component art direction.

## Required sections
- **Brand idea** — brand name + tagline + the summary line. Display font.
- **Logo** — render `/airo-assets/images/logo/primary` large (hero scale).
- **Colour** — every palette swatch with hex labels, grouped.
- **Typography** — display + body samples (H1/H2/H3/body/caption) in real brand copy.
- **Voice & tone** — the voice descriptors + 2–3 example lines in the brand's voice.
- **At least one kit component sample** (a button row or card pair).

## Hard rules
- **Do not import any React/template code** (no Header/Footer/RootLayout). Plain HTML + CSS.
- **Style only with CSS variables** — `var(--background)`, `var(--foreground)`,
  `var(--primary)`, `var(--font-heading)`, `var(--font-sans)`, etc. Never hardcode hex or
  font-family stacks (printing hex strings as labels is fine).
- `<link rel="stylesheet" href="/brand-tokens.css">` in `<head>` — this provides all the
  variables (synced from the user's palette + fonts).
- Must not look like a real website — use brand-guide patterns (numbered sections, hairline
  dividers, mono captions), no nav/CTA/footer.

## Required `<head>` boilerplate (copy verbatim)
Include this so live edits from the wizard reflect instantly without a rebuild:

```html
<link rel="stylesheet" href="/brand-tokens.css" />
<script>
  function hexToHsl(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); if (!m) return '0 0% 0%';
    var r = parseInt(m[1],16)/255, g = parseInt(m[2],16)/255, b = parseInt(m[3],16)/255;
    var max = Math.max(r,g,b), min = Math.min(r,g,b), h=0, s=0, l=(max+min)/2;
    if (max!==min){var d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
      if(max===r)h=((g-b)/d+(g<b?6:0))/6; else if(max===g)h=((b-r)/d+2)/6; else h=((r-g)/d+4)/6;}
    return Math.round(h*360)+' '+Math.round(s*100)+'% '+Math.round(l*100)+'%';
  }
  var COLOR_MAP = {background:'--background',foreground:'--foreground',card:'--card',cardForeground:'--card-foreground',primary:'--primary',primaryForeground:'--primary-foreground',secondary:'--secondary',secondaryForeground:'--secondary-foreground',muted:'--muted',mutedForeground:'--muted-foreground',accent:'--accent',accentForeground:'--accent-foreground',destructive:'--destructive',destructiveForeground:'--destructive-foreground',border:'--border'};
  window.addEventListener('message', function (e) {
    var root = document.documentElement;
    if (e.data && e.data.type === 'PREVIEW_THEME' && e.data.palette) {
      Object.keys(COLOR_MAP).forEach(function (k) {
        var v = e.data.palette[k]; if (v) root.style.setProperty(COLOR_MAP[k], hexToHsl(v));
      });
      if (e.data.palette.primary) root.style.setProperty('--ring', hexToHsl(e.data.palette.primary));
    } else if (e.data && e.data.type === 'PREVIEW_FONT' && e.data.headerFont && e.data.bodyFont) {
      var link = document.getElementById('airo-preview-font-link');
      if (!link) { link = document.createElement('link'); link.id='airo-preview-font-link'; link.rel='stylesheet'; document.head.appendChild(link); }
      link.href = 'https://fonts.googleapis.com/css2?family=' +
        encodeURIComponent(e.data.headerFont.name).replace(/%20/g,'+') + '&family=' +
        encodeURIComponent(e.data.bodyFont.name).replace(/%20/g,'+') + '&display=swap';
      root.style.setProperty('--font-heading', '"' + e.data.headerFont.name + '", ui-sans-serif, system-ui, sans-serif');
      root.style.setProperty('--font-sans', '"' + e.data.bodyFont.name + '", ui-sans-serif, system-ui, sans-serif');
    }
  });
</script>
```
````

- [ ] **Step 5: Verify the variant loads (smoke test)**

Add `agents/src/prompts/initial/design-kit/__tests__/manifest.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const variant = join(dir, '..')

describe('design-kit prompt variant', () => {
  it('has a manifest referencing the variant files that exist', () => {
    const manifest = JSON.parse(readFileSync(join(variant, 'manifest.json'), 'utf-8'))
    expect(manifest.base).toBe('3.0')
    for (const f of manifest.files.filter((x: { src: string }) => x.src === 'variant')) {
      expect(existsSync(join(variant, f.file))).toBe(true)
    }
  })
})
```

Run: `pnpm --filter @airo/agents test:unit design-kit/__tests__/manifest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agents/src/prompts/initial/design-kit
git commit -m "feat(agents): add design-kit prompt variant (wizard flow + standalone showcase guidance)"
```

### Task 11: Register design-kit tools in `initial-agent.ts`

**Files:**
- Modify: `agents/src/agents/initial-agent.ts:323-331`

- [ ] **Step 1: Add the tool-registration block**

In `createInitialAgent`, after the existing `design-system` block (around line 331), add a sibling block. (If `memorySet`/`brandBook`/`skill`/`setProjectName`/`todoList`/`handoff` are already in the base initial tool set — as they are for design-system — only the genuinely-new ones strictly need adding; registering them again is harmless. Register the full set to be safe.)

```typescript
  // Design Kit Wizard variant: design tools + brand tools + logo skill + wizard stepper
  if (isNamedVariant && trimmedPromptVersion.startsWith('design-kit')) {
    tools.listDesignSystems = allAILibTools.listDesignSystems
    tools.installDesignSystem = allAILibTools.installDesignSystem
    tools.loadUiKit = allAILibTools.loadUiKit
    tools.colorScheme = allAILibTools.colorScheme
    tools.fontTheme = allAILibTools.fontTheme
    tools.brandBook = allAILibTools.brandBook
    tools.skill = allAILibTools.skill
    tools.memorySet = allAILibTools.memorySet
    tools.memoryRead = allAILibTools.memoryRead
    tools.setWizardStep = allAILibTools.setWizardStep
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS.

- [ ] **Step 3: Verify the agent id derivation (unit test)**

Add `agents/src/agents/__tests__/design-kit-agent.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createInitialAgent } from '../initial-agent.js'

describe('design-kit initial agent', () => {
  it('builds with id initial-design-kit and registers the wizard tools', async () => {
    const agent = await createInitialAgent(undefined, undefined, 'design-kit')
    expect(agent.id).toBe('initial-design-kit')
    expect(agent.tools.setWizardStep).toBeDefined()
    expect(agent.tools.installDesignSystem).toBeDefined()
  })
})
```

> If `AgentConfig` exposes the id/tools under different property names, adjust the assertions to match (open `initial-agent.ts` return shape). The key checks: id contains `design-kit`, and `setWizardStep` is among the tools.

Run: `pnpm --filter @airo/agents test:unit design-kit-agent`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add agents/src/agents/initial-agent.ts agents/src/agents/__tests__/design-kit-agent.test.ts
git commit -m "feat(agents): register design-kit wizard tools on the initial agent"
```

---

## Phase 6 — UI: gating, step hook, wizard shell, panels, Step-4 iframe

The "Logo & Brand" tab renders `<DesignKitWizard>` when the active profile is the wizard, else `main`'s `<BrandBookView>`. Profile is read from `useDevelopPageStore().selectedProfile` (set by the ProfileSelector; covers dev + targeted rollout — surfacing a Hivemind-cohort profile to the client is a follow-up, noted in the spec's open questions).

The panels read brand data from the existing brand-data accessor used by `BrandBookView` (a `useBrandData(appId)` hook — confirm its path by grepping `BrandBookView`; if it inlines the fetch, extract a `useBrandData` hook first). They persist edits through the Phase-4 BFF proxy and live-preview through the existing `previewThemeInIframe` / `previewFontInIframe` / `RELOAD_MEDIA_SLOT` utilities.

### Task 12: `isDesignKitWizardProfile` + tab branch

**Files:**
- Create: `app/src/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile.ts`
- Modify: `app/src/app/[market]/develop/components/preview/PreviewPane.tsx:1252-1259`
- Test: `app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/isDesignKitWizardProfile.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { isDesignKitWizardProfile, DESIGN_KIT_WIZARD_PROFILE } from '../isDesignKitWizardProfile'

describe('isDesignKitWizardProfile', () => {
  it('is true only for the design-kit profile', () => {
    expect(isDesignKitWizardProfile(DESIGN_KIT_WIZARD_PROFILE)).toBe(true)
    expect(isDesignKitWizardProfile('initial-agent-design-system')).toBe(false)
    expect(isDesignKitWizardProfile(null)).toBe(false)
    expect(isDesignKitWizardProfile(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test isDesignKitWizardProfile`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `.../design-kit-wizard/isDesignKitWizardProfile.ts`:

```typescript
export const DESIGN_KIT_WIZARD_PROFILE = 'initial-agent-design-kit'

export function isDesignKitWizardProfile(profile: string | null | undefined): boolean {
  return profile === DESIGN_KIT_WIZARD_PROFILE
}
```

- [ ] **Step 4: Branch the tab render**

In `PreviewPane.tsx`, near the other store reads, add:

```typescript
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { isDesignKitWizardProfile } from './design-kit-wizard/isDesignKitWizardProfile'
import { DesignKitWizard } from './design-kit-wizard/DesignKitWizard'
// ...
const selectedProfile = useDevelopPageStore((s) => s.selectedProfile)
```

Replace the `ViewMode.BRAND` overlay body (the `<BrandBookView appId={appId} />` line) with:

```tsx
                {viewMode === ViewMode.BRAND && (
                  <div className="absolute inset-0 w-full h-full z-10 rounded-lg md:rounded-b-none overflow-hidden">
                    {isDesignKitWizardProfile(selectedProfile)
                      ? <DesignKitWizard appId={appId} previewUrl={previewUrl} />
                      : <BrandBookView appId={appId} />}
                  </div>
                )}
```

> `previewUrl` is already available in `PreviewPane` (used elsewhere for the preview iframe). If its local name differs, pass the existing preview URL variable.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter website test isDesignKitWizardProfile`
Expected: PASS. (The PreviewPane change is type-checked in Task 22's build step once `DesignKitWizard` exists; create a temporary stub `export function DesignKitWizard() { return null }` now if you need the app to typecheck between tasks, replaced in Task 14.)

- [ ] **Step 6: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile.ts app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/isDesignKitWizardProfile.test.ts app/src/app/[market]/develop/components/preview/PreviewPane.tsx
git commit -m "feat(app): gate Logo & Brand tab on the design-kit profile"
```

### Task 13: `useWizardStep` hook

Hydrates the step from brand-data on mount, then tracks the live `useWizardStore` (updated by `BuildPhaseHandler`); exposes a setter that persists via the BFF and updates the store optimistically.

**Files:**
- Create: `app/src/app/[market]/develop/components/preview/design-kit-wizard/useWizardStep.ts`
- Test: `app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/useWizardStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWizardStep } from '../useWizardStep'
import { useWizardStore } from '@/stores/useWizardStore'

vi.mock('../useBrandData', () => ({ useBrandData: () => ({ data: { wizard: { step: 2 } }, isLoading: false }) }))
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, wizard: { step: 3 } }), { status: 200 }))
vi.stubGlobal('fetch', fetchMock)

describe('useWizardStep', () => {
  beforeEach(() => { useWizardStore.setState({ stepByApp: {} }); fetchMock.mockClear() })

  it('hydrates from brand-data then reflects store updates', async () => {
    const { result } = renderHook(() => useWizardStep('app1234567'))
    await waitFor(() => expect(result.current.step).toBe(2))
    act(() => { useWizardStore.getState().setStep('app1234567', 4) })
    await waitFor(() => expect(result.current.step).toBe(4))
  })

  it('setStep persists via the BFF and updates the store', async () => {
    const { result } = renderHook(() => useWizardStep('app1234567'))
    await act(async () => { await result.current.setStep(3) })
    expect(fetchMock).toHaveBeenCalledWith('/api/design-kit/app1234567/wizard-step', expect.objectContaining({ method: 'PUT' }))
    expect(useWizardStore.getState().getStep('app1234567')).toBe(3)
  })
})
```

> Adjust the `useBrandData` mock path to wherever the real hook lives.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test useWizardStep`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```typescript
import { useEffect, useCallback } from 'react'
import { useWizardStore, type WizardStep } from '@/stores/useWizardStore'
import { useBrandData } from './useBrandData'

export function useWizardStep(appId: string): {
  step: WizardStep
  setStep: (step: WizardStep) => Promise<void>
  isLoading: boolean
} {
  const storeStep = useWizardStore((s) => s.stepByApp[appId])
  const setStoreStep = useWizardStore((s) => s.setStep)
  const { data, isLoading } = useBrandData(appId)

  // Hydrate the store from persisted brand-data the first time we learn the step.
  useEffect(() => {
    const persisted = data?.wizard?.step as WizardStep | undefined
    if (persisted && useWizardStore.getState().stepByApp[appId] === undefined) {
      setStoreStep(appId, persisted)
    }
  }, [appId, data?.wizard?.step, setStoreStep])

  const setStep = useCallback(async (step: WizardStep) => {
    setStoreStep(appId, step) // optimistic
    await fetch(`/api/design-kit/${appId}/wizard-step`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step }),
    })
  }, [appId, setStoreStep])

  return { step: (storeStep ?? 1) as WizardStep, setStep, isLoading }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter website test useWizardStep`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/design-kit-wizard/useWizardStep.ts app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/useWizardStep.test.tsx
git commit -m "feat(app): add useWizardStep hook (hydrate + live step + persist)"
```

### Task 14: `DesignKitWizard` shell + stepper

**Files:**
- Create: `app/src/app/[market]/develop/components/preview/design-kit-wizard/Stepper.tsx`
- Create: `app/src/app/[market]/develop/components/preview/design-kit-wizard/DesignKitWizard.tsx`
- Test: `app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/DesignKitWizard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DesignKitWizard } from '../DesignKitWizard'
import { useWizardStore } from '@/stores/useWizardStore'

vi.mock('../useBrandData', () => ({ useBrandData: () => ({ data: { wizard: { step: 3 } }, isLoading: false, refetch: vi.fn() }) }))

describe('DesignKitWizard', () => {
  beforeEach(() => useWizardStore.setState({ stepByApp: { app1234567: 3 } }))

  it('renders the 5-step stepper and marks the active step', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />)
    expect(screen.getByTestId('design-kit-stepper')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-step-3')).toHaveAttribute('data-active', 'true')
    // Step 3 shows the editing panels
    expect(screen.getByTestId('design-kit-panels')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test DesignKitWizard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the stepper**

Create `Stepper.tsx`:

```tsx
import type { WizardStep } from '@/stores/useWizardStore'

const STEPS: Array<{ step: WizardStep; label: string }> = [
  { step: 1, label: 'Understanding' },
  { step: 2, label: 'Planning features' },
  { step: 3, label: 'Designing visuals' },
  { step: 4, label: 'Building app' },
  { step: 5, label: 'Finalizing' },
]

export function Stepper({ current, onStepClick }: { current: WizardStep; onStepClick?: (s: WizardStep) => void }): JSX.Element {
  return (
    <ol data-testid="design-kit-stepper" className="flex items-center gap-4">
      {STEPS.map(({ step, label }) => {
        const complete = step < current
        const active = step === current
        // Step 3 is re-visitable once reached; clicking it jumps back to edit.
        const clickable = step === 3 && current > 3 && !!onStepClick
        return (
          <li
            key={step}
            data-testid={`wizard-step-${step}`}
            data-active={active}
            data-complete={complete}
            className={`flex items-center gap-2 ${clickable ? 'cursor-pointer' : ''}`}
            onClick={clickable ? () => onStepClick?.(3) : undefined}
          >
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${active || complete ? 'bg-[var(--brand-accent,#6c4cf1)] text-white' : 'bg-gray-200 text-gray-500'}`}>
              {complete ? '✓' : step}
            </span>
            <span className={active ? 'font-semibold' : 'text-gray-500'}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 4: Implement the shell**

Create `DesignKitWizard.tsx`. It routes by step: 1–2 show the chat-driven "assembling the kit" state, 3 shows the panels, 4 shows the showcase iframe (+ panels still reachable via the stepper), 5 shows a finalizing state:

```tsx
import { useWizardStep } from './useWizardStep'
import { Stepper } from './Stepper'
import { DesignKitPanels } from './DesignKitPanels'
import { AssemblingKit } from './AssemblingKit'

export function DesignKitWizard({ appId, previewUrl }: { appId: string; previewUrl?: string }): JSX.Element {
  const { step, setStep } = useWizardStep(appId)

  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-[var(--background,#fff)] p-8" data-testid="design-kit-wizard">
      <div className="mx-auto mb-8 w-full max-w-5xl">
        <Stepper current={step} onStepClick={setStep} />
      </div>

      <div className="mx-auto w-full max-w-5xl">
        {(step === 1 || step === 2) && <AssemblingKit appId={appId} step={step} />}

        {step >= 3 && (
          <>
            {step === 4 && previewUrl && (
              <iframe
                data-testid="design-kit-showcase-iframe"
                title="Brand showcase"
                src={`${previewUrl}/brand-showcase.html`}
                className="mb-8 h-[60vh] w-full rounded-lg border"
              />
            )}
            {step === 5 && (
              <p data-testid="design-kit-finalizing" className="mb-6 text-center text-gray-600">
                Handing off to build your website…
              </p>
            )}
            <DesignKitPanels appId={appId} />
            {step === 3 && (
              <div className="mt-8 flex justify-end">
                <button
                  data-testid="design-kit-build"
                  className="rounded-md bg-[var(--brand-accent,#6c4cf1)] px-4 py-2 text-white"
                  onClick={() => setStep(4)}
                >
                  Build my brand showcase
                </button>
              </div>
            )}
            {step === 4 && (
              <div className="mt-8 flex justify-end">
                <button
                  data-testid="design-kit-create-website"
                  className="rounded-md bg-[var(--brand-accent,#6c4cf1)] px-4 py-2 text-white"
                  onClick={() => setStep(5)}
                >
                  Create my website
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

> The "Build" / "Create website" buttons set the step locally for an instant stepper move. To make the **agent** act (generate showcase / hand off), they should also send a chat message via the existing `sendMessage` from `WebSocketContext` (e.g. `"Build my brand showcase"` / `"Create my website"`). Wire `sendMessage` here exactly as `ChatSecretsRequestMessage.tsx` does (import from the WebSocket context). The agent's prompt (Task 10) calls `setWizardStep(4)`/`(5)` itself, which will reconcile the step.

- [ ] **Step 5: Create the `AssemblingKit` placeholder (real component filled in Task 16)**

Create a minimal `AssemblingKit.tsx` so the shell compiles and the test passes:

```tsx
export function AssemblingKit({ appId, step }: { appId: string; step: number }): JSX.Element {
  return (
    <div data-testid="design-kit-assembling" className="py-16 text-center">
      <h2 className="text-xl font-semibold">{step === 1 ? 'Understanding your idea…' : 'Assembling your kit…'}</h2>
    </div>
  )
}
```

Also create a minimal `DesignKitPanels.tsx` stub returning `<div data-testid="design-kit-panels" />` so this task's test passes; it is fully implemented in Task 15.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter website test DesignKitWizard`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/design-kit-wizard/Stepper.tsx app/src/app/[market]/develop/components/preview/design-kit-wizard/DesignKitWizard.tsx app/src/app/[market]/develop/components/preview/design-kit-wizard/AssemblingKit.tsx app/src/app/[market]/develop/components/preview/design-kit-wizard/DesignKitPanels.tsx app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/DesignKitWizard.test.tsx
git commit -m "feat(app): add DesignKitWizard shell + 5-step stepper"
```

### Task 15: Step-3 editing panels

Per the spec's Slice-1 split: **Fonts** is fully live (dropdown → `previewFontInIframe` → BFF persist). **Colour** and **Logo** are display + agent-regenerate (generation stays on the agent). **Voice / Summary / Image&Video keyword** are direct text persists. **Image&Video results** reuse the existing media search + slot-pick. **Elements** is read-only. (Per-swatch colour editing and the keyword-alternatives picker are deferred.)

**Files:**
- Create: `app/src/app/[market]/develop/components/preview/design-kit-wizard/designKitApi.ts`
- Create: `app/src/app/[market]/develop/components/preview/design-kit-wizard/fontOptions.ts`
- Replace: `app/src/app/[market]/develop/components/preview/design-kit-wizard/DesignKitPanels.tsx` (the Task-14 stub)
- Test: `app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/FontsPanel.test.tsx`

- [ ] **Step 1: Create the BFF client helper**

Create `designKitApi.ts`:

```typescript
async function put(appId: string, action: string, body: unknown): Promise<Response> {
  return fetch(`/api/design-kit/${appId}/${action}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const designKitApi = {
  setColors: (appId: string, name: string, palette: Record<string, string>) => put(appId, 'colors', { name, palette }),
  setFonts: (appId: string, heading: FontChoice, body: FontChoice) => put(appId, 'fonts', { heading, body }),
  setVoice: (appId: string, voice: { weAre?: string[]; weAreNot?: string[] }) => put(appId, 'voice', { voice }),
  setSummary: (appId: string, text: string) => put(appId, 'summary', { text }),
  setImagery: (appId: string, keyword: string) => put(appId, 'imagery', { keyword }),
}

export interface FontChoice { name: string; weights: string[]; category: string }
```

- [ ] **Step 2: Create the curated font options (no cross-package import)**

Create `fontOptions.ts` (mirrors the agents `FONT_THEMES` + a few web fonts; the app must not import from `@airo/agents`):

```typescript
import type { FontChoice } from './designKitApi'

export const HEADING_FONTS: FontChoice[] = [
  { name: 'Montserrat', weights: ['600', '700'], category: 'sans-serif' },
  { name: 'Oswald', weights: ['500', '700'], category: 'sans-serif' },
  { name: 'Playfair Display', weights: ['600', '700'], category: 'serif' },
  { name: 'Bebas Neue', weights: ['400'], category: 'sans-serif' },
  { name: 'Merriweather', weights: ['700', '900'], category: 'serif' },
  { name: 'Inter', weights: ['600', '700'], category: 'sans-serif' },
]

export const BODY_FONTS: FontChoice[] = [
  { name: 'Inter', weights: ['400', '500', '600'], category: 'sans-serif' },
  { name: 'Lora', weights: ['400', '500'], category: 'serif' },
  { name: 'Work Sans', weights: ['400', '500'], category: 'sans-serif' },
  { name: 'Source Sans 3', weights: ['400', '600'], category: 'sans-serif' },
  { name: 'Nunito', weights: ['400', '600'], category: 'sans-serif' },
  { name: 'Roboto Flex', weights: ['400', '500'], category: 'sans-serif' },
]
```

- [ ] **Step 3: Write the failing Fonts-panel test**

Create `__tests__/FontsPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FontsPanel } from '../DesignKitPanels'

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
vi.stubGlobal('fetch', fetchMock)
const previewFont = vi.fn()
vi.mock('@/app/[market]/develop/components/utils/previewFontInIframe', () => ({ previewFontInIframe: (...a: unknown[]) => previewFont(...a), revertFontInIframe: vi.fn() }))

describe('FontsPanel', () => {
  beforeEach(() => { fetchMock.mockClear(); previewFont.mockClear() })

  it('selecting a heading font previews it and persists via the BFF', async () => {
    render(<FontsPanel appId="app1234567" typography={{ heading: { family: 'Inter', weights: ['600'] }, body: { family: 'Inter', weights: ['400'] } }} />)
    fireEvent.change(screen.getByTestId('heading-font-select'), { target: { value: 'Oswald' } })
    expect(previewFont).toHaveBeenCalled()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/design-kit/app1234567/fonts', expect.objectContaining({ method: 'PUT' })))
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter website test FontsPanel`
Expected: FAIL — `FontsPanel` is not exported (stub only).

- [ ] **Step 5: Implement the panels**

Replace `DesignKitPanels.tsx` with the real implementation. It reads `useBrandData(appId)` and renders the seven panels; each panel is exported for unit testing. Uses `sendMessage` from the WebSocket context for generative actions (logo regenerate, palette regenerate) — import it the same way `ChatSecretsRequestMessage.tsx` does.

```tsx
import { useState } from 'react'
import type { BrandData, BrandDataPalette, BrandDataTypography } from '@airo/shared/brand-data'
import { useWebSocket } from '@/contexts/WebSocketContext'
import { previewFontInIframe } from '@/app/[market]/develop/components/utils/previewFontInIframe'
import { useBrandData } from './useBrandData'
import { designKitApi, type FontChoice } from './designKitApi'
import { HEADING_FONTS, BODY_FONTS } from './fontOptions'

export function DesignKitPanels({ appId }: { appId: string }): JSX.Element {
  const { data } = useBrandData(appId)
  return (
    <div data-testid="design-kit-panels" className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <LogoPanel appId={appId} />
      <ColorPanel appId={appId} palette={data?.palette} />
      <FontsPanel appId={appId} typography={data?.typography} />
      <ImageVideoPanel appId={appId} keyword={data?.imagery?.keyword} />
      <ElementsPanel />
      <VoicePanel appId={appId} voice={data?.voice} />
      <SummaryPanel appId={appId} text={data?.summary?.text} />
    </div>
  )
}

export function FontsPanel({ appId, typography }: { appId: string; typography?: BrandDataTypography }): JSX.Element {
  const headingName = typography?.heading?.family ?? 'Inter'
  const bodyName = typography?.body?.family ?? 'Inter'

  function apply(headingFamily: string, bodyFamily: string): void {
    const heading: FontChoice = HEADING_FONTS.find((f) => f.name === headingFamily) ?? { name: headingFamily, weights: ['600', '700'], category: 'sans-serif' }
    const body: FontChoice = BODY_FONTS.find((f) => f.name === bodyFamily) ?? { name: bodyFamily, weights: ['400'], category: 'sans-serif' }
    previewFontInIframe({ headerFont: heading, bodyFont: body }) // instant preview
    void designKitApi.setFonts(appId, heading, body)             // persist (auto-save)
  }

  return (
    <section className="rounded-lg border p-4" data-testid="panel-fonts">
      <h3 className="mb-3 font-semibold">Fonts</h3>
      <label className="text-xs text-gray-500">Headline text</label>
      <select data-testid="heading-font-select" defaultValue={headingName} className="mb-3 w-full rounded border p-2"
        onChange={(e) => apply(e.target.value, bodyName)}>
        {HEADING_FONTS.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
      </select>
      <label className="text-xs text-gray-500">Body text</label>
      <select data-testid="body-font-select" defaultValue={bodyName} className="w-full rounded border p-2"
        onChange={(e) => apply(headingName, e.target.value)}>
        {BODY_FONTS.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
      </select>
    </section>
  )
}

export function ColorPanel({ appId, palette }: { appId: string; palette?: BrandDataPalette }): JSX.Element {
  const { sendMessage } = useWebSocket()
  const swatches = [palette?.primary, palette?.secondary, palette?.accent, palette?.background, palette?.muted].filter(Boolean) as string[]
  return (
    <section className="rounded-lg border p-4" data-testid="panel-color">
      <h3 className="mb-3 font-semibold">Color</h3>
      <div className="mb-3 flex gap-2">
        {swatches.map((hex, i) => <span key={i} className="h-8 w-8 rounded" style={{ backgroundColor: hex }} title={hex} />)}
      </div>
      <button data-testid="color-regenerate" className="text-sm text-[var(--brand-accent,#6c4cf1)]"
        onClick={() => sendMessage({ content: 'Suggest a different colour palette for my brand and apply it.' })}>
        Regenerate palette
      </button>
    </section>
  )
}

export function VoicePanel({ appId, voice }: { appId: string; voice?: { weAre?: string[] } }): JSX.Element {
  const [text, setText] = useState((voice?.weAre ?? []).join('\n'))
  return (
    <section className="rounded-lg border p-4" data-testid="panel-voice">
      <h3 className="mb-3 font-semibold">Brand voice</h3>
      <textarea data-testid="voice-input" className="h-28 w-full rounded border p-2 text-sm" value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void designKitApi.setVoice(appId, { weAre: text.split('\n').map((s) => s.trim()).filter(Boolean) })} />
    </section>
  )
}

export function SummaryPanel({ appId, text: initial }: { appId: string; text?: string }): JSX.Element {
  const [text, setText] = useState(initial ?? '')
  return (
    <section className="rounded-lg border p-4" data-testid="panel-summary">
      <h3 className="mb-3 font-semibold">Brand summary</h3>
      <textarea data-testid="summary-input" className="h-28 w-full rounded border p-2 text-sm" value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void designKitApi.setSummary(appId, text)} />
    </section>
  )
}

export function ImageVideoPanel({ appId, keyword: initial }: { appId: string; keyword?: string }): JSX.Element {
  const [keyword, setKeyword] = useState(initial ?? '')
  return (
    <section className="rounded-lg border p-4" data-testid="panel-imagery">
      <h3 className="mb-3 font-semibold">Image & Video</h3>
      <input data-testid="imagery-input" className="mb-2 w-full rounded border p-2 text-sm" value={keyword}
        placeholder="e.g. Minimal neutral fashion lifestyle, airy whites, soft textures"
        onChange={(e) => setKeyword(e.target.value)}
        onBlur={() => void designKitApi.setImagery(appId, keyword)} />
      <p className="text-xs text-gray-500">Edit the descriptor, then pick images from search. (Search + pick reuse the existing media slot search — wire to the same endpoints `MediaSlotDetail` uses.)</p>
    </section>
  )
}

export function LogoPanel({ appId }: { appId: string }): JSX.Element {
  const { sendMessage } = useWebSocket()
  return (
    <section className="rounded-lg border p-4" data-testid="panel-logo">
      <h3 className="mb-3 font-semibold">Logo</h3>
      <img src="/airo-assets/images/logo/primary" alt="Primary logo" className="mb-3 h-20 w-20 object-contain" />
      <button data-testid="logo-regenerate" className="text-sm text-[var(--brand-accent,#6c4cf1)]"
        onClick={() => sendMessage({ content: 'Regenerate my square logo with a fresh take.' })}>
        Regenerate logo
      </button>
    </section>
  )
}

export function ElementsPanel(): JSX.Element {
  return (
    <section className="rounded-lg border p-4" data-testid="panel-elements">
      <h3 className="mb-3 font-semibold">Elements</h3>
      <div className="flex gap-2">
        <button className="rounded bg-[var(--primary)] px-3 py-1 text-[var(--primary-foreground)]" style={{ background: 'var(--primary)' }}>Button</button>
      </div>
      <p className="mt-2 text-xs text-gray-500">Buttons, icons & graphics preview (read-only this release).</p>
    </section>
  )
}
```

> The image/video **search + pick** flow (entering a keyword → results grid → swap into a slot) is intentionally minimal here: the keyword persists, and picking results reuses the **existing** search + `PUT /media/:appId/slots/:slotName` flow already in `MediaSlotDetail.tsx`. Lift that search/pick UI into `ImageVideoPanel` by reusing the same fetch calls (do not build a new search endpoint).
>
> `useWebSocket()`/`sendMessage` import: match the existing usage in `app/src/components/.../ChatSecretsRequestMessage.tsx`. If the context hook name differs, use that.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter website test FontsPanel`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/design-kit-wizard/designKitApi.ts app/src/app/[market]/develop/components/preview/design-kit-wizard/fontOptions.ts app/src/app/[market]/develop/components/preview/design-kit-wizard/DesignKitPanels.tsx app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/FontsPanel.test.tsx
git commit -m "feat(app): add Step-3 design-kit editing panels"
```

### Task 16: Step-2 "assembling the kit" animation

Replace the `AssemblingKit` placeholder with an event-driven reveal: as brand assets land during Planning, each tile animates in. Drive it off the existing `BRAND_SHOWCASE_UPDATED_EVENT` and `logo-generated` custom events (dispatched by `toolSideEffects.ts`) plus brand-data.

**Files:**
- Replace: `app/src/app/[market]/develop/components/preview/design-kit-wizard/AssemblingKit.tsx`
- Test: `app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/AssemblingKit.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AssemblingKit } from '../AssemblingKit'

vi.mock('../useBrandData', () => ({ useBrandData: () => ({ data: { palette: { primary: '#123456' }, typography: { heading: { family: 'Oswald' } } }, isLoading: false, refetch: vi.fn() }) }))

describe('AssemblingKit', () => {
  it('reveals the palette + fonts tiles when brand data is present', () => {
    render(<AssemblingKit appId="app1234567" step={2} />)
    expect(screen.getByTestId('assemble-tile-colors')).toHaveAttribute('data-filled', 'true')
    expect(screen.getByTestId('assemble-tile-fonts')).toHaveAttribute('data-filled', 'true')
    expect(screen.getByTestId('assemble-tile-logo')).toHaveAttribute('data-filled', 'false')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test AssemblingKit`
Expected: FAIL — current stub has no tiles.

- [ ] **Step 3: Implement the animation**

```tsx
import { useEffect } from 'react'
import { useBrandData } from './useBrandData'

export function AssemblingKit({ appId, step }: { appId: string; step: number }): JSX.Element {
  const { data, refetch } = useBrandData(appId)

  // Re-fetch brand data when the agent mutates brand assets so tiles fill in live.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { appId?: string } | undefined
      if (!detail?.appId || detail.appId === appId) void refetch?.()
    }
    window.addEventListener('brand-showcase-updated', onUpdate)
    window.addEventListener('logo-generated', onUpdate)
    return () => {
      window.removeEventListener('brand-showcase-updated', onUpdate)
      window.removeEventListener('logo-generated', onUpdate)
    }
  }, [appId, refetch])

  const tiles: Array<{ key: string; label: string; filled: boolean }> = [
    { key: 'colors', label: 'Colours', filled: !!data?.palette?.primary },
    { key: 'fonts', label: 'Fonts', filled: !!data?.typography?.heading?.family },
    { key: 'logo', label: 'Logo', filled: false }, // filled via logo-generated → refetch + a logo presence check if surfaced
    { key: 'imagery', label: 'Image & Video', filled: !!data?.imagery?.keyword },
    { key: 'voice', label: 'Brand voice', filled: !!data?.voice?.weAre?.length },
    { key: 'summary', label: 'Brand summary', filled: !!data?.summary?.text },
  ]

  return (
    <div className="py-12 text-center" data-testid="design-kit-assembling">
      <h2 className="mb-8 text-xl font-semibold">
        {step === 1 ? 'Understanding your idea…' : 'Assembling your kit…'}
      </h2>
      <div className="mx-auto grid max-w-2xl grid-cols-3 gap-4">
        {tiles.map((t) => (
          <div
            key={t.key}
            data-testid={`assemble-tile-${t.key}`}
            data-filled={t.filled}
            className={`flex h-24 items-center justify-center rounded-lg border transition-all duration-500 ${t.filled ? 'scale-100 opacity-100 shadow' : 'scale-95 opacity-40'}`}
          >
            {t.label}
          </div>
        ))}
      </div>
    </div>
  )
}
```

> The logo tile's `filled` can be wired to a logo-presence signal if brand-data surfaces logo slot state later; for Slice 1 the `logo-generated` event triggers a refetch and the user proceeds to Step 3 where the logo renders from its slot. Keeping `logo.filled=false` here is acceptable (the tile stays "pending" during assembly).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter website test AssemblingKit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/design-kit-wizard/AssemblingKit.tsx app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/AssemblingKit.test.tsx
git commit -m "feat(app): add Step-2 assembling-the-kit animation"
```

---

## Phase 7 — i18n, E2E, verification

### Task 17: Replace UI literals with i18n keys

The app validates translation keys at pre-commit (missing keys **block the commit**). The wizard's user-facing strings (written as English literals in Tasks 14–16 for clarity) must move to `t()` calls with registered keys.

**Files:**
- Modify: all `design-kit-wizard/*.tsx` user-facing strings
- Reference: `app/src/lib/translations/README.md`

- [ ] **Step 1: Create the keys at the i18n portal**

Create these keys at https://i18n.int.gdcorp.tools/org/hcx/app/aab (PARTNERSTRANSLATIONS AD group), `en-US`:

| Key | English value |
|---|---|
| `builder_designkit_step_understanding` | Understanding |
| `builder_designkit_step_planning` | Planning features |
| `builder_designkit_step_designing` | Designing visuals |
| `builder_designkit_step_building` | Building app |
| `builder_designkit_step_finalizing` | Finalizing |
| `builder_designkit_understanding_title` | Understanding your idea… |
| `builder_designkit_assembling_title` | Assembling your kit… |
| `builder_designkit_panel_logo` | Logo |
| `builder_designkit_panel_color` | Color |
| `builder_designkit_panel_fonts` | Fonts |
| `builder_designkit_panel_imagery` | Image & Video |
| `builder_designkit_panel_elements` | Elements |
| `builder_designkit_panel_voice` | Brand voice |
| `builder_designkit_panel_summary` | Brand summary |
| `builder_designkit_fonts_heading` | Headline text |
| `builder_designkit_fonts_body` | Body text |
| `builder_designkit_regenerate_palette` | Regenerate palette |
| `builder_designkit_regenerate_logo` | Regenerate logo |
| `builder_designkit_build_cta` | Build my brand showcase |
| `builder_designkit_create_website_cta` | Create my website |
| `builder_designkit_finalizing_msg` | Handing off to build your website… |
| `builder_designkit_imagery_placeholder` | e.g. Minimal neutral fashion lifestyle, airy whites, soft textures |

- [ ] **Step 2: Verify the keys are fetchable**

Run: `curl -s 'https://api.i18n.int.gdcorp.tools/api/v2/package/market/en-US/%40airo-app-builder%2Faab' | grep builder_designkit_step_understanding`
Expected: the key appears in the response.

- [ ] **Step 3: Convert literals to `t()`**

In each wizard component, add `const { t } = useTranslations()` (from `@/hooks/useTranslations`) and replace the English literals with `t('builder_designkit_...')`. Update `Stepper.tsx`'s `STEPS` labels to use the step keys, etc. Keep all `data-testid`s unchanged (the tests key off testids, not text).

- [ ] **Step 4: Run the wizard tests to confirm nothing broke**

Run: `pnpm --filter website test design-kit-wizard`
Expected: PASS (testids unchanged).

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/design-kit-wizard
git commit -m "feat(app): i18n the design-kit wizard strings"
```

### Task 18: E2E happy path (profile-gated)

**Files:**
- Create: `tests/regression/design-kit-wizard.spec.ts`
- Reference: existing specs in `tests/regression/` for the auth/app-creation helpers and the profile-selection mechanism.

- [ ] **Step 1: Write the E2E spec**

Model it on an existing `tests/regression/*.spec.ts` (reuse their login + create-app fixtures). Select the `initial-agent-design-kit` profile via the ProfileSelector (or set the per-shopper Switchboard override for `appbuilder-agent-profile` before the run), then walk the flow:

```typescript
import { test, expect } from '@playwright/test'
// import shared fixtures (login, createApp, openBrandTab) from the regression helpers

test('design kit wizard: questioning → assemble → edit → build → create', async ({ page }) => {
  // 1. Login + create an app on the design-kit profile (reuse helpers).
  // 2. Open the "Logo & Brand" tab.
  await expect(page.getByTestId('design-kit-wizard')).toBeVisible()

  // Stepper is present; the agent auto-advances. Wait for Step 3 (editing).
  await expect(page.getByTestId('wizard-step-3')).toHaveAttribute('data-active', 'true', { timeout: 120_000 })
  await expect(page.getByTestId('design-kit-panels')).toBeVisible()

  // Edit a font (live + persisted).
  await page.getByTestId('heading-font-select').selectOption('Oswald')

  // Edit the summary + imagery keyword.
  await page.getByTestId('summary-input').fill('A calm, considered lifestyle brand.')
  await page.getByTestId('summary-input').blur()
  await page.getByTestId('imagery-input').fill('Minimal neutral, airy whites, soft textures')
  await page.getByTestId('imagery-input').blur()

  // Build → Step 4 shows the showcase iframe.
  await page.getByTestId('design-kit-build').click()
  await expect(page.getByTestId('design-kit-showcase-iframe')).toBeVisible({ timeout: 120_000 })

  // Create website → Step 5.
  await page.getByTestId('design-kit-create-website').click()
  await expect(page.getByTestId('wizard-step-5')).toHaveAttribute('data-active', 'true', { timeout: 60_000 })
})
```

- [ ] **Step 2: Run the E2E spec**

Run it the way `tests/regression/` specs are run (see `tests/` README / `playwright.config`). Expected: PASS against a local or test environment with the design-kit profile enabled.

- [ ] **Step 3: Commit**

```bash
git add tests/regression/design-kit-wizard.spec.ts
git commit -m "test(e2e): design kit wizard happy path"
```

### Task 19: Full verification

- [ ] **Step 1: Typecheck, lint, build, unit tests (Turborepo + per-package)**

```bash
pnpm typecheck
pnpm lint
pnpm --filter @airo/agents test:unit
pnpm --filter website test
pnpm build
```
Expected: all PASS. Fix any failures before proceeding.

- [ ] **Step 2: Manual smoke (local dev)**

Use the `local-dev-browser` skill (or `pnpm run local:test`) to: enable the `initial-agent-design-kit` profile via the ProfileSelector, create an app, open "Logo & Brand", and confirm: the stepper advances 1→2→3, the assemble tiles fill, a font change live-updates, Build shows the showcase iframe consuming `/brand-tokens.css`, and Create-website hands off. Confirm a non-design-kit profile still shows the old `<BrandBookView>`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: verification fixes for design-kit wizard"
```

---

## Self-review — spec coverage

| Spec section | Covered by |
|---|---|
| §3 Agent profile + cloned prompt variant | Tasks 9, 10, 11 |
| §4 Gating (wizard vs BrandBookView) | Task 12 |
| §5 Data model (memory keys, brand-data, brand-tokens.css) | Tasks 1, 2, 6 |
| §6 Step-state machine (build_phase + setWizardStep + persisted step) | Tasks 3, 4, 5, 13 |
| §7 Five steps (auto-advance, gates, return to 3) | Tasks 10, 14 |
| §7 Step-2 animation | Task 16 |
| §8 Step-3 panels (editable vs deferred) | Task 15 |
| §9 Direct-edit routes + live preview | Tasks 7, 8, 15 |
| Standalone HTML showcase + brand-tokens.css | Tasks 6, 10 (brand-showcase.md), 14 (iframe) |
| §12 Testing | Tasks across phases + 18, 19 |
| §rollout/flagging | Task 9 (dormant profile), Task 19 step 2 |

**Deferred (correctly absent from tasks):** per-swatch colour editing + vibe, keyword alternatives picker, icons/graphics + regenerate, voice/summary regenerate, multi-lockup upload + import-from-Airo.

## Notes for the implementer

- **Verify a few import paths the extraction couldn't pin exactly** (each flagged inline): `emitToApp` (match `video-generation-tool.ts`), the SSE registry emit, `useBrandData` hook location, and `useWebSocket`/`sendMessage` from the WebSocket context. Grep the cited precedent file and match.
- **Base initial tools:** confirm `memorySet`/`memoryRead`/`setProjectName`/`todoList`/`handoff`/`str_replace_based_edit_tool` are in the base initial tool set (they are for `design-system`). The Task-11 block re-registers the safe subset; add any that turn out to be missing.
- **`brand-tokens.css` timing:** synced by the direct-edit routes and Step-4 generation. If you want the showcase to reflect agent-side colour/font changes made mid-Step-3 (e.g. palette regenerate) without a Build, also call `syncBrandTokensCss` at the end of the `colorScheme`/`fontTheme` tools — but only when the active profile is `design-kit` to avoid writing the file for unrelated apps.
