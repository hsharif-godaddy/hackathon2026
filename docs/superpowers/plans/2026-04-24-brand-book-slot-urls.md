# Brand Book Logo Display via Media Manifest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the brand book LogoSection read logo images from the media manifest (slot system) instead of the `brand.logo` memory key, so logo swaps in the LogoGridWidget immediately reflect in the brand book.

**Architecture:** BrandBookView (index.tsx) calls `useMediaManifest` to get logo slot data, derives URLs from `currentUrl` and `solidUrlMap`, and passes them to LogoSection. LogoSection renders these URLs instead of reading `data.logo`. When slots are updated (user swap or agent generation), React Query invalidation triggers a manifest refetch, new URLs flow in, and images update.

**Tech Stack:** React, TypeScript, React Query (`@tanstack/react-query`), Next.js Image, Vitest

**Spec:** `docs/superpowers/specs/2026-04-24-brand-book-slot-urls-design.md`

---

## File Structure

| File                                                                      | Action | Responsibility                                                              |
| ------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `app/src/app/[market]/develop/components/preview/brand-book/sections.tsx` | Modify | LogoSection accepts logo URLs as props instead of reading `data.logo`       |
| `app/src/app/[market]/develop/components/preview/brand-book/index.tsx`    | Modify | Add `useMediaManifest`, derive logo URLs from manifest, pass to LogoSection |
| `app/src/hooks/websocket/handlers/ToolResultHandler.ts`                   | Modify | Remove `generateLogo`, `editLogo` from `BRAND_UPDATE_TOOLS`                 |

---

### Task 1: Update LogoSection to accept manifest-derived logo URLs

**Files:**

- Modify: `app/src/app/[market]/develop/components/preview/brand-book/sections.tsx:75-187`

- [ ] **Step 1: Update LogoSection props and rendering**

In `app/src/app/[market]/develop/components/preview/brand-book/sections.tsx`, replace the entire `LogoSection` function (lines 75-187) with:

```typescript
export function LogoSection({
  data,
  brand,
  onSuggestPrompt,
  palette,
  inverted,
  logoUrls,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  onSuggestPrompt: SuggestPromptFn;
  logoUrls?: {
    primarySrc?: string;
    solidSrc?: string;
    verticalSrc?: string;
    horizontalSrc?: string;
  };
} & SectionThemeProps) {
  const pal = data?.palette;
  // For dark-themed palettes, background is dark and foreground is light — swap for logo panels
  const isDark = pal?.theme === 'dark';
  const logoPanelLightBg = isDark ? pal?.foreground : pal?.background || '#f5f5f5';
  const logoPanelDarkBg = isDark ? pal?.background : pal?.foreground || '#1a1a1a';

  const primarySrc = logoUrls?.primarySrc;
  const solidSrc = logoUrls?.solidSrc || primarySrc;
  const verticalSrc = logoUrls?.verticalSrc;
  const horizontalSrc = logoUrls?.horizontalSrc;

  const guidelines = data?.logo?.guidelines;

  return (
    <SectionWrapper palette={palette} inverted={inverted}>
      <SectionHeader
        num="01"
        label="Primary Mark"
        title="Logo"
        brand={brand}
      />

      {!primarySrc ? (
        <SectionPlaceholder
          description="Upload or describe your logo to see it displayed here."
          prompt="Help me create a logo for my brand book"
          onSuggestPrompt={onSuggestPrompt}
        />
      ) : (
        <Box gap="lg">
          <div className={styles.logoGrid}>
            {/* Row 1, Col 1: Light */}
            <div className={styles.logoGridItem} style={{ gridArea: 'light' }}>
              <div className={styles.logoPanelSquare} style={{ backgroundColor: logoPanelLightBg }}>
                <Image
                  src={primarySrc}
                  alt="Logo on light background"
                  fill
                  unoptimized
                  className={styles.logoImage}
                />
              </div>
              <text.span as="caption">Transparent / Light</text.span>
            </div>

            {/* Row 1, Col 2: Dark */}
            <div className={styles.logoGridItem} style={{ gridArea: 'dark' }}>
              <div className={styles.logoPanelSquare} style={{ backgroundColor: logoPanelDarkBg }}>
                <Image
                  src={solidSrc}
                  alt="Logo on dark background"
                  fill
                  unoptimized
                  className={styles.logoImage}
                />
              </div>
              <text.span as="caption">Reversed / Dark</text.span>
            </div>

            {/* Row 1-2, Col 3: Vertical (spans 2 rows) */}
            {verticalSrc && (
              <div className={styles.logoGridItem} style={{ gridArea: 'vert' }}>
                <div className={styles.logoPanelWide} style={{ backgroundColor: logoPanelLightBg }}>
                  <Image
                    src={verticalSrc}
                    alt="Vertical variant"
                    fill
                    unoptimized
                    className={styles.logoImage}
                  />
                </div>
                <text.span as="caption">Vertical</text.span>
              </div>
            )}

            {/* Row 2, Col 1-2: Horizontal (spans 2 cols) */}
            {horizontalSrc && (
              <div className={styles.logoGridItem} style={{ gridArea: 'horiz' }}>
                <div className={styles.logoPanelWide} style={{ backgroundColor: logoPanelLightBg }}>
                  <Image
                    src={horizontalSrc}
                    alt="Horizontal variant"
                    fill
                    unoptimized
                    className={styles.logoImage}
                  />
                </div>
                <text.span as="caption">Horizontal</text.span>
              </div>
            )}
          </div>

          {guidelines && (
            <text.p as="paragraph">
              {guidelines}
            </text.p>
          )}
        </Box>
      )}
    </SectionWrapper>
  );
}
```

Key changes:

- New `logoUrls` optional prop with `primarySrc`, `solidSrc`, `verticalSrc`, `horizontalSrc`
- Placeholder check is now `!primarySrc` (instead of `!logo || !primarySrc`)
- Dark panel uses `solidSrc` (from `solidUrlMap`) instead of same transparent URL
- Guidelines text still reads from `data?.logo?.guidelines`
- Removed `const logo = data?.logo` and all `logo.xxx` URL reads

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter website exec tsc --noEmit 2>&1 | head -20`
Expected: Error in `index.tsx` where `LogoSection` is called without `logoUrls` prop. This is expected — Task 2 will fix the caller.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/brand-book/sections.tsx
git commit -m "refactor(brand-book): LogoSection accepts manifest-derived logo URLs

LogoSection now accepts a logoUrls prop with pre-resolved URLs from the
media manifest instead of reading data.logo CDN URLs. Placeholder state
is driven by the absence of primarySrc. Dark panel uses solidUrlMap
variant. Guidelines text still sourced from brand data."
```

---

### Task 2: Wire useMediaManifest into BrandBookView

**Files:**

- Modify: `app/src/app/[market]/develop/components/preview/brand-book/index.tsx:1-147`

- [ ] **Step 1: Add useMediaManifest and derive logo URLs**

In `app/src/app/[market]/develop/components/preview/brand-book/index.tsx`, make these changes:

**1a.** Add the import for `useMediaManifest` after the existing imports (after line 8):

```typescript
import { useMediaManifest } from "@/hooks/useMediaManifest";
```

**1b.** Inside the `BrandBookView` component, after the `useBrandStyle` call (after line 40), add:

```typescript
// Read media manifest to get logo slot URLs (single source of truth for logo images)
const { manifest } = useMediaManifest({ appId });

// Derive logo URLs from manifest slots
const logoUrls = useMemo(() => {
  const primarySlot = manifest?.["logo/primary"];
  if (!primarySlot?.currentUrl) return undefined;

  const primarySrc = primarySlot.currentUrl;
  const solidSrc = primarySlot.solidUrlMap?.[primarySrc] || primarySrc;
  const verticalSrc = manifest?.["logo/vertical"]?.currentUrl;
  const horizontalSrc = manifest?.["logo/horizontal"]?.currentUrl;

  return { primarySrc, solidSrc, verticalSrc, horizontalSrc };
}, [manifest]);
```

**1c.** Add the `useMemo` import. Update the existing React import or add it. Since this is a `'use client'` component, add at the top of the file:

```typescript
import { useMemo } from "react";
```

**1d.** Pass `logoUrls` to the `LogoSection` component. Find the existing `<LogoSection` JSX (around line 72-77):

```tsx
<LogoSection
  data={data}
  brand={brand}
  onSuggestPrompt={suggestPrompt}
  palette={palette}
/>
```

Replace with:

```tsx
<LogoSection
  data={data}
  brand={brand}
  onSuggestPrompt={suggestPrompt}
  palette={palette}
  logoUrls={logoUrls}
/>
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter website exec tsc --noEmit 2>&1 | head -20`
Expected: No errors related to brand-book files

- [ ] **Step 3: Commit**

```bash
git add app/src/app/[market]/develop/components/preview/brand-book/index.tsx
git commit -m "feat(brand-book): wire useMediaManifest for logo display

BrandBookView now reads logo URLs from the media manifest instead of
brand.logo memory. Logo swaps in LogoGridWidget and agent logo
generation automatically trigger manifest refetch via React Query
invalidation, updating the brand book immediately."
```

---

### Task 3: Remove old logo tools from BRAND_UPDATE_TOOLS

**Pre-completed:** `generateLogo` and `editLogo` were already absent from `BRAND_UPDATE_TOOLS` in `ToolResultHandler.ts` before this PR. No changes needed.

---

### Task 4: Verify full build and tests

**Files:** None (verification only)

- [ ] **Step 1: Run app tests**

Run: `pnpm --filter website test 2>&1 | tail -20`
Expected: All tests pass. If any brand-book tests fail, they likely test the old `data.logo` rendering and need updating.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter website exec tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `pnpm --filter website lint 2>&1 | tail -10`
Expected: No new lint errors

- [ ] **Step 4: Commit any fixes if needed**

Only commit if steps 1-3 surfaced issues requiring code changes.
