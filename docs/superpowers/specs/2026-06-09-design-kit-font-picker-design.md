# Design Kit Wizard — Hybrid Font Picker

**Date:** 2026-06-09
**Branch:** `feat/design-kit-wizard`
**Status:** Design — pending implementation plan

## Problem

The Design Kit Wizard's Fonts panel offers only a hard-coded list of 6 heading +
6 body fonts (`app/.../design-kit-wizard/fontOptions.ts`). That list exists purely
because the `website` package may not import from `@airo/agents`, so a subset of the
agents' `FONT_THEMES` was duplicated by hand.

This produces two problems:

1. **The dropdown lies about the system's real capability.** The rest of the product
   already lets users apply *any* Google Font: the `fontThemeAITool` (wired into both
   `InitialAgent` and `DevelopAgent`) validates arbitrary fonts against the live Google
   Fonts API (`validateGoogleFontUrl`) and applies them. The wizard's direct-edit route
   `PUT /apps/:id/design-kit/fonts` applies whatever font it's handed with **no
   restriction at all**. The 6-font dropdown is the only artificial cap in the whole
   system.
2. **Three independent font sources drift apart:** the app's `fontOptions.ts` (6+6),
   the agents' `FONT_THEMES` (4 curated pairings), and the unbounded Google Fonts
   universe reachable via the agent.

## Goal

Replace the hard-coded dropdown with a **hybrid picker**: a curated shortlist of
pairings (the existing `FONT_THEMES`) for the common case, plus the ability to search
and apply **any Google Font**. Loading must be **dynamic** — never mount or fetch
1,800 font faces at once.

## Non-Goals

- No change to how the agent applies fonts (`fontThemeAITool` logic is untouched).
- No change to how generated apps load fonts (still `@import` in `globals.css`).
- No live Google Fonts Developer API dependency at runtime (see Decision 1).

## Decisions

### Decision 1 — Catalog source: bundled, generated offline from keyless GitHub/GF sources (REVISED — no API key)

The catalog is generated **offline** by a committed script and baked into `@airo/shared`
as a `.ts` module, imported at runtime via dynamic `import()` (no runtime fetch, no
secret). **The script uses no API key** — it reads two keyless sources:

1. **`https://fonts.google.com/metadata/fonts`** (clean JSON, ~1,936 families) →
   `family`, human-readable `category` ("Sans Serif"/"Serif"/"Display"/"Handwriting"/
   "Monospace"), and a `fonts` map whose numeric keys give the available weights.
2. **`https://raw.githubusercontent.com/google/fonts/main/tags/all/families.csv`**
   (1,929 families, `Family, axis, /Group/Tag, score`) → the discovery tags (Decision 4).

The script joins them by family. Category maps to our `FontCategory` union
(Sans Serif→sans-serif, Serif→serif, Monospace→monospace, Handwriting→cursive,
Display→sans-serif). Weights are normalized to the intersection of the family's available
numeric weights with the preferred set `['300','400','500','600','700']`, always
including `'400'` (keeps imports lean and apply-time validation safe). Still
**self-correcting**: a stale entry that 404s is caught by validation (Decision 3).

Rejected: keyed Developer API (needs a provisioned secret); per-family `METADATA.pb`
fetches (~1,900 requests + protobuf parsing) — the metadata endpoint gives the same
weights in one request.

**Refresh:** manual — re-run the (now keyless) script. No CI/scheduled refresh.

### Decision 2 — Curated pairings live in `@airo/shared`

`FONT_THEMES` moves out of `agents/src/tools/ai-lib-tools/font-theme.ts` into a new
`@airo/shared/fonts` subpath. Both agents and app import the same constant. This is the
single source of truth that ends the drift.

### Decision 3 — `/design-kit/fonts` route gains validation (in scope)

Today the direct-edit route applies fonts with no validation, unlike the agent path.
We add best-effort validation reusing the existing logic so a stale-catalog or
bad-weight selection fails cleanly instead of silently writing a broken `@import`.

## Architecture

### New shared module: `@airo/shared/fonts`

```
packages/shared/src/fonts/
  index.ts                     # exports FONT_THEMES, types, loadGoogleFontsCatalog()
  font-themes.ts               # FONT_THEMES (moved verbatim from agents)
  google-fonts-catalog.json    # generated; { family, category, weights }[]
  types.ts                     # FontInfo, FontPairing, GoogleFontEntry
```

Exports:

- `FONT_THEMES: Record<string, FontPairing>` — the 4 curated pairings, shape unchanged
  (including the unused legacy `font?` field, to keep agent code identical).
- `loadGoogleFontsCatalog(): Promise<GoogleFontEntry[]>` — `async () => (await import('./google-fonts-catalog.json')).default`.
  Dynamic so the ~200 KB JSON only enters the bundle when the picker's search is opened.
- Types: `FontInfo { name; weights: string[]; category }`, `GoogleFontEntry { family; category; weights }`,
  `FontPairing { id?; name; description; headerFont: FontInfo; bodyFont: FontInfo }`.

`packages/shared/package.json` `exports` map gains `./fonts` →
`./dist/fonts/index.js` (+ types), matching the existing subpath pattern. The build
must copy `google-fonts-catalog.json` into `dist/fonts/` (tsc does not copy JSON —
add a copy step to the shared package build, consistent with how other assets are
handled, or import via a `.ts` module that inlines it if a copy step is undesirable).

### Agents side

- `font-theme.ts` deletes its local `FONT_THEMES` definition and does
  `import { FONT_THEMES } from '@airo/shared/fonts'` (re-export if other modules import
  it from `font-theme.ts`). All apply/suggest/set logic is otherwise unchanged.
- Export `validateGoogleFontUrl` (currently private) — or add a thin
  `validateFontPairing(header, body): Promise<{ valid; networkError }>` wrapper that
  builds the URL via the already-exported `buildGoogleFontsUrl` and validates it.
  Preferred: the wrapper, so the route doesn't reconstruct URL-building.

### Route: `PUT /apps/:id/design-kit/fonts` (`agents/src/server/routes/design-kit.ts`)

After the existing `heading.name`/`body.name` presence check, before
`updateCssFontVariables`:

- Call the validation wrapper. On a definitive **invalid** result (font/weight not on
  Google Fonts), return `400` with a clear message. On a **network error**, log and
  **proceed** (don't block the user on a transient Google Fonts outage) — apply anyway,
  matching the spirit of best-effort. Reuse the existing `fontValidationCache` so this
  doesn't add latency for repeat selections.

### App side — Fonts panel

`app/.../design-kit-wizard/`:

- **Delete** `fontOptions.ts`.
- `DesignKitPanels.tsx` / a new `FontPicker.tsx`:
  - **Pairings tier:** render the 4 `FONT_THEMES` as one-click chips; clicking applies
    heading **and** body together (passes each font's real `weights`).
  - **Heading & Body comboboxes:** searchable inputs. Empty/initial state lists the
    curated fonts (derived from `FONT_THEMES`); on first focus/typing,
    `loadGoogleFontsCatalog()` is awaited (once, memoized) and the full catalog filters
    by query.
  - **Windowing:** render only the visible slice (~12 rows + buffer) computed from
    scroll offset against a fixed row height. Hand-rolled helper unless UXCore ships a
    suitable combobox/virtual-list (check `uxcore-llm.txt` during implementation; prefer
    reuse).
  - **Lazy font faces:** replace the current load-everything `useGoogleFonts`. An
    `IntersectionObserver` per rendered row collects families entering the viewport,
    debounces (~100 ms), and injects one batched `<link>` for that batch at `wght@400;600`
    so each option previews in its own face. A module/ref `Set` dedupes already-requested
    families.

### Data flow (unchanged downstream)

```
FontPicker selection (font + catalog weights)
  → designKitApi.setFonts(appId, heading, body)        [unchanged client]
  → PUT /api/design-kit/:appId/fonts                   [unchanged BFF proxy]
  → PUT /apps/:id/design-kit/fonts                     [+ validation, this spec]
  → updateCssFontVariables(...)                        [unchanged]
  → memory brand.typography + syncBrandTokensCss       [unchanged]
```

This also fixes the existing weight bug: `applyFonts` currently hard-codes
`['600','700']`/`['400']` for off-list fonts; with the catalog we pass each font's real
weights.

### Catalog generation script

`scripts/gen-google-fonts-catalog.ts` (or `packages/shared/scripts/`):

- Reads a Google Fonts API key from an env var (`GOOGLE_FONTS_API_KEY`) supplied **only
  when running the script locally** — never required at app/agents runtime.
- Fetches `https://www.googleapis.com/webfonts/v1/webfonts?key=...&sort=popularity`.
- Maps to `{ family, category, weights }` (weights derived from `variants`, numeric only,
  e.g. `regular`→`400`, `700italic` excluded or normalized — implementation detail).
- Writes `packages/shared/src/fonts/google-fonts-catalog.json`.
- Documented in a short README note next to the script (how to refresh).

## Testing

- **Shared:** `loadGoogleFontsCatalog()` returns a non-empty, well-shaped array;
  `FONT_THEMES` exported and matches the prior agent shape (snapshot/shape assertions).
- **Agents route:** `PUT /design-kit/fonts` — valid font → 200 + applies; invalid
  font → 400 + does not write; network error → applies + logs (mock `fetch`/validation).
  Reuse existing route test harness in `routes/__tests__`.
- **App picker:** pairing chip applies both fonts with correct weights; searching filters
  catalog; off-list font applies with its catalog weights (regression for the
  `['600','700']` bug); windowing renders a bounded number of rows; lazy loader injects a
  face per visible batch and dedupes. (`@vitest-environment jsdom`,
  `@testing-library/react`.)
- **Agent regression:** existing `font-theme` tests still pass after the `FONT_THEMES`
  move (no logic change).

## Files Touched

**New**
- `packages/shared/src/fonts/{index.ts,font-themes.ts,types.ts,google-fonts-catalog.json}`
- `scripts/gen-google-fonts-catalog.ts` (+ README note)
- `app/.../design-kit-wizard/FontPicker.tsx` (if extracted)

**Modified**
- `packages/shared/package.json` (exports map + build JSON copy)
- `agents/src/tools/ai-lib-tools/font-theme.ts` (import `FONT_THEMES` from shared; export validation wrapper)
- `agents/src/server/routes/design-kit.ts` (`/fonts` validation)
- `app/.../design-kit-wizard/DesignKitPanels.tsx` (FontsPanel → hybrid picker; remove load-everything `useGoogleFonts`)
- Affected tests in `agents/.../__tests__` and `app/.../design-kit-wizard/__tests__`

**Deleted**
- `app/.../design-kit-wizard/fontOptions.ts`

## Risks & Mitigations

- **Bundle weight:** catalog JSON (~200 KB) — mitigated by dynamic `import()` (loads only
  when search is opened).
- **Stale catalog:** mitigated by apply-time validation (Decision 3) + manual refresh script.
- **`@airo/shared` JSON in two build targets (Node + Next webpack):** verify the JSON
  resolves in both; the dynamic-import pattern and an explicit `dist` copy step keep it
  portable. Confirm during implementation that the agent build (which doesn't need the
  catalog, only `FONT_THEMES`) doesn't pull the JSON into its graph unnecessarily — keep
  `font-themes.ts` and the catalog in separate modules so agent imports stay lean.

---

## Slice 2 — Google Fonts tag filters (added 2026-06-09)

**Goal:** Let users narrow the font search by Google Fonts' own discovery tags
(Feeling, Appearance, Calligraphy, Serif, Sans-Serif), as seen in the fonts.google.com
sidebar.

### Decision 4 — Tag data source: the `google/fonts` repo CSV (not the API)

The official Google Fonts Developer API does **not** expose these tags — it returns only
the 5 coarse categories. Google publishes the full taxonomy publicly at
`https://raw.githubusercontent.com/google/fonts/main/tags/all/families.csv`
(rows: `Family, axis, /Group/Tag, score(0–100)`, no key required). The generation script
fetches this CSV alongside the keyless `metadata/fonts` endpoint (Decision 1) and bakes
tags into the catalog — offline only, no new runtime dependency.

**Group → UI-label mapping** (CSV groups are relabelled to match the GF UI; other groups
— `Purpose`, `Quality`, `Seasonal`, `Special use` — are dropped):

| CSV group | UI label |
|---|---|
| `Expressive` | Feeling |
| `Theme`, `Monospace` | Appearance |
| `Script` | Calligraphy |
| `Serif`, `Slab` | Serif |
| `Sans` | Sans Serif |

Each kept tag is stored as `"<UILabel>/<Tag>"` (e.g. `"Feeling/Calm"`,
`"Appearance/Stencil"`, `"Serif/Slab"`). Only tags with **score ≥ `TAG_SCORE_THRESHOLD`
(default 50, tunable in the script)** are kept, so a font is tagged only where the
association is meaningful. The exact chip set is therefore data-driven from the CSV.

### Data model

`GoogleFontEntry` gains an optional `tags?: string[]` field (canonical `"Group/Tag"`
strings). Curated `FONT_THEMES` fonts are unaffected (tags are a catalog-only concern).

### UI

Inside the open search dropdown, a **`Filters ▾` toggle** reveals collapsible tag groups
(one per UI label) above the windowed list. Selecting tags filters the list with
**OR within a group, AND across groups**. A small "N selected / Clear" affordance resets
them. The windowing + lazy-face logic from Slice 1 is unchanged; filtering simply narrows
the `filtered` array before windowing.

### Testing (Slice 2)

- Script/shape: catalog entries carry `tags` of the form `"Group/Tag"`; curated families
  still resolve with their hand-tuned weights.
- Picker: a pure `filterByTags(entries, selected)` helper implements OR-within/AND-across
  (unit-tested); selecting a Feeling tag narrows the visible list; clearing restores it.

### Sequencing note

Slice 2 reworks the just-shipped `FontPicker`, so its picker tests are written after the
filter UI lands (avoids writing them twice).
