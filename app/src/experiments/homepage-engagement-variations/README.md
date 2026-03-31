# Homepage engagement variations

Location: `app/src/experiments/homepage-engagement-variations`. Import the public API from `@/experiments/homepage-engagement-variations` (e.g. `HomePageByCohort`, `COHORT_IDS`).

This folder holds **parallel implementations** of the marketing homepage, keyed by **Hivemind cohort id**. The goal is to add or remove a variant by editing this tree and `homepage-by-cohort.ts`, without scattering `if (cohort === …)` logic through shared app components.

## Documentation layout

- **This file** — shared principles, how to add/remove variants, and how to end the experiment.
- **Each cohort folder** — its own `README.md`: what that arm does, which files it duplicates vs production, and **exact steps to promote it to final code** if it wins. Examples: [`original/README.md`](original/README.md), [`light_homepage/README.md`](light_homepage/README.md).

## Principles (for new variants)

1. **One cohort id → one page component.** Register the mapping in `homepage-by-cohort.ts` (`homepageByCohort`). The Hivemind cohort string (e.g. `light_homepage`) must match the folder name and the `data-homepage-variation` attribute on the shell root.

2. **Duplicate inside the cohort folder.** If the hero, header, or other pieces differ, copy the files you need into `app/src/experiments/homepage-engagement-variations/<cohort_id>/` and change behavior only in those copies. **Do not edit** shared `@/app/components` or `@/components/layout` originals for an experiment arm—keep production files unchanged until promotion merges the winning copy in.

3. **Naming.** The **root** export may be cohort-specific (e.g. `LightHomepageHomePage`). **Child** components in that folder use normal names (`Header`, `HeroSection`, `DiscordLink`)—no cohort prefix on children.

4. **Scoped styling.** Put cohort-only CSS in `<cohort_id>/<something>-homepage.scss` and import it from that cohort’s `HomePage.tsx`. Scope selectors with `[data-homepage-variation='<cohort_id>']`. Keep experiment CSS **out** of `globals.scss` until a variant is promoted to the default product.

5. **Wiring stays thin.** `HomeContent` renders `HomePageByCohort` only. `HomePageByCohort` uses `useHivemind(EXPERIMENT_IDS.homepageEngagement)` and `homepageComponentForCohort(cohort ?? INELIGIBLE_COHORT)`.

6. **Exports.** Add a cohort id key to `COHORT_IDS` in `homepage-by-cohort.ts` and export `COHORT_IDS` from `index.ts` if other modules need it. Extend `homepage-by-cohort.test.ts` with one assertion: that cohort resolves to the correct component.

## How to add a new variant

1. Create `app/src/experiments/homepage-engagement-variations/<cohort_id>/` (folder name **equals** Hivemind cohort id).
2. Copy from `original/` (and duplicate any shared components that must differ under the new folder).
3. Export a single root component from `HomePage.tsx` with `data-homepage-variation="<cohort_id>"` on the outer shell.
4. Add the SCSS file for that cohort and import it from its `HomePage.tsx`.
5. In `homepage-by-cohort.ts`: add your cohort string to `COHORT_IDS` and register `[COHORT_IDS.YOUR_KEY, YourHomePage]` in `homepageByCohort`.
6. Re-export `COHORT_IDS` from `index.ts` if needed.
7. Add a test case in `homepage-by-cohort.test.ts`.
8. Add **`README.md` in that cohort folder** with promotion instructions (which canonical files to replace, where SCSS merges). Use [`light_homepage/README.md`](light_homepage/README.md) as a template.

## Remove a losing variant (any cohort)

Same steps for every non-baseline variant:

1. Delete `app/src/experiments/homepage-engagement-variations/<cohort_id>/` (including its `README.md`).
2. Remove the cohort’s entry from `homepageByCohort` in `homepage-by-cohort.ts` and remove its key from `COHORT_IDS` (and from `index.ts` exports if re-exported).
3. Update `homepage-by-cohort.test.ts` (remove assertions and imports for that component).

No other variants need to change.

## End the whole experiment

When the engagement experiment is done:

- **If the baseline wins:** Delete non-`original` variant folders, clean `homepage-by-cohort.ts` to only `OriginalHomePage`, then simplify `HomeContent` to render `OriginalHomePage` directly (or keep `HomePageByCohort` if you still read cohort for analytics only). Optionally collapse `original/HomePage.tsx` into the main app route file and delete this package.
- **If a non-original variant wins:** Follow that cohort’s **`README.md`** (promotion steps), then remove the experiment wiring as above.
