# Design Kit Step-3 Edit Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Step-3 colour/font edits in the Design Kit Wizard fully propagate — to the app-plan the develop agent reads when building the website, to the persisted font name, to all sibling UI views, and deterministically (no border re-roll).

**Architecture:** The direct-edit routes (`PUT /apps/:id/design-kit/colors|fonts`) gain two writes that mirror what the agent `colorScheme`/`fontTheme` tools already do — an app-plan update and (for fonts) a persisted pairing name — plus a determinism fix that pins the previously derived `border`. The client `designKitApi` wrapper dispatches the existing `BRAND_DATA_UPDATED_EVENT` so `useBrandData` consumers refetch. The shared `AppContextManager` read order and the shared agent tools are left untouched.

**Tech Stack:** TypeScript, Express (agents service, port 4000), Vitest + supertest (agents tests), Vitest + jsdom (website tests), Next.js BFF proxy.

**Spec:** `docs/superpowers/specs/2026-06-10-design-kit-step3-edit-propagation-design.md`

---

## File Structure

- **`agents/src/server/routes/design-kit.ts`** (modify) — the colours and fonts direct-edit handlers. Colours handler: read prior palette → pin `border` → write CSS/memory/tokens → write app-plan. Fonts handler: validate → write CSS → synthesize name → write memory (with `name`)/tokens → write app-plan.
- **`agents/src/server/routes/__tests__/design-kit.test.ts`** (modify) — add app-plan mock + assertions for app-plan writes, persisted font `name`, and deterministic `border`.
- **`app/src/app/[market]/develop/components/preview/design-kit-wizard/designKitApi.ts`** (modify) — `put()` becomes async, dispatches `BRAND_DATA_UPDATED_EVENT` on a successful response.
- **`app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/designKitApi.test.ts`** (create) — assert the event fires (with `appId` in `detail`) after a successful edit and not on failure.

All commits run under the repo's lint-staged pre-commit hook. Agents tests require **Node 22** (`fnm use 22` first — `better-sqlite3` ABI breaks on Node 24).

---

## Task 1: Colours route — pin `border` + write app-plan

**Files:**
- Modify: `agents/src/server/routes/design-kit.ts` (imports + the `PUT /apps/:id/design-kit/colors` handler)
- Test: `agents/src/server/routes/__tests__/design-kit.test.ts`

- [ ] **Step 1: Add the app-plan mock to the test file**

In `design-kit.test.ts`, add `appPlanExecute` to the `vi.hoisted(...)` object (alongside `setMock` etc.):

```typescript
    appPlanExecute: vi.fn(async () => ({ success: true })),
```

Add a `vi.mock` next to the other mocks (the route imports `../../tools/app-plan-tool.js`; from this test file that resolves to `../../../tools/app-plan-tool.js`):

```typescript
// App plan tool — colours/fonts routes mirror colorScheme/fontTheme by also persisting here.
vi.mock('../../../tools/app-plan-tool.js', () => ({ appPlanTool: { execute: appPlanExecute } }));
```

Add `appPlanExecute.mockClear();` inside `beforeEach`.

- [ ] **Step 2: Write the failing tests (app-plan write + deterministic border)**

Add these two tests inside the `describe('design-kit direct-edit routes', ...)` block:

```typescript
  it('PUT colors persists the palette to the app plan', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/colors')
      .send({ name: 'Indigo', palette: { primary: '#3b5bdb', background: '#ffffff' } });

    expect(res.status).toBe(200);
    expect(appPlanExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app1234567',
        operation: 'update',
        colorPalette: expect.objectContaining({ name: 'Indigo', primary: '#3b5bdb' }),
      }),
    );
  });

  it('PUT colors reuses the prior border so generatePalette does not re-roll it', async () => {
    getMock.mockResolvedValueOnce({
      success: true,
      exists: true,
      value: { primary: '#111111', background: '#ffffff', border: '#abcdef' },
    } as never);

    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/colors')
      .send({ name: 'Indigo', palette: { primary: '#3b5bdb', background: '#ffffff' } });

    expect(res.status).toBe(200);
    // The prior border is passed through to updateCssColorPalette as an explicit input.
    expect(updateCssColorPalette).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ primary: '#3b5bdb', border: '#abcdef' }),
    );
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `fnm use 22 && pnpm --filter @airo/agents test:unit -t "app plan" && pnpm --filter @airo/agents test:unit -t "re-roll"`
Expected: FAIL — `appPlanExecute` not called (route doesn't call it yet), and `updateCssColorPalette` called without `border`.

- [ ] **Step 4: Add the import to `design-kit.ts`**

Below the existing tool imports (after the `syncBrandTokensCss` import):

```typescript
import { appPlanTool } from '../../tools/app-plan-tool.js';
```

- [ ] **Step 5: Update the colours handler body**

Replace the body of `router.put('/apps/:id/design-kit/colors', ...)` between the workspace null-check and `res.json(...)` with:

```typescript
    const scope = workspaceScopeFromAppId(appId, customerId);
    // Determinism: reuse the previously derived border so generatePalette() does
    // not re-randomize it on each edit (muted is an explicit slot, already stable;
    // card is intentionally NOT pinned — it defaults to background and must follow
    // a background change).
    const prior = await memory.get(scope, 'brand.colors.palette');
    const priorBorder =
      prior.exists && prior.value && typeof prior.value === 'object'
        ? (prior.value as Record<string, unknown>).border
        : undefined;
    const paletteInput = typeof priorBorder === 'string' ? { ...palette, border: priorBorder } : palette;

    const result = await updateCssColorPalette(workspace.files, paletteInput);
    const stored = { name: typeof name === 'string' ? name : 'Custom', ...result.palette };
    await memory.set(scope, 'brand.colors.palette', stored);
    await syncBrandTokensCss(appId, customerId, workspace.files);

    // Mirror colorScheme: persist to the app plan too, so AppContextManager
    // (app-plan-first) hands the develop agent the edited palette at website build.
    try {
      await appPlanTool.execute({ appId, operation: 'update', colorPalette: stored });
    } catch (appPlanError) {
      logger.warn('designKit.colors.appPlan_failed', {
        appId,
        error: appPlanError instanceof Error ? appPlanError.message : String(appPlanError),
      });
    }

    res.json({ success: true, palette: stored });
```

(Note: this replaces the old `const workspace`-then-`updateCssColorPalette` lines that used `palette` directly and the inline `workspaceScopeFromAppId(appId, customerId)` call. Keep the existing `const workspace = createForWorkspace(...)` + 404 guard above this block.)

- [ ] **Step 6: Run the full route test file to verify pass + no regression**

Run: `fnm use 22 && pnpm --filter @airo/agents test:unit design-kit.test`
Expected: PASS — all existing tests plus the two new ones. (The existing "applies the palette, persists memory, syncs tokens" test still passes: `getMock` defaults to `exists:false`, so no border is pinned and `updateCssColorPalette` is still called.)

- [ ] **Step 7: Commit**

```bash
git add agents/src/server/routes/design-kit.ts agents/src/server/routes/__tests__/design-kit.test.ts
git commit -m "fix(design-kit): colours edit writes app-plan + pins prior border (no re-roll)"
```

---

## Task 2: Fonts route — persist pairing name + write app-plan

**Files:**
- Modify: `agents/src/server/routes/design-kit.ts` (the `PUT /apps/:id/design-kit/fonts` handler)
- Test: `agents/src/server/routes/__tests__/design-kit.test.ts`

(The `appPlanTool` import and the `appPlanExecute` mock were added in Task 1 — reuse them.)

- [ ] **Step 1: Write the failing tests (persisted name + app-plan write)**

Add these two tests inside the same `describe` block:

```typescript
  it('PUT fonts persists a synthesized pairing name in brand.typography', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Oswald', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(
      expect.anything(),
      'brand.typography',
      expect.objectContaining({ name: 'Oswald & Inter' }),
    );
  });

  it('PUT fonts persists the font theme to the app plan', async () => {
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Oswald', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(200);
    expect(appPlanExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app1234567',
        operation: 'update',
        fontTheme: expect.objectContaining({
          name: 'Oswald & Inter',
          headerFont: expect.objectContaining({ name: 'Oswald', weights: ['600'], category: 'sans-serif' }),
          bodyFont: expect.objectContaining({ name: 'Inter', weights: ['400'], category: 'sans-serif' }),
        }),
      }),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `fnm use 22 && pnpm --filter @airo/agents test:unit -t "synthesized pairing name" && pnpm --filter @airo/agents test:unit -t "font theme to the app plan"`
Expected: FAIL — `brand.typography` stored without `name`; `appPlanExecute` not called for fonts.

- [ ] **Step 3: Update the fonts handler body**

In `router.put('/apps/:id/design-kit/fonts', ...)`, replace the block from `await updateCssFontVariables(...)` through `res.json(...)` with:

```typescript
    await updateCssFontVariables(workspace.files, heading, body);
    const themeName = heading.name === body.name ? heading.name : `${heading.name} & ${body.name}`;
    const typography = {
      name: themeName,
      heading: { family: heading.name, weights: heading.weights ?? ['400', '700'] },
      body: { family: body.name, weights: body.weights ?? ['400'] },
    };
    await memory.set(workspaceScopeFromAppId(appId, customerId), 'brand.typography', typography);
    await syncBrandTokensCss(appId, customerId, workspace.files);

    // Mirror fontTheme: persist to the app plan too (AppContextManager is app-plan-first).
    try {
      await appPlanTool.execute({
        appId,
        operation: 'update',
        fontTheme: {
          name: themeName,
          headerFont: { name: heading.name, weights: heading.weights ?? ['400', '700'], category: heading.category ?? 'sans-serif' },
          bodyFont: { name: body.name, weights: body.weights ?? ['400'], category: body.category ?? 'sans-serif' },
        },
      });
    } catch (appPlanError) {
      logger.warn('designKit.fonts.appPlan_failed', {
        appId,
        error: appPlanError instanceof Error ? appPlanError.message : String(appPlanError),
      });
    }

    res.json({ success: true, typography });
```

- [ ] **Step 4: Run the full route test file to verify pass + no regression**

Run: `fnm use 22 && pnpm --filter @airo/agents test:unit design-kit.test`
Expected: PASS. The pre-existing "applies fonts, persists typography, syncs tokens" test still passes — it asserts `objectContaining({ heading: { family: 'Oswald', weights: ['600'] } })`, which the new shape still satisfies (extra `name` key is allowed by `objectContaining`).

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/routes/design-kit.ts agents/src/server/routes/__tests__/design-kit.test.ts
git commit -m "fix(design-kit): fonts edit persists pairing name + writes app-plan"
```

---

## Task 3: Client — dispatch `BRAND_DATA_UPDATED_EVENT` after a successful edit

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/design-kit-wizard/designKitApi.ts`
- Test: `app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/designKitApi.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/designKitApi.test.ts`:

```typescript
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAND_DATA_UPDATED_EVENT } from '@/hooks/useBrandData';
import { designKitApi } from '../designKitApi';

describe('designKitApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches BRAND_DATA_UPDATED_EVENT with the appId after a successful edit', async () => {
    const handler = vi.fn();
    window.addEventListener(BRAND_DATA_UPDATED_EVENT, handler);

    await designKitApi.setColors('app1234567', 'Indigo', { primary: '#3b5bdb', background: '#ffffff' });

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ appId: string }>;
    expect(event.detail.appId).toBe('app1234567');

    window.removeEventListener(BRAND_DATA_UPDATED_EVENT, handler);
  });

  it('does NOT dispatch the event when the request fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const handler = vi.fn();
    window.addEventListener(BRAND_DATA_UPDATED_EVENT, handler);

    await designKitApi.setImagery('app1234567', 'minimal');

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(BRAND_DATA_UPDATED_EVENT, handler);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter website test designKitApi`
Expected: FAIL — handler never called (the wrapper doesn't dispatch yet).

- [ ] **Step 3: Update `designKitApi.ts`**

Add the import at the top (below the file's doc comment / above the `FontChoice` interface):

```typescript
import { BRAND_DATA_UPDATED_EVENT } from '@/hooks/useBrandData';
```

Replace the `put` function with an async version that dispatches on success:

```typescript
async function put(appId: string, action: string, body: unknown): Promise<Response> {
  const res = await fetch(`/api/design-kit/${appId}/${action}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // On success, tell every useBrandData consumer (BrandBookView, AssemblingKit,
  // the summary/elements panels) to refetch — direct edits bypass the agent
  // tool_result path that normally fires this event.
  if (res.ok && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BRAND_DATA_UPDATED_EVENT, { detail: { appId } }));
  }
  return res;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter website test designKitApi`
Expected: PASS — both the success-dispatch and no-dispatch-on-failure tests.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/[market]/develop/components/preview/design-kit-wizard/designKitApi.ts" "app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/designKitApi.test.ts"
git commit -m "fix(design-kit): direct edits refresh all brand-data views via BRAND_DATA_UPDATED_EVENT"
```

---

## Task 4: Convergence — typecheck, lint, full test sweep

**Files:** none (verification only)

- [ ] **Step 1: Typecheck both packages**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter website typecheck`
Expected: no errors.

- [ ] **Step 2: Lint both packages**

Run: `pnpm --filter @airo/agents lint && pnpm --filter website lint`
Expected: no errors. (Watch for `prefer-const` / explicit-return guidance from the repo charter — the new code uses `const` throughout and annotated returns.)

- [ ] **Step 3: Full design-kit test sweep**

Run: `fnm use 22 && pnpm --filter @airo/agents test:unit design-kit && pnpm --filter website test design-kit-wizard`
Expected: all design-kit route tests and all design-kit-wizard client tests pass.

- [ ] **Step 4: Final commit (only if lint/format touched files)**

```bash
git add -A && git commit -m "chore(design-kit): lint/format after edit-propagation changes" || echo "nothing to commit"
```

---

## Self-Review Notes (verification of this plan against the spec)

- **Spec gap #1 (website-build staleness):** Task 1 (colours app-plan write) + Task 2 (fonts app-plan write). ✔
- **Spec gap #2 (font name dropped):** Task 2 persists `name` in `brand.typography` + app-plan `fontTheme`. ✔
- **Spec gap #4 (cross-component refresh):** Task 3 dispatches `BRAND_DATA_UPDATED_EVENT` from the shared `designKitApi` wrapper — covers colours, fonts, voice, imagery, summary uniformly. ✔
- **Spec: palette non-determinism:** Task 1 pins prior `border`; `card` deliberately left to re-derive. ✔
- **Spec out-of-scope:** No `AppContextManager` change, no shared agent-tool change, no memory-first refactor — none of the tasks touch those files. ✔
- **Type consistency:** `appPlanTool.execute` options (`{ appId, operation: 'update', colorPalette | fontTheme }`) match `AppPlanToolOptions`; `fontTheme` shape (`{ name, headerFont: {name,weights,category}, bodyFont: {...} }`) matches the `FontTheme` interface; `BRAND_DATA_UPDATED_EVENT` is the exported const from `@/hooks/useBrandData`. ✔
