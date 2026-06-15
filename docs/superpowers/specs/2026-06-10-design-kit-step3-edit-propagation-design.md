# Design Kit Wizard — Step-3 Edit Propagation

**Date:** 2026-06-10
**Branch:** `feat/design-kit-wizard`
**Status:** Approved (design), pending implementation plan

## Problem

In the Design Kit Wizard, Step 3 ("Design your visuals") lets the user directly
edit colours and fonts. Each edit flows through the thin direct-edit routes
(`PUT /apps/:id/design-kit/colors|fonts`), which reuse the same write functions
the agent generation tools use. Those edits mostly propagate — the website
`globals.css`, the brand-tokens token file, the brand-data read, and the live
iframe preview are all driven from the same memory keys (`brand.colors.palette`,
`brand.typography`). But four leaks remain where an edit does **not** fully reach
"the stored values, the UI, the website, and the tools that consume them":

1. **Website-build path reads stale data (highest impact).**
   `AppContextManager.getDesignSystemInfo()` prefers the **app-plan**
   (`colorPalette`/`fontTheme`) and only falls back to memory when app-plan is
   empty. The agent generation tools (`colorScheme`, `fontTheme`) write app-plan;
   the direct-edit routes do **not**. The agent populates app-plan during Step-2
   kit assembly, so a Step-3 edit updates memory while app-plan keeps the old
   values — and the develop agent builds the website from the **pre-edit**
   palette/fonts.

2. **Font edits drop the pairing name.** The fonts route stores
   `brand.typography` without `name`; the agent tool stores it with `name`. A
   manual font change blanks the pairing name shown in the UI (AssemblingKit,
   etc.).

3. **No cross-component UI refresh on edits.** `useBrandData` refetches on the
   `BRAND_DATA_UPDATED_EVENT` window event, but that event only fires from agent
   `tool_result`s (via `toolSideEffects`). The direct-edit REST PUTs don't
   dispatch it, so sibling views (BrandBookView, AssemblingKit, the
   summary/elements panels) don't live-update from an edit — only the editing
   panel's own optimistic local state does.

4. **Palette non-determinism.** The colours route passes the 5-slot UI palette to
   `updateCssColorPalette()`, which (since the input isn't a "complete" palette)
   runs `generatePalette()`. That function chooses the `border` (and `muted`)
   derivation strategy with `Math.random()`. `muted` is an explicit UI slot so
   it's preserved, but `border` is re-randomized on every keystroke-debounce, so
   the border colour visibly churns across edits.

### Already covered (no work needed)

The token-sync asymmetry initially suspected as a fifth gap is a non-issue:
`set-wizard-step.ts` re-runs `syncBrandTokensCss` from memory on the **step-4
reveal**, and the direct-edit routes sync eagerly. The showcase is therefore
never stale at reveal regardless of which path last touched colours/fonts.
Adding `syncBrandTokensCss` to the shared `colorScheme`/`fontTheme` agent tools
would only write an orphan `brand-tokens.css` into every non-wizard app (those
tools also serve the production develop agent), so it is explicitly **out of
scope**.

## Decisions

- **Source of truth for the website-build path:** edits **mirror the agent
  tools** — write memory *and* app-plan. The shared
  `AppContextManager.getDesignSystemInfo()` read order (app-plan-first) is **left
  unchanged**. This is the lowest-risk option: no change to the shared read path
  or the production develop agent; it keeps the dual-write that already exists
  rather than introducing a memory-first refactor.
- **Determinism:** fix locally in the colours route by preserving the previously
  derived `border` from the last stored palette, rather than making the shared
  `generatePalette()` globally deterministic (which would change behaviour for
  all agents). `border` is the only field chosen with `Math.random()` once the
  five UI slots (incl. `muted`) are supplied; `card` is left to re-derive (it
  defaults to `background`, so it must follow a background edit, not be frozen).
- **Font name:** the client sends no pairing name, so the fonts route synthesizes
  one: `heading.name === body.name ? heading.name : "${heading.name} & ${body.name}"`.

## Changes

### 1. `agents/src/server/routes/design-kit.ts` — colours route (`PUT /apps/:id/design-kit/colors`)

After the existing `updateCssColorPalette` + `memory.set('brand.colors.palette', stored)` + `syncBrandTokensCss`:

- **Determinism:** before calling `updateCssColorPalette`, read the prior
  `brand.colors.palette` from memory. If it exists, pass its `border` through as
  an explicit input alongside the user's 5 slots, so `generatePalette()` does not
  re-roll it. `card` is intentionally not pinned (it defaults to `background`, so
  it must follow a background edit). Foregrounds still recompute via the
  deterministic `ensureContrast`, so changing `background` still yields correct
  contrast.
- **App-plan write (gap #1):** call
  `appPlanTool.execute({ appId, operation: 'update', colorPalette: stored })`.
  `stored` already has every `ColorPalette` field (`{ name, ...result.palette }`),
  and `update` merges partials over the existing plan. Wrap in a non-fatal
  try/catch + `logger.warn` on failure, mirroring `colorScheme`.

### 2. `agents/src/server/routes/design-kit.ts` — fonts route (`PUT /apps/:id/design-kit/fonts`)

- **Persist the name (gap #2):** synthesize
  `themeName = heading.name === body.name ? heading.name : \`${heading.name} & ${body.name}\``
  and store `brand.typography` as
  `{ name: themeName, heading: { family, weights }, body: { family, weights } }`
  (currently no `name`).
- **App-plan write (gap #1):** call
  `appPlanTool.execute({ appId, operation: 'update', fontTheme: { name: themeName, headerFont: { name, weights, category }, bodyFont: { name, weights, category } } })`,
  built from the incoming `FontChoice`s (which carry `weights` + `category`).
  Non-fatal try/catch + `logger.warn`, mirroring `fontTheme`.

No `syncBrandTokensCss` change to the agent tools (see "Already covered").

### 3. Client — cross-component refresh (gap #4)

After each `designKitApi.*` PUT resolves successfully, dispatch
`window.dispatchEvent(new CustomEvent(BRAND_DATA_UPDATED_EVENT, { detail: { appId } }))`.
`useBrandData` already listens and refetches for the matching `appId`, so
BrandBookView, AssemblingKit, and the summary/elements panels live-update from an
edit, matching how agent tool results already trigger it.

Cleanest placement: a thin success-side helper. Either dispatch inside the
`designKitApi` wrapper (`put()` resolves → dispatch on `res.ok`, needs `appId` in
scope — it already is) or right after each `await` in the `DesignKitPanels`
handlers (`handleColorChange`'s debounced save, `applyFonts`, and the
voice/imagery/summary saves). Prefer the `designKitApi` wrapper so every edit
action is covered uniformly. `BRAND_DATA_UPDATED_EVENT` is exported from
`@/hooks/useBrandData`.

## Testing

- **`agents/src/server/routes/__tests__/design-kit.test.ts`:**
  - Colours: assert `appPlanTool.execute` called with `operation: 'update'` and a
    `colorPalette` carrying the edited primary; assert `border` is identical
    across two sequential edits that share the same 5-slot input (determinism).
  - Fonts: assert `brand.typography` is stored with a `name`; assert
    `appPlanTool.execute` called with a `fontTheme` whose `headerFont`/`bodyFont`
    match the request.
- **Client (jsdom):** assert `BRAND_DATA_UPDATED_EVENT` is dispatched (with the
  correct `appId` in `detail`) after a successful `designKitApi` edit.

## Out of scope (confirmed)

- No change to `AppContextManager` read order (stays app-plan-first).
- No change to the shared `colorScheme` / `fontTheme` agent tools.
- No memory-first / single-source-of-truth refactor.
- Other edit routes (voice, summary, imagery) gain only the gap-#4 event dispatch
  (via the shared `designKitApi` wrapper); their persistence is unchanged.

## Files touched

- `agents/src/server/routes/design-kit.ts`
- `agents/src/server/routes/__tests__/design-kit.test.ts`
- `app/src/app/[market]/develop/components/preview/design-kit-wizard/designKitApi.ts` (event dispatch)
- design-kit-wizard client test for the dispatch
