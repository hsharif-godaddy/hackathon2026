# Baseline homepage (`original/`)

## Role

Default homepage for Hivemind cohorts `original`, `ineligible`, and any unknown cohort (`homepageComponentForCohort` falls back here).

## Imports

Uses shared modules only: `@/app/components/HeroSection`, `@/components/layout/Header`, etc.—no duplicated layout files in this folder except `HomePage.tsx` orchestration.

## Removal

Do not delete this folder when removing a losing experiment arm. Remove or collapse it only when the whole engagement package is retired and the winning page lives elsewhere (see the [parent README](../README.md)).
