# Design Kit Wizard Hybrid Font Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Design Kit Wizard's 6-font hard-coded dropdown with a hybrid picker — curated `FONT_THEMES` pairings plus searchable access to the full Google Fonts catalog, with lazy font-face loading.

**Architecture:** A new `@airo/shared/fonts` module becomes the single source of truth: it holds `FONT_THEMES` (moved out of the agents service) and a generated `google-fonts-catalog` module loaded via dynamic `import()`. The agents `/design-kit/fonts` route gains apply-time Google Fonts validation. The app's Fonts panel renders pairing chips + searchable, windowed comboboxes that lazily load only the font faces currently visible.

**Tech Stack:** TypeScript, `@airo/shared` (tsc build), Express + supertest + Vitest (agents), React + Vitest/jsdom + Testing Library (app/website), Google Fonts CSS2 + Developer APIs.

**Spec:** `docs/superpowers/specs/2026-06-09-design-kit-font-picker-design.md`

**Key plan-level refinement vs spec:** the catalog is generated as a **`.ts` module** (`google-fonts-catalog.ts` exporting a `const` array), not a `.json` file. Reason: the shared package builds with plain `tsc`, which does **not** copy `.json` into `dist/` — a committed `.json` would be missing at runtime. A `.ts` module compiles to JS, is always present in `dist`, resolves in both the Node (agents) and webpack (app) build targets, and still code-splits under dynamic `import()`.

---

## File Structure

**New files**
- `packages/shared/src/fonts/types.ts` — `FontCategory`, `FontInfo`, `FontPairing`, `GoogleFontEntry`.
- `packages/shared/src/fonts/font-themes.ts` — `FONT_THEMES` (moved verbatim from agents).
- `packages/shared/src/fonts/google-fonts-catalog.ts` — generated `const GOOGLE_FONTS_CATALOG: GoogleFontEntry[]`.
- `packages/shared/src/fonts/index.ts` — re-exports types + `FONT_THEMES`; exports `loadGoogleFontsCatalog()`.
- `packages/shared/src/fonts/__tests__/fonts.test.ts` — shape tests.
- `packages/shared/scripts/gen-google-fonts-catalog.mjs` — manual refresh script (+ usage note).
- `app/src/app/[market]/develop/components/preview/design-kit-wizard/useLazyFontFaces.ts` — lazy per-batch font-face loader hook.
- `app/.../design-kit-wizard/FontPicker.tsx` — pairings chips + heading/body comboboxes.
- `app/.../design-kit-wizard/__tests__/FontPicker.test.tsx` — picker behavior tests.

**Modified files**
- `packages/shared/package.json` — add `./fonts` to `exports`.
- `agents/src/tools/ai-lib-tools/font-theme.ts` — delete local `FONT_THEMES`, import from shared; export `validateFontPairing`.
- `agents/src/server/routes/design-kit.ts` — add validation to `PUT /apps/:id/design-kit/fonts`.
- `agents/src/server/routes/__tests__/design-kit.test.ts` — extend fonts mock + tests.
- `app/.../design-kit-wizard/DesignKitPanels.tsx` — `FontsPanel` uses `FontPicker`; remove load-everything `useGoogleFonts`.
- `app/.../design-kit-wizard/__tests__/FontsPanel.test.tsx` — update for new picker.

**Deleted files**
- `app/.../design-kit-wizard/fontOptions.ts`

---

## Task 1: Shared fonts module — types + `FONT_THEMES` moved from agents

**Files:**
- Create: `packages/shared/src/fonts/types.ts`
- Create: `packages/shared/src/fonts/font-themes.ts`
- Create: `packages/shared/src/fonts/index.ts`
- Create: `packages/shared/src/fonts/__tests__/fonts.test.ts`
- Modify: `packages/shared/package.json` (exports map)
- Modify: `agents/src/tools/ai-lib-tools/font-theme.ts:541-619` (remove local `FONT_THEMES`, import it)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/fonts/__tests__/fonts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FONT_THEMES, type FontPairing } from '../index.js';

describe('@airo/shared/fonts FONT_THEMES', () => {
  it('exposes the four curated pairings with header+body fonts', () => {
    const ids = Object.keys(FONT_THEMES);
    expect(ids).toEqual(
      expect.arrayContaining([
        'modern-professional',
        'elegant-serif',
        'bold-modern',
        'classic-formal',
      ]),
    );
    for (const id of ids) {
      const theme: FontPairing = FONT_THEMES[id]!;
      expect(theme.name).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(theme.headerFont.name).toBeTruthy();
      expect(Array.isArray(theme.headerFont.weights)).toBe(true);
      expect(theme.bodyFont.name).toBeTruthy();
      expect(Array.isArray(theme.bodyFont.weights)).toBe(true);
    }
  });

  it('preserves the modern-professional pairing values', () => {
    expect(FONT_THEMES['modern-professional']!.headerFont.name).toBe('Montserrat');
    expect(FONT_THEMES['modern-professional']!.bodyFont.name).toBe('Inter');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/shared test "fonts"`
Expected: FAIL — cannot resolve `../index.js` / module does not exist.

- [ ] **Step 3: Create the types module**

Create `packages/shared/src/fonts/types.ts`:

```typescript
export type FontCategory = 'serif' | 'sans-serif' | 'monospace' | 'cursive' | 'fantasy';

export interface FontInfo {
  name: string;
  weights: string[];
  category: FontCategory;
}

/** A curated heading+body pairing. */
export interface FontPairing {
  name: string;
  description: string;
  headerFont: FontInfo;
  bodyFont: FontInfo;
  /** Legacy single-font field kept for backwards compatibility; unused by current themes. */
  font?: {
    name: string;
    weights: string[];
    category: FontCategory;
    fallback: string;
    googleFontsUrl: string;
  };
}

/** One entry in the bundled Google Fonts catalog (for the searchable picker). */
export interface GoogleFontEntry {
  family: string;
  category: FontCategory;
  weights: string[];
}
```

- [ ] **Step 4: Create the font-themes module (moved verbatim from agents)**

Create `packages/shared/src/fonts/font-themes.ts`:

```typescript
import type { FontPairing } from './types.js';

/**
 * Professional font theme presets for websites with header/body pairings.
 * Single source of truth — imported by both the agents service and the app.
 */
export const FONT_THEMES: Record<string, FontPairing> = {
  'modern-professional': {
    name: 'Modern Professional',
    description: 'Clean sans-serif pairing. Perfect for tech, SaaS, and corporate sites.',
    headerFont: { name: 'Montserrat', weights: ['600', '700'], category: 'sans-serif' },
    bodyFont: { name: 'Inter', weights: ['400', '500', '600'], category: 'sans-serif' },
  },
  'elegant-serif': {
    name: 'Elegant Serif',
    description: 'Sophisticated serif pairing. Ideal for publishing, blogs, and editorial.',
    headerFont: { name: 'Playfair Display', weights: ['600', '700'], category: 'serif' },
    bodyFont: { name: 'Lora', weights: ['400', '500', '600'], category: 'serif' },
  },
  'bold-modern': {
    name: 'Bold Modern',
    description: 'Strong geometric headers with readable body. Great for agencies and portfolios.',
    headerFont: { name: 'Bebas Neue', weights: ['400'], category: 'sans-serif' },
    bodyFont: { name: 'Work Sans', weights: ['400', '500', '600'], category: 'sans-serif' },
  },
  'classic-formal': {
    name: 'Classic Formal',
    description: 'Traditional serif headers with clean body. Excellent for law, finance, luxury.',
    headerFont: { name: 'Merriweather', weights: ['700', '900'], category: 'serif' },
    bodyFont: { name: 'Source Sans 3', weights: ['400', '500', '600'], category: 'sans-serif' },
  },
};
```

- [ ] **Step 5: Create the index (catalog loader added in Task 2)**

Create `packages/shared/src/fonts/index.ts`:

```typescript
export type { FontCategory, FontInfo, FontPairing, GoogleFontEntry } from './types.js';
export { FONT_THEMES } from './font-themes.js';
```

- [ ] **Step 6: Add the `./fonts` subpath to the shared exports map**

Modify `packages/shared/package.json` — add this entry to the `exports` object (after the `./brand-data` block, matching the existing pattern):

```json
    "./fonts": {
      "types": "./dist/fonts/index.d.ts",
      "import": "./dist/fonts/index.js"
    },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @airo/shared test "fonts"`
Expected: PASS (both tests).

- [ ] **Step 8: Point the agents service at the shared `FONT_THEMES`**

In `agents/src/tools/ai-lib-tools/font-theme.ts`: delete the entire local `export const FONT_THEMES: Record<...> = { ... }` block (currently `:541-619`). Add to the imports at the top of the file:

```typescript
import { FONT_THEMES } from '@airo/shared/fonts'
```

Keep the local `FontCategory` type alias as-is (it is the same union as shared's, so the imported `FONT_THEMES` values remain assignable). Do not change any other logic in the file.

- [ ] **Step 9: Verify agents typecheck + existing font tests still pass**

Run: `pnpm --filter @airo/agents typecheck`
Expected: no errors.
Run: `pnpm --filter @airo/agents test:unit "font-theme"`
Expected: PASS (logic unchanged; `FONT_THEMES` now sourced from shared).

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/fonts packages/shared/package.json agents/src/tools/ai-lib-tools/font-theme.ts
git commit -m "feat(shared): move FONT_THEMES into @airo/shared/fonts as single source of truth"
```

---

## Task 2: Generated catalog module + `loadGoogleFontsCatalog()`

**Files:**
- Create: `packages/shared/scripts/gen-google-fonts-catalog.mjs`
- Create: `packages/shared/src/fonts/google-fonts-catalog.ts` (script output, committed)
- Modify: `packages/shared/src/fonts/index.ts` (add loader)
- Modify: `packages/shared/src/fonts/__tests__/fonts.test.ts` (loader test)

- [ ] **Step 1: Write the generation script**

Create `packages/shared/scripts/gen-google-fonts-catalog.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Regenerate src/fonts/google-fonts-catalog.ts from the Google Fonts Developer API.
 *
 * Usage:
 *   GOOGLE_FONTS_API_KEY=xxxx node packages/shared/scripts/gen-google-fonts-catalog.mjs
 *
 * The API key is needed ONLY to run this script (get a free key at
 * https://console.cloud.google.com/ → enable "Web Fonts Developer API").
 * It is never required at app/agents runtime — the committed .ts file is the artifact.
 * Re-run manually whenever you want to refresh the catalog.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.GOOGLE_FONTS_API_KEY;
if (!KEY) {
  console.error('GOOGLE_FONTS_API_KEY is required. See script header.');
  process.exit(1);
}

const ALLOWED = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']);

/** Map a Google "variants" entry (e.g. "regular", "500", "700italic") to a numeric weight or null. */
function variantToWeight(variant) {
  if (variant === 'regular' || variant === 'italic') return '400';
  const m = variant.match(/^(\d{3})(italic)?$/);
  return m ? m[1] : null;
}

const url = `https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=${KEY}`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`Google Fonts API error: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const { items } = await res.json();

const catalog = items.map((item) => {
  const category = ALLOWED.has(item.category) ? item.category : 'sans-serif';
  const weights = [...new Set((item.variants ?? []).map(variantToWeight).filter(Boolean))].sort();
  return { family: item.family, category, weights: weights.length ? weights : ['400'] };
});

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '../src/fonts/google-fonts-catalog.ts');
const header = `// AUTO-GENERATED by scripts/gen-google-fonts-catalog.mjs — do not edit by hand.\n` +
  `// Refresh: GOOGLE_FONTS_API_KEY=xxx node packages/shared/scripts/gen-google-fonts-catalog.mjs\n` +
  `import type { GoogleFontEntry } from './types.js';\n\n` +
  `export const GOOGLE_FONTS_CATALOG: GoogleFontEntry[] = `;
await writeFile(outPath, `${header}${JSON.stringify(catalog, null, 2)};\n`, 'utf8');
console.log(`Wrote ${catalog.length} fonts to ${outPath}`);
```

- [ ] **Step 2: Run the script to generate the committed catalog**

Run: `GOOGLE_FONTS_API_KEY=<your-key> node packages/shared/scripts/gen-google-fonts-catalog.mjs`
Expected: console prints `Wrote <~1800> fonts to .../google-fonts-catalog.ts`, and `packages/shared/src/fonts/google-fonts-catalog.ts` now exists with a large `GOOGLE_FONTS_CATALOG` array.

If you do not have a key yet: create a Google Cloud project, enable the "Web Fonts Developer API", create an API key (no billing required — this API is free), then re-run. Do not hand-author the catalog file.

- [ ] **Step 3: Add the loader test**

Append to `packages/shared/src/fonts/__tests__/fonts.test.ts`:

```typescript
import { loadGoogleFontsCatalog } from '../index.js';

describe('loadGoogleFontsCatalog', () => {
  it('lazily resolves a non-empty, well-shaped catalog', async () => {
    const catalog = await loadGoogleFontsCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThan(100);
    const first = catalog[0]!;
    expect(typeof first.family).toBe('string');
    expect(Array.isArray(first.weights)).toBe(true);
    expect(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']).toContain(first.category);
  });

  it('returns the same array instance on repeat calls (memoized)', async () => {
    const a = await loadGoogleFontsCatalog();
    const b = await loadGoogleFontsCatalog();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @airo/shared test "fonts"`
Expected: FAIL — `loadGoogleFontsCatalog` is not exported.

- [ ] **Step 5: Add the memoized dynamic loader to the index**

Modify `packages/shared/src/fonts/index.ts` to append:

```typescript
import type { GoogleFontEntry } from './types.js';

let catalogPromise: Promise<GoogleFontEntry[]> | null = null;

/**
 * Lazily load the full Google Fonts catalog via dynamic import so the ~200 KB
 * module is only pulled into the bundle when a caller actually needs it (e.g.
 * when the user opens the font search). Memoized for the process/page lifetime.
 */
export function loadGoogleFontsCatalog(): Promise<GoogleFontEntry[]> {
  if (!catalogPromise) {
    catalogPromise = import('./google-fonts-catalog.js').then((m) => m.GOOGLE_FONTS_CATALOG);
  }
  return catalogPromise;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @airo/shared test "fonts"`
Expected: PASS (all four tests).

- [ ] **Step 7: Verify the shared package builds (catalog lands in dist)**

Run: `pnpm --filter @airo/shared build`
Expected: success; `packages/shared/dist/fonts/google-fonts-catalog.js` exists.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/scripts packages/shared/src/fonts
git commit -m "feat(shared): add generated Google Fonts catalog + lazy loader"
```

---

## Task 3: Apply-time validation on `PUT /apps/:id/design-kit/fonts`

**Files:**
- Modify: `agents/src/tools/ai-lib-tools/font-theme.ts` (export `validateFontPairing`)
- Modify: `agents/src/server/routes/design-kit.ts:50-70`
- Modify: `agents/src/server/routes/__tests__/design-kit.test.ts:36-39` (mock) + new tests

- [ ] **Step 1: Export a validation wrapper from font-theme.ts**

In `agents/src/tools/ai-lib-tools/font-theme.ts`, add this exported function (place it just after `validateGoogleFontUrl` / `validateAndFilterFonts`, reusing the existing `buildGoogleFontsUrl`, `validateGoogleFontUrl`, and `fontValidationCache`):

```typescript
/**
 * Validate a heading+body pairing against the live Google Fonts API.
 * Reuses the module's URL builder, HTTP validator, and LRU cache so repeat
 * selections are free. Returns the same shape as validateGoogleFontUrl.
 */
export async function validateFontPairing(
  headerFont: { name: string; weights?: string[] },
  bodyFont: { name: string; weights?: string[] }
): Promise<{ valid: boolean; networkError: boolean }> {
  const url = buildGoogleFontsUrl([
    { name: headerFont.name, weights: headerFont.weights ?? ['400', '700'] },
    { name: bodyFont.name, weights: bodyFont.weights ?? ['400'] }
  ])

  const cached = fontValidationCache.get(url)
  if (cached !== undefined) {
    return { valid: cached, networkError: false }
  }

  const result = await validateGoogleFontUrl(url, `${headerFont.name} / ${bodyFont.name}`)
  if (!result.networkError) {
    fontValidationCache.set(url, result.valid)
  }
  return result
}
```

- [ ] **Step 2: Update the test mock so the existing fonts route test still wires up**

In `agents/src/server/routes/__tests__/design-kit.test.ts`, extend the `vi.hoisted` block (`:8-21`) to include a `validateFontPairing` mock fn that defaults to valid:

```typescript
  const { setMock, getMock, filesWrite, updateCssColorPalette, updateCssFontVariables, syncBrandTokensCss, validateFontPairing, emitToApp } =
    vi.hoisted(() => ({
      setMock: vi.fn(async () => ({ success: true })),
      getMock: vi.fn(async () => ({ success: true, exists: false })),
      filesWrite: vi.fn(async () => ({ bytesWritten: 1 })),
      updateCssColorPalette: vi.fn(async () => ({
        success: true,
        palette: { primary: '#3b5bdb', background: '#ffffff' },
        message: 'ok',
      })),
      updateCssFontVariables: vi.fn(async () => ({ success: true, message: 'ok' })),
      syncBrandTokensCss: vi.fn(async () => undefined),
      validateFontPairing: vi.fn(async () => ({ valid: true, networkError: false })),
      emitToApp: vi.fn(),
    }));
```

Then add `validateFontPairing` to the `font-theme.js` mock (`:36-39`):

```typescript
vi.mock('../../../tools/ai-lib-tools/font-theme.js', () => ({
  updateCssFontVariables,
  buildGoogleFontsUrl: () => 'https://fonts.googleapis.com/css2?family=Inter&display=swap',
  validateFontPairing,
}));
```

And clear it in `beforeEach` (`:77-86`): add `validateFontPairing.mockClear(); validateFontPairing.mockResolvedValue({ valid: true, networkError: false } as never);`

- [ ] **Step 3: Write the failing tests for validation behavior**

Add these tests inside the `describe('design-kit direct-edit routes', ...)` block in `design-kit.test.ts`:

```typescript
  it('PUT fonts returns 400 and does not apply when the pairing is invalid', async () => {
    validateFontPairing.mockResolvedValueOnce({ valid: false, networkError: false } as never);
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Notafont', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(400);
    expect(updateCssFontVariables).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('PUT fonts applies anyway when validation hits a network error (best-effort)', async () => {
    validateFontPairing.mockResolvedValueOnce({ valid: false, networkError: true } as never);
    const res = await request(makeApp())
      .put('/apps/app1234567/design-kit/fonts')
      .send({
        heading: { name: 'Oswald', weights: ['600'], category: 'sans-serif' },
        body: { name: 'Inter', weights: ['400'], category: 'sans-serif' },
      });

    expect(res.status).toBe(200);
    expect(updateCssFontVariables).toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit "design-kit"`
Expected: FAIL — the route does not yet call `validateFontPairing`, so the invalid case returns 200 instead of 400.

- [ ] **Step 5: Add validation to the route**

In `agents/src/server/routes/design-kit.ts`, update the import at `:16` to also pull in the wrapper:

```typescript
import { updateCssFontVariables, validateFontPairing } from '../../tools/ai-lib-tools/font-theme.js';
```

Then in the `/apps/:id/design-kit/fonts` handler, insert validation right after the `heading.name`/`body.name` presence check (`:55`) and before `createForWorkspace` (`:56`):

```typescript
    const validation = await validateFontPairing(heading, body);
    if (!validation.valid && !validation.networkError) {
      res.status(400).json({ error: `"${heading.name}" / "${body.name}" not found on Google Fonts or uses unsupported weights` });
      return;
    }
    if (validation.networkError) {
      logger.warn('designKit.fonts.validation_network_error', { appId, heading: heading.name, body: body.name });
    }
```

(Best-effort: a definitive invalid pairing is rejected; a transient network error logs and proceeds to apply.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "design-kit"`
Expected: PASS — including the pre-existing fonts tests (validation defaults to valid) and the two new tests.

- [ ] **Step 7: Verify agents typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add agents/src/tools/ai-lib-tools/font-theme.ts agents/src/server/routes/design-kit.ts agents/src/server/routes/__tests__/design-kit.test.ts
git commit -m "feat(agents): validate font pairings on the design-kit /fonts direct-edit route"
```

---

## Task 4: Lazy font-face loader (app)

Replaces today's `useGoogleFonts` (which injects one `<link>` for the entire list) with an on-demand loader that injects faces only for families as they become visible, deduping so the same family is never requested twice.

**Files:**
- Create: `app/src/app/[market]/develop/components/preview/design-kit-wizard/useLazyFontFaces.ts`
- Create: `app/.../design-kit-wizard/__tests__/useLazyFontFaces.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/.../design-kit-wizard/__tests__/useLazyFontFaces.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureFontFacesLoaded } from '../useLazyFontFaces';

function linkHrefs(): string[] {
  return Array.from(document.head.querySelectorAll('link[data-design-kit-font]')).map(
    (l) => (l as HTMLLinkElement).href,
  );
}

describe('ensureFontFacesLoaded', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('injects a stylesheet link for newly requested families', () => {
    const registry = new Set<string>();
    ensureFontFacesLoaded(['Inter', 'Lora'], registry);
    const hrefs = linkHrefs();
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toContain('family=Inter');
    expect(hrefs[0]).toContain('family=Lora');
    expect(hrefs[0]).toContain('display=swap');
  });

  it('encodes spaces in family names as "+"', () => {
    ensureFontFacesLoaded(['Playfair Display'], new Set<string>());
    expect(linkHrefs()[0]).toContain('family=Playfair+Display');
  });

  it('does not re-request families already in the registry', () => {
    const registry = new Set<string>();
    ensureFontFacesLoaded(['Inter'], registry);
    ensureFontFacesLoaded(['Inter'], registry); // already loaded
    expect(linkHrefs()).toHaveLength(1);
  });

  it('only requests the new families on a second call', () => {
    const registry = new Set<string>();
    ensureFontFacesLoaded(['Inter'], registry);
    ensureFontFacesLoaded(['Inter', 'Oswald'], registry);
    const hrefs = linkHrefs();
    expect(hrefs).toHaveLength(2);
    expect(hrefs[1]).toContain('family=Oswald');
    expect(hrefs[1]).not.toContain('family=Inter');
  });

  it('no-ops when given an empty list', () => {
    ensureFontFacesLoaded([], new Set<string>());
    expect(linkHrefs()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "useLazyFontFaces"`
Expected: FAIL — module / `ensureFontFacesLoaded` does not exist.

- [ ] **Step 3: Implement the loader + hook**

Create `app/.../design-kit-wizard/useLazyFontFaces.ts`:

```typescript
import { useCallback, useRef } from 'react';

/** Weights loaded for preview faces — small on purpose. */
const PREVIEW_WEIGHTS = '400;600';

/**
 * Inject a single Google Fonts stylesheet `<link>` for the families in `families`
 * that are not already in `registry`. Mutates `registry` to record what was loaded.
 * Pure DOM side effect; safe to call repeatedly — only new families trigger a request.
 */
export function ensureFontFacesLoaded(families: string[], registry: Set<string>): void {
  if (typeof document === 'undefined') return;
  const fresh = families.filter((f) => f && !registry.has(f));
  if (fresh.length === 0) return;

  for (const f of fresh) registry.add(f);

  const familyParams = fresh.map((f) => `family=${f.replace(/ /g, '+')}:wght@${PREVIEW_WEIGHTS}`);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute('data-design-kit-font', '');
  link.href = `https://fonts.googleapis.com/css2?${familyParams.join('&')}&display=swap`;
  document.head.appendChild(link);
}

/**
 * Hook returning a stable `requestFonts(families)` callback that lazily loads
 * preview faces for the given families, deduped across the component's lifetime.
 */
export function useLazyFontFaces(): (families: string[]) => void {
  const registry = useRef<Set<string>>(new Set());
  return useCallback((families: string[]) => {
    ensureFontFacesLoaded(families, registry.current);
  }, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter website test "useLazyFontFaces"`
Expected: PASS (all five tests).

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/[market]/develop/components/preview/design-kit-wizard/useLazyFontFaces.ts" "app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/useLazyFontFaces.test.ts"
git commit -m "feat(app): lazy, deduped font-face loader for the design-kit font picker"
```

---

## Task 5: `FontPicker` component — pairings + windowed, searchable comboboxes

**Prerequisite:** `pnpm --filter @airo/shared build` has been run (Task 2 Step 7) so `@airo/shared/fonts` resolves in website tests, exactly as other `@airo/shared/*` subpaths do.

**Resolution rule:** curated fonts (derived from `FONT_THEMES`) take precedence for weights (hand-tuned + deterministic); the catalog is the fallback for any other family. This keeps curated selections stable regardless of catalog contents.

**Files:**
- Create: `app/.../design-kit-wizard/FontPicker.tsx`
- Create: `app/.../design-kit-wizard/__tests__/FontPicker.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `app/.../design-kit-wizard/__tests__/FontPicker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { FontPicker, visibleRange } from '../FontPicker';

describe('visibleRange', () => {
  it('renders only a bounded window even for a huge list', () => {
    const [start, end] = visibleRange(1800, 0, 224, 40, 5);
    expect(start).toBe(0);
    expect(end - start).toBeLessThanOrEqual(20);
  });

  it('shifts the window as the list is scrolled', () => {
    const [start, end] = visibleRange(1800, 4000, 224, 40, 5);
    expect(start).toBeGreaterThan(80);
    expect(end - start).toBeLessThanOrEqual(20);
  });

  it('returns an empty range for an empty list', () => {
    expect(visibleRange(0, 0, 224, 40, 5)).toEqual([0, 0]);
  });
});

describe('FontPicker', () => {
  it('applies both fonts (with curated weights) when a pairing chip is clicked', () => {
    const onApply = vi.fn();
    render(<FontPicker headingName="Inter" bodyName="Inter" onApply={onApply} />);

    fireEvent.click(screen.getByTestId('pairing-modern-professional'));

    expect(onApply).toHaveBeenCalledWith(
      { name: 'Montserrat', weights: ['600', '700'], category: 'sans-serif' },
      { name: 'Inter', weights: ['400', '500', '600'], category: 'sans-serif' },
    );
  });

  it('selecting a curated heading font reports it with its real weights, body unchanged', () => {
    const onApply = vi.fn();
    render(<FontPicker headingName="Inter" bodyName="Inter" onApply={onApply} />);

    fireEvent.click(screen.getByTestId('heading-font-select'));
    fireEvent.click(screen.getByText('Merriweather'));

    expect(onApply).toHaveBeenCalledWith(
      { name: 'Merriweather', weights: ['700', '900'], category: 'serif' },
      { name: 'Inter', weights: ['400', '500', '600'], category: 'sans-serif' },
    );
  });

  it('filters the curated list by search query', () => {
    const onApply = vi.fn();
    render(<FontPicker headingName="Inter" bodyName="Inter" onApply={onApply} />);

    fireEvent.click(screen.getByTestId('body-font-select'));
    fireEvent.change(screen.getByLabelText('Search fonts'), { target: { value: 'lora' } });

    expect(screen.getByText('Lora')).toBeInTheDocument();
    expect(screen.queryByText('Montserrat')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter website test "FontPicker"`
Expected: FAIL — module / exports do not exist.

- [ ] **Step 3: Implement `FontPicker.tsx`**

Create `app/.../design-kit-wizard/FontPicker.tsx`:

```tsx
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { FONT_THEMES, loadGoogleFontsCatalog, type FontInfo, type GoogleFontEntry } from '@airo/shared/fonts';

import type { FontChoice } from './designKitApi';
import { useLazyFontFaces } from './useLazyFontFaces';
import { useDismiss } from './DesignKitPanels';

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 224;
const OVERSCAN = 5;
const AIRO = 'var(--color-ai)';

/** Curated fonts derived from FONT_THEMES (first occurrence wins for weights). */
const CURATED_BY_NAME: Map<string, FontInfo> = (() => {
  const m = new Map<string, FontInfo>();
  for (const theme of Object.values(FONT_THEMES)) {
    if (!m.has(theme.headerFont.name)) m.set(theme.headerFont.name, theme.headerFont);
    if (!m.has(theme.bodyFont.name)) m.set(theme.bodyFont.name, theme.bodyFont);
  }
  return m;
})();
const CURATED_NAMES: string[] = [...CURATED_BY_NAME.keys()];

/** Resolve a family name to a FontChoice: curated weights win, then catalog, then a safe default. */
function resolveFont(family: string, catalog: GoogleFontEntry[] | null): FontChoice {
  const curated = CURATED_BY_NAME.get(family);
  if (curated) return curated;
  const entry = catalog?.find((e) => e.family === family);
  if (entry) return { name: entry.family, weights: entry.weights, category: entry.category };
  return { name: family, weights: ['400', '700'], category: 'sans-serif' };
}

/** Pure windowing: [start, end) of rows to render for the current scroll position. */
export function visibleRange(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): [number, number] {
  if (count === 0) return [0, 0];
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleRows = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(count, start + visibleRows);
  return [start, end];
}

function Combobox({
  value,
  testId,
  catalog,
  onOpen,
  onSelect,
}: {
  value: string;
  testId: string;
  catalog: GoogleFontEntry[] | null;
  onOpen: () => void;
  onSelect: (family: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const requestFonts = useLazyFontFaces();
  useDismiss(open, ref, () => setOpen(false));

  const all = catalog ? catalog.map((e) => e.family) : CURATED_NAMES;
  const q = query.trim().toLowerCase();
  const filtered = q ? all.filter((f) => f.toLowerCase().includes(q)) : all;
  const [start, end] = visibleRange(filtered.length, scrollTop, VIEWPORT_HEIGHT, ROW_HEIGHT, OVERSCAN);
  const windowed = filtered.slice(start, end);

  useEffect(() => {
    if (open) requestFonts(windowed);
  }, [open, requestFonts, windowed.join(',')]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setQuery(''); setScrollTop(0); onOpen(); }}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-1 text-left transition-colors hover:border-[color-mix(in_srgb,var(--color-ai)_45%,transparent)]"
      >
        <span className="text-sm text-intents-ux-box-foregroundColor">{value}</span>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#9a9aa3' }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-1.5 shadow-[0_12px_32px_-8px_rgba(24,24,30,0.28)]">
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setScrollTop(0); }}
            placeholder="Search fonts"
            aria-label="Search fonts"
            className="mb-1 w-full rounded-md border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor px-2.5 py-2 text-xs text-intents-ux-box-foregroundColor outline-none"
          />
          <ul
            role="listbox"
            onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
            style={{ height: VIEWPORT_HEIGHT, overflowY: 'auto' }}
          >
            <li aria-hidden style={{ height: start * ROW_HEIGHT }} />
            {windowed.map((opt) => {
              const selected = opt === value;
              return (
                <li key={opt} role="option" aria-selected={selected} style={{ height: ROW_HEIGHT }}>
                  <button
                    type="button"
                    onClick={() => { onSelect(opt); setOpen(false); }}
                    className={`flex h-full w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 text-left transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor ${selected ? 'bg-intents-ux-boxLowContrast-backgroundColor' : ''}`}
                  >
                    <span className="truncate text-base leading-none text-intents-ux-box-foregroundColor" style={{ fontFamily: opt }}>{opt}</span>
                    {selected && <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: AIRO }}><path d="M5 13l4 4L19 7" /></svg>}
                  </button>
                </li>
              );
            })}
            <li aria-hidden style={{ height: Math.max(0, filtered.length - end) * ROW_HEIGHT }} />
            {filtered.length === 0 && <li className="px-2.5 py-2 text-xs text-intents-ux-feedbackHighContrastPassive-feedbackColor">No fonts match “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Hybrid font picker: curated FONT_THEMES pairings (one-click apply both) plus
 * heading/body comboboxes searchable over the full Google Fonts catalog (lazily
 * loaded on first open, windowed so 1000+ fonts never mount at once).
 */
export function FontPicker({
  headingName,
  bodyName,
  onApply,
}: {
  headingName: string;
  bodyName: string;
  onApply: (heading: FontChoice, body: FontChoice) => void;
}): JSX.Element {
  const [catalog, setCatalog] = useState<GoogleFontEntry[] | null>(null);
  const loadingRef = useRef(false);

  function loadCatalog(): void {
    if (catalog || loadingRef.current) return;
    loadingRef.current = true;
    void loadGoogleFontsCatalog().then(setCatalog).catch(() => { loadingRef.current = false; });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(FONT_THEMES).map(([id, theme]) => (
          <button
            key={id}
            type="button"
            data-testid={`pairing-${id}`}
            onClick={() => onApply(theme.headerFont, theme.bodyFont)}
            title={theme.description}
            className="rounded-full border border-intents-ux-box-borderColor px-2.5 py-1 text-xs text-intents-ux-box-foregroundColor transition-colors hover:border-[color-mix(in_srgb,var(--color-ai)_45%,transparent)]"
          >
            {theme.name}
          </button>
        ))}
      </div>
      <div>
        <span className="mb-1 block text-[11px] uppercase tracking-[0.1em] text-intents-ux-boxPassive-foregroundColor">Headline text</span>
        <p className="mb-2 text-4xl leading-none text-intents-ux-box-foregroundColor" style={{ fontFamily: headingName }}>{headingName}</p>
        <Combobox
          testId="heading-font-select"
          value={headingName}
          catalog={catalog}
          onOpen={loadCatalog}
          onSelect={(family) => onApply(resolveFont(family, catalog), resolveFont(bodyName, catalog))}
        />
      </div>
      <div>
        <span className="mb-1 block text-[11px] uppercase tracking-[0.1em] text-intents-ux-boxPassive-foregroundColor">Body text</span>
        <p className="mb-2 text-3xl leading-none text-intents-ux-box-foregroundColor" style={{ fontFamily: bodyName }}>{bodyName}</p>
        <Combobox
          testId="body-font-select"
          value={bodyName}
          catalog={catalog}
          onOpen={loadCatalog}
          onSelect={(family) => onApply(resolveFont(headingName, catalog), resolveFont(family, catalog))}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Export `useDismiss` from DesignKitPanels for reuse**

`Combobox` imports `useDismiss` from `DesignKitPanels`. In `DesignKitPanels.tsx`, change its declaration (`:114`) from `function useDismiss(` to `export function useDismiss(`. (No behavior change; it stays used internally too.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter website test "FontPicker"`
Expected: PASS — 3 `visibleRange` + 3 `FontPicker` tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter website typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "app/src/app/[market]/develop/components/preview/design-kit-wizard/FontPicker.tsx" "app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/FontPicker.test.tsx" "app/src/app/[market]/develop/components/preview/design-kit-wizard/DesignKitPanels.tsx"
git commit -m "feat(app): hybrid FontPicker — curated pairings + searchable, windowed Google Fonts"
```

---

## Task 6: Wire `FontPicker` into `FontsPanel`, delete `fontOptions.ts`, verify

**Files:**
- Modify: `app/.../design-kit-wizard/DesignKitPanels.tsx`
- Modify: `app/.../design-kit-wizard/__tests__/FontsPanel.test.tsx`
- Delete: `app/.../design-kit-wizard/fontOptions.ts`

- [ ] **Step 1: Update FontsPanel's test to the new contract (write first — it will fail)**

Replace the body of `app/.../design-kit-wizard/__tests__/FontsPanel.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { FontsPanel } from '../DesignKitPanels';

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: (): { sendMessage: ReturnType<typeof vi.fn> } => ({
    sendMessage: vi.fn(async () => undefined),
  }),
}));

describe('FontsPanel', () => {
  it('reports a curated pairing (heading + body, with weights) via onApply', () => {
    const onApply = vi.fn();
    render(<FontsPanel headingName="Inter" bodyName="Inter" onApply={onApply} onRegenerate={vi.fn()} />);

    fireEvent.click(screen.getByTestId('pairing-elegant-serif'));

    expect(onApply).toHaveBeenCalledWith(
      { name: 'Playfair Display', weights: ['600', '700'], category: 'serif' },
      { name: 'Lora', weights: ['400', '500', '600'], category: 'serif' },
    );
  });

  it('fires onRegenerate from the panel action', () => {
    const onRegenerate = vi.fn();
    render(<FontsPanel headingName="Inter" bodyName="Inter" onApply={vi.fn()} onRegenerate={onRegenerate} />);

    fireEvent.click(screen.getByTestId('fonts-regenerate'));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter website test "FontsPanel"`
Expected: FAIL — `pairing-elegant-serif` not found (FontsPanel still renders the old `FontSelect`s).

- [ ] **Step 3: Remove the dead font code from DesignKitPanels.tsx**

In `app/.../design-kit-wizard/DesignKitPanels.tsx`:

- Delete the import `import { BODY_FONTS, HEADING_FONTS } from './fontOptions';` (`:24`).
- Add the FontPicker import next to the other local imports: `import { FontPicker } from './FontPicker';`
- Delete the entire local `useGoogleFonts` function (`:95-111` — the one that injects a single combined `<link>`; `FontPicker` now handles faces via `useLazyFontFaces`).
- Delete its call site `useGoogleFonts([...new Set([...HEADING_FONTS.map(...), ...BODY_FONTS.map(...), headingName, bodyName])]);` (`:303`).
- Delete the entire `FontSelect` component (`:220-271`) — it is only used by `FontsPanel`.

(Keep `useDismiss` exported per Task 5 Step 4; it is still used by other panels in this file.)

- [ ] **Step 4: Update `applyFonts` to take resolved FontChoice objects**

Replace `applyFonts` (`:315-322`) with:

```tsx
  function applyFonts(heading: FontChoice, body: FontChoice): void {
    setHeadingName(heading.name);
    setBodyName(body.name);
    previewFontInIframe({ headerFont: heading, bodyFont: body });
    void designKitApi.setFonts(appId, heading, body);
  }
```

The existing call site `<FontsPanel ... onApply={applyFonts} ... />` (`:329`) needs no change — the prop type now matches.

- [ ] **Step 5: Replace FontsPanel's body with FontPicker**

Replace the `FontsPanel` component (`:365-394`) with:

```tsx
export function FontsPanel({
  headingName,
  bodyName,
  onApply,
  onRegenerate,
}: {
  headingName: string;
  bodyName: string;
  onApply: (heading: FontChoice, body: FontChoice) => void;
  onRegenerate: () => void;
}): JSX.Element {
  return (
    <Panel testId="panel-fonts" kicker="Typography" title="Fonts" icon={<FontsPairingIcon className="h-4 w-4" />} action={<Regenerate testId="fonts-regenerate" label="Regenerate fonts" onClick={onRegenerate} />}>
      <FontPicker headingName={headingName} bodyName={bodyName} onApply={onApply} />
    </Panel>
  );
}
```

- [ ] **Step 6: Delete the obsolete hard-coded list**

Run: `git rm "app/src/app/[market]/develop/components/preview/design-kit-wizard/fontOptions.ts"`
Expected: file staged for deletion. (Confirm nothing else imports it: `grep -rn "fontOptions" app/src` returns no results.)

- [ ] **Step 7: Run the FontsPanel test to verify it passes**

Run: `pnpm --filter website test "FontsPanel"`
Expected: PASS (both tests).

- [ ] **Step 8: Full verification across affected packages**

Run each and confirm PASS / no errors:

```bash
pnpm --filter @airo/shared test "fonts"
pnpm --filter @airo/agents test:unit "font-theme"
pnpm --filter @airo/agents test:unit "design-kit"
pnpm --filter website test "design-kit-wizard"
pnpm typecheck
pnpm lint
pnpm build
```

Also confirm the preserved E2E hooks still exist (no E2E updates needed — `data-testid`s `heading-font-select`, `body-font-select`, `fonts-regenerate`, `panel-fonts` are retained):

```bash
grep -rn "heading-font-select\|body-font-select\|panel-fonts" tests/
```

If any E2E spec asserted the *old* fixed option set (e.g. expected exactly the 6 fonts), update it to the new picker behavior (pairing chips + search).

- [ ] **Step 9: Commit**

```bash
git add "app/src/app/[market]/develop/components/preview/design-kit-wizard/DesignKitPanels.tsx" "app/src/app/[market]/develop/components/preview/design-kit-wizard/__tests__/FontsPanel.test.tsx"
git commit -m "feat(app): use hybrid FontPicker in the Design Kit fonts panel; remove hard-coded fontOptions"
```

---

## Self-Review

**Spec coverage:**
- Decision 1 (bundled static catalog, manual refresh) → Task 2 (script + generated `.ts` module). ✓
- Decision 2 (`FONT_THEMES` in `@airo/shared`, single source of truth) → Task 1. ✓
- Decision 3 (`/design-kit/fonts` validation, best-effort) → Task 3. ✓
- Hybrid picker: curated pairings + any-font search → Task 5 (pairings chips + comboboxes over catalog). ✓
- Dynamic/lazy loading (no 1000+ faces at once) → Task 4 (lazy face loader) + Task 5 (windowing + dynamic catalog import). ✓
- Real weights fix (replaces hard-coded `['600','700']`) → Task 5 `resolveFont` + Task 6 `applyFonts(FontChoice, FontChoice)`. ✓
- Delete `fontOptions.ts` → Task 6. ✓

**Type consistency:** `FontInfo`/`GoogleFontEntry`/`FontPairing` defined in Task 1, used unchanged in Tasks 2/5. `FontInfo` (category: `FontCategory`) is assignable to `FontChoice` (category: `string`) — pairing chips pass `theme.headerFont`/`bodyFont` (FontInfo) directly to `onApply(heading: FontChoice, body: FontChoice)`. `validateFontPairing` signature defined in Task 3 matches its route call and test mock. `visibleRange`/`resolveFont`/`ensureFontFacesLoaded` signatures are consistent across their definitions and call sites.

**Placeholder scan:** none — every code/step is concrete. The only manual action requiring an external input is the Google Fonts API key in Task 2 Step 2 (documented, free, one-time).

**Note for executor:** Tasks 1→2→3 (shared + agents) and 4→5→6 (app) are mostly independent, but Task 5 depends on Task 1+2 (the `@airo/shared/fonts` export + built dist) and Task 4 (`useLazyFontFaces`). Execute in numeric order.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-09-design-kit-font-picker.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

---

# PLAN REVISION (2026-06-09) — Keyless catalog source + Google Fonts tag filters

This revision SUPERSEDES Task 2's generation script and extends Task 1's `GoogleFontEntry`.
Tasks 1, 3, 4, 5, 6 implementation already landed (commits on `feat/design-kit-wizard`)
with a 352-entry hand seed and a keyed script. This revision (a) makes the script keyless
and regenerates the real ~1,900-font catalog, and (b) adds discovery-tag filters to the
picker. See spec Decisions 1 (revised) + 4 and "Slice 2".

## Task R1: Keyless catalog generation + `tags` field (shared)

**Files:**
- Modify: `packages/shared/src/fonts/types.ts` (add `tags` to `GoogleFontEntry`)
- Rewrite: `packages/shared/scripts/gen-google-fonts-catalog.mjs` (keyless, hybrid + tags)
- Regenerate: `packages/shared/src/fonts/google-fonts-catalog.ts` (run the script — now keyless)

- [ ] **Step 1: Add `tags` to `GoogleFontEntry`**

In `packages/shared/src/fonts/types.ts`, extend the interface:

```typescript
export interface GoogleFontEntry {
  family: string;
  category: FontCategory;
  weights: string[];
  /** Google Fonts discovery tags as canonical "UILabel/Tag" strings, e.g. "Feeling/Calm". */
  tags: string[];
}
```

- [ ] **Step 2: Rewrite the generation script (keyless hybrid)**

Replace `packages/shared/scripts/gen-google-fonts-catalog.mjs` with:

```javascript
#!/usr/bin/env node
/**
 * Regenerate src/fonts/google-fonts-catalog.ts from two KEYLESS public sources:
 *   1. https://fonts.google.com/metadata/fonts        -> family, category, weights
 *   2. https://raw.githubusercontent.com/google/fonts/main/tags/all/families.csv -> tags
 *
 * No API key required. Run manually to refresh:
 *   node packages/shared/scripts/gen-google-fonts-catalog.mjs
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const META_URL = 'https://fonts.google.com/metadata/fonts';
const TAGS_URL = 'https://raw.githubusercontent.com/google/fonts/main/tags/all/families.csv';
const TAG_SCORE_THRESHOLD = 50;
const PREFERRED_WEIGHTS = ['300', '400', '500', '600', '700'];

const CATEGORY_MAP = {
  'sans serif': 'sans-serif',
  serif: 'serif',
  monospace: 'monospace',
  handwriting: 'cursive',
  display: 'sans-serif',
};

// CSV top-level group -> Google Fonts UI label. Dropped groups (Purpose, Quality,
// Seasonal, Special use) are not surfaced as filters.
const GROUP_LABEL = {
  Expressive: 'Feeling',
  Theme: 'Appearance',
  Monospace: 'Appearance',
  Script: 'Calligraphy',
  Serif: 'Serif',
  Slab: 'Serif',
  Sans: 'Sans Serif',
};

function mapCategory(metaCategory) {
  return CATEGORY_MAP[String(metaCategory).trim().toLowerCase()] ?? 'sans-serif';
}

/** numeric weight keys from the metadata `fonts` map (drop italics like "400i"). */
function normalizeWeights(fontsObj) {
  const available = new Set(
    Object.keys(fontsObj ?? {}).filter((k) => /^\d+$/.test(k)),
  );
  const chosen = PREFERRED_WEIGHTS.filter((w) => available.has(w));
  if (!chosen.includes('400')) chosen.unshift('400');
  return chosen.length ? [...new Set(chosen)] : ['400'];
}

/** Parse families.csv -> Map<family, Set<"UILabel/Tag">> keeping score >= threshold. */
function parseTags(csv) {
  const byFamily = new Map();
  for (const line of csv.split('\n')) {
    if (!line.trim()) continue;
    // family, axis, /Group/Tag, score  (family may contain no commas in this dataset)
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const family = parts[0].trim();
    const tagPath = parts[2].trim();
    const score = Number(parts[3]);
    if (!family || !tagPath.startsWith('/') || Number.isNaN(score)) continue;
    if (score < TAG_SCORE_THRESHOLD) continue;
    const segs = tagPath.split('/').filter(Boolean); // ["Group","Tag",...]
    if (segs.length < 2) continue;
    const label = GROUP_LABEL[segs[0]];
    if (!label) continue;
    const tag = `${label}/${segs[segs.length - 1]}`;
    if (!byFamily.has(family)) byFamily.set(family, new Set());
    byFamily.get(family).add(tag);
  }
  return byFamily;
}

const metaRes = await fetch(META_URL);
if (!metaRes.ok) { console.error(`metadata/fonts: ${metaRes.status}`); process.exit(1); }
let metaText = await metaRes.text();
metaText = metaText.replace(/^\)\]\}'\s*/, ''); // strip XSSI prefix if present
const { familyMetadataList } = JSON.parse(metaText);

const tagsRes = await fetch(TAGS_URL);
if (!tagsRes.ok) { console.error(`families.csv: ${tagsRes.status}`); process.exit(1); }
const tagsByFamily = parseTags(await tagsRes.text());

const catalog = familyMetadataList
  .map((m) => ({
    family: m.family,
    category: mapCategory(m.category),
    weights: normalizeWeights(m.fonts),
    tags: [...(tagsByFamily.get(m.family) ?? [])].sort(),
  }))
  .sort((a, b) => a.family.localeCompare(b.family));

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '../src/fonts/google-fonts-catalog.ts');
const header =
  `// AUTO-GENERATED by scripts/gen-google-fonts-catalog.mjs — do not edit by hand.\n` +
  `// Keyless refresh: node packages/shared/scripts/gen-google-fonts-catalog.mjs\n` +
  `import type { GoogleFontEntry } from './types.js';\n\n` +
  `export const GOOGLE_FONTS_CATALOG: GoogleFontEntry[] = `;
await writeFile(outPath, `${header}${JSON.stringify(catalog, null, 2)};\n`, 'utf8');
const tagged = catalog.filter((c) => c.tags.length).length;
console.log(`Wrote ${catalog.length} fonts (${tagged} with tags) to ${outPath}`);
```

- [ ] **Step 3: Run the script (no key needed) to regenerate the real catalog**

Run: `node packages/shared/scripts/gen-google-fonts-catalog.mjs`
Expected: `Wrote ~1900 fonts (~1900 with tags) to .../google-fonts-catalog.ts`. This replaces
the hand seed with the full library. Confirm the 8 curated families still appear and that
entries now include a `tags` array (e.g. an entry with `"Feeling/Calm"`).

- [ ] **Step 4: Rebuild shared + typecheck**

Run: `pnpm --filter @airo/shared build`
Expected: success; `dist/fonts/google-fonts-catalog.js` regenerated.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fonts/types.ts packages/shared/scripts/gen-google-fonts-catalog.mjs packages/shared/src/fonts/google-fonts-catalog.ts
git commit -m "feat(shared): keyless Google Fonts catalog (metadata + tags CSV) with discovery tags"
```

## Task R2: Tag-filter UI in `FontPicker` (app)

Adds a `Filters ▾` panel inside the search dropdown with the 5 GF groups (Feeling,
Appearance, Calligraphy, Serif, Sans Serif). Semantics: **OR within a group, AND across
groups**. Depends on Task R1 (the `tags` field + real catalog).

**Files:**
- Modify: `app/.../design-kit-wizard/FontPicker.tsx`

- [ ] **Step 1: Add tag helpers near the top of `FontPicker.tsx`** (after `resolveFont`)

```tsx
/** GF discovery groups in display order. Tags are canonical "Label/Tag" strings. */
const GROUP_ORDER = ['Feeling', 'Appearance', 'Calligraphy', 'Serif', 'Sans Serif'];

/** Build the ordered, deduped tag groups present in the catalog for the filter UI. */
export function buildTagGroups(catalog: GoogleFontEntry[]): Array<{ label: string; tags: string[] }> {
  const map = new Map<string, Set<string>>();
  for (const e of catalog) {
    for (const t of e.tags) {
      const label = t.slice(0, t.indexOf('/'));
      if (!GROUP_ORDER.includes(label)) continue;
      if (!map.has(label)) map.set(label, new Set());
      map.get(label)!.add(t);
    }
  }
  return GROUP_ORDER.filter((l) => map.has(l)).map((l) => ({ label: l, tags: [...map.get(l)!].sort() }));
}

/** OR within a group, AND across groups. Empty selection passes everything through. */
export function filterByTags(entries: GoogleFontEntry[], selected: string[]): GoogleFontEntry[] {
  if (selected.length === 0) return entries;
  const byGroup = new Map<string, string[]>();
  for (const t of selected) {
    const g = t.slice(0, t.indexOf('/'));
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(t);
  }
  return entries.filter((e) => {
    const tagSet = new Set(e.tags);
    for (const groupTags of byGroup.values()) {
      if (!groupTags.some((t) => tagSet.has(t))) return false;
    }
    return true;
  });
}
```

- [ ] **Step 2: Replace the `Combobox` component** (`:49-130`) with the filter-aware version

```tsx
function Combobox({
  value,
  testId,
  catalog,
  onOpen,
  onSelect,
}: {
  value: string;
  testId: string;
  catalog: GoogleFontEntry[] | null;
  onOpen: () => void;
  onSelect: (family: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const requestFonts = useLazyFontFaces();
  useDismiss(open, ref, () => setOpen(false));

  const groups = catalog ? buildTagGroups(catalog) : [];
  const q = query.trim().toLowerCase();
  const tagFiltered = catalog ? filterByTags(catalog, selectedTags).map((e) => e.family) : CURATED_NAMES;
  const filtered = q ? tagFiltered.filter((f) => f.toLowerCase().includes(q)) : tagFiltered;
  const [start, end] = visibleRange(filtered.length, scrollTop, VIEWPORT_HEIGHT, ROW_HEIGHT, OVERSCAN);
  const windowed = filtered.slice(start, end);

  useEffect(() => {
    if (open) requestFonts(windowed);
  }, [open, requestFonts, windowed.join(',')]);

  function toggleTag(tag: string): void {
    setScrollTop(0);
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setQuery(''); setScrollTop(0); onOpen(); }}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-1 text-left transition-colors hover:border-[color-mix(in_srgb,var(--color-ai)_45%,transparent)]"
      >
        <span className="text-sm text-intents-ux-box-foregroundColor">{value}</span>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#9a9aa3' }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-1.5 shadow-[0_12px_32px_-8px_rgba(24,24,30,0.28)]">
          <div className="mb-1 flex items-center gap-1">
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setScrollTop(0); }}
              placeholder="Search fonts"
              aria-label="Search fonts"
              className="w-full rounded-md border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor px-2.5 py-2 text-xs text-intents-ux-box-foregroundColor outline-none"
            />
            {groups.length > 0 && (
              <button
                type="button"
                data-testid={`${testId}-filters-toggle`}
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((f) => !f)}
                className={`shrink-0 rounded-md border px-2 py-2 text-xs transition-colors ${selectedTags.length ? 'border-[color-mix(in_srgb,var(--color-ai)_55%,transparent)] text-intents-ux-box-foregroundColor' : 'border-intents-ux-box-borderColor text-intents-ux-boxPassive-foregroundColor'}`}
              >
                Filters{selectedTags.length ? ` (${selectedTags.length})` : ''} ▾
              </button>
            )}
          </div>
          {filtersOpen && groups.length > 0 && (
            <div data-testid={`${testId}-filters`} className="mb-1 max-h-40 overflow-auto rounded-md border border-intents-ux-box-borderColor p-1.5">
              {selectedTags.length > 0 && (
                <button type="button" onClick={() => { setSelectedTags([]); setScrollTop(0); }} className="mb-1 text-[11px] text-intents-ux-link-foregroundColor underline">
                  Clear {selectedTags.length}
                </button>
              )}
              {groups.map((group) => (
                <div key={group.label} className="mb-1.5 last:mb-0">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.1em] text-intents-ux-boxPassive-foregroundColor">{group.label}</span>
                  <div className="flex flex-wrap gap-1">
                    {group.tags.map((tag) => {
                      const on = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleTag(tag)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${on ? 'border-transparent bg-[color-mix(in_srgb,var(--color-ai)_18%,transparent)] text-intents-ux-box-foregroundColor' : 'border-intents-ux-box-borderColor text-intents-ux-boxPassive-foregroundColor hover:border-[color-mix(in_srgb,var(--color-ai)_45%,transparent)]'}`}
                        >
                          {tag.slice(tag.indexOf('/') + 1)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <ul
            role="listbox"
            onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
            style={{ height: VIEWPORT_HEIGHT, overflowY: 'auto' }}
          >
            <li aria-hidden style={{ height: start * ROW_HEIGHT }} />
            {windowed.map((opt) => {
              const selected = opt === value;
              return (
                <li key={opt} role="option" aria-selected={selected} style={{ height: ROW_HEIGHT }}>
                  <button
                    type="button"
                    onClick={() => { onSelect(opt); setOpen(false); }}
                    className={`flex h-full w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 text-left transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor ${selected ? 'bg-intents-ux-boxLowContrast-backgroundColor' : ''}`}
                  >
                    <span className="truncate text-base leading-none text-intents-ux-box-foregroundColor" style={{ fontFamily: opt }}>{opt}</span>
                    {selected && <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: AIRO }}><path d="M5 13l4 4L19 7" /></svg>}
                  </button>
                </li>
              );
            })}
            <li aria-hidden style={{ height: Math.max(0, filtered.length - end) * ROW_HEIGHT }} />
            {filtered.length === 0 && <li className="px-2.5 py-2 text-xs text-intents-ux-feedbackHighContrastPassive-feedbackColor">No fonts match.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter website typecheck` (expect clean) and `pnpm --filter website lint` (fix any issues in FontPicker.tsx).

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/[market]/develop/components/preview/design-kit-wizard/FontPicker.tsx"
git commit -m "feat(app): Google Fonts discovery-tag filters in the font picker"
```

## Revised test phase (supersedes Tasks where tests reference fonts)

In the test fan-out, additionally cover:
- **shared:** catalog entries have `tags: string[]` of form `"Label/Tag"`; curated families still resolve their hand-tuned weights; `loadGoogleFontsCatalog` length > 100.
- **FontPicker:** unit-test `filterByTags` (OR-within-group, AND-across-groups, empty passes all) and `buildTagGroups` (ordered, deduped). For the interaction test, **mock `@airo/shared/fonts`'s `loadGoogleFontsCatalog`** to return a small fixture (e.g. 3 fonts with distinct tags) so opening the combobox, expanding Filters, and toggling a Feeling chip deterministically narrows the list.
