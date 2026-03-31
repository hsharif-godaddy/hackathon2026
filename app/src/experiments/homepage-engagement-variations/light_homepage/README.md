# `light_homepage` variation

Hivemind cohort id: **`light_homepage`**. Light surface, gradient shell, hero/header tweaks.

## Duplicates vs production

This folder intentionally duplicates pieces that otherwise live under `app/` and `components/layout/` so the experiment does not touch shared files until promotion.

## If this variation wins (promote to final code)

1. Replace canonical files with the copies from this folder (resolve imports to `@/` paths after the move):
   - `light_homepage/HeroSection.tsx` → `app/src/app/components/HeroSection.tsx`
   - `light_homepage/Header.tsx` → `app/src/components/layout/Header.tsx`
   - `light_homepage/DiscordLink.tsx` → `app/src/components/layout/DiscordLink.tsx`
   - `light_homepage/UserMenu.tsx` → `app/src/components/layout/UserMenu.tsx`
   - `light_homepage/InviteFriends.tsx` → `app/src/components/layout/InviteFriends.tsx`
2. Replace `original/HomePage.tsx` with the content of `light_homepage/HomePage.tsx`, then change imports back to shared modules (`@/app/components/HeroSection`, `@/components/layout/Header`, etc.) and remove the experiment-only SCSS import if the next step covers styles.
3. Merge rules from `light_homepage/light-homepage.scss` into `app/src/styles/globals.scss` (or another app-wide stylesheet) so the homepage looks correct without `data-homepage-variation`. Remove `[data-homepage-variation='light_homepage']` wrappers or repoint them if you keep a single attribute for debugging.
4. Simplify `HomeContent` to render the single homepage (e.g. import `OriginalHomePage` from `original/HomePage` after you’ve made `original` the promoted content, or move the page next to the route).
5. Delete the `light_homepage/` folder, remove `COHORT_IDS.LIGHT_HOMEPAGE_COHORT_ID` from `homepage-by-cohort.ts`, update `homepage-by-cohort.test.ts`, and adjust `index.ts` exports. Remove Hivemind routing from `HomePageByCohort` if no other cohorts remain.
6. Run tests and smoke/E2E if selectors or `data-testid` changed.

## If this variation loses

Follow [Remove a losing variant](../README.md#remove-a-losing-variant-any-cohort) in the parent README.
