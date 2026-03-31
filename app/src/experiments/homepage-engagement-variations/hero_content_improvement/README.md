# `hero_content_improvement` variation

Hivemind cohort id: **`hero_content_improvement`**. Rich-text hero headline, value-prop row under the headline, examples intro line, and homepage section order (Start + idea features before Infra + pro features).

## Duplicates vs production

This folder duplicates `HeroSection`, `HeroExamples`, `StartSection` (with `id="start-section"` for the hero scroll CTA), and `HomePage` so the experiment does not change shared `app/src/app/components/*` until promotion.

## If this variation wins (promote to final code)

1. Replace `app/src/app/components/HeroSection.tsx` with `hero_content_improvement/HeroSection.tsx`, then point `ExamplesSection` back to `@/app/components/HeroExamples` and drop the cohort-only import path.
2. Replace `app/src/app/components/HeroExamples.tsx` with `hero_content_improvement/HeroExamples.tsx` (or merge the intro line and spacing into the canonical file).
3. Merge the section order from `hero_content_improvement/HomePage.tsx` into `original/HomePage.tsx` (or the single canonical homepage), keeping shared imports for `HeroSection` and layout. If the promoted layout keeps Start before Infra, either add `id="start-section"` to the shared `StartSection` or merge the cohort `StartSection` copy into it.
4. Add the new translation keys to the i18n package (see default strings in code under `builder_homepage_hero_content_*` and `builder_homepage_examples_try_these_intro`).
5. Delete the `hero_content_improvement/` folder, remove `COHORT_IDS.HERO_CONTENT_IMPROVEMENT_COHORT_ID` and `HOMEPAGE_ENGAGEMENT_HERO_CONTENT_COHORT` from routing config, update `homepage-by-cohort.test.ts`, and run tests / smoke if flows changed.

## If this variation loses

Follow [Remove a losing variant](../README.md#remove-a-losing-variant-any-cohort) in the parent README.
