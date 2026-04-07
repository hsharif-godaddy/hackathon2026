# `abstract_animation` variation

Hivemind cohort id: **`abstract_animation`**. Interactive animated browser demo (AiroHeroAnimation) in StartSection, settings panel animation (AiroSettingsAnimation) in InfraSection, full-width prompt bar hero with "Describe your idea" copy, and reordered section layout.

## Duplicates vs production

This folder intentionally duplicates pieces that otherwise live under `app/src/app/components/` so the experiment does not touch shared files until promotion.

| Variant file       | Shared counterpart                        |
| ------------------ | ----------------------------------------- |
| `HeroSection.tsx`  | `app/src/app/components/HeroSection.tsx`  |
| `HeroExamples.tsx` | `app/src/app/components/HeroExamples.tsx` |
| `StartSection.tsx` | `app/src/app/components/StartSection.tsx` |
| `InfraSection.tsx` | `app/src/app/components/InfraSection.tsx` |

Variant-only components (net-new, no shared counterpart — all inside `animations/`):

- `animations/AiroHeroAnimation.tsx` + `AiroHeroAnimation.scss` — animated browser demo cycling through site scenarios
- `animations/AiroSettingsAnimation.tsx` + `AiroSettingsAnimation.scss` — animated settings panel with sidebar navigation
- `animations/coffeeShopTemplate.ts` — SVG assets and HTML templates for animation scenarios
- `animations/utils.ts` — shared helpers (`wait`, `prefersReducedMotion`)

## Section order (differs from `original`)

1. HeroSection (full prompt bar, "Describe your idea" copy)
2. StartSection (AiroHeroAnimation browser demo)
3. FeaturesSection (idea, editing, publish)
4. InfraSection (AiroSettingsAnimation)
5. FeaturesSection (prograde, security, future)
6. PricingSection
7. FAQSection
8. HelpSection

## If this variation wins (promote to final code)

1. Replace canonical files with the copies from this folder (resolve imports to `@/` paths after the move):
   - `abstract_animation/HeroSection.tsx` → `app/src/app/components/HeroSection.tsx`
   - `abstract_animation/HeroExamples.tsx` → `app/src/app/components/HeroExamples.tsx`
   - `abstract_animation/StartSection.tsx` → `app/src/app/components/StartSection.tsx`
   - `abstract_animation/InfraSection.tsx` → `app/src/app/components/InfraSection.tsx`
2. Replace `original/HomePage.tsx` with the content of `abstract_animation/HomePage.tsx`, then change imports back to shared modules and update `data-homepage-variation` attribute.
3. Move the animation components to shared locations:
   - `abstract_animation/animations/AiroHeroAnimation.tsx` + `.scss` → `app/src/app/components/AiroHeroAnimation/`
   - `abstract_animation/animations/AiroSettingsAnimation.tsx` + `.scss` → `app/src/app/components/AiroSettingsAnimation/`
   - `abstract_animation/animations/coffeeShopTemplate.ts` → `app/src/app/components/shared/`
   - `abstract_animation/animations/utils.ts` → `app/src/app/components/shared/`
4. Simplify `HomeContent` to render the single homepage directly, or keep `HomePageByCohort` if analytics cohort tracking is still needed.
5. Delete the `abstract_animation/` folder, remove `COHORT_IDS.ABSTRACT_ANIMATION_COHORT_ID` from `homepage-by-cohort.ts`, update `homepage-by-cohort.test.ts`, and adjust `index.ts` exports.
6. Run tests and smoke/E2E if selectors or `data-testid` changed.

## If this variation loses

Follow [Remove a losing variant](../README.md#remove-a-losing-variant-any-cohort) in the parent README. All animation components live inside the variant folder and will be deleted along with it.
