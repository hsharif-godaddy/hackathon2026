# `start_building` variation

Hivemind cohort id: **`start_building`**. Identical to `hero_content_improvement` except the submit button shows the text CTA **"Start Building"** instead of the send icon.

**i18n key:** `builder_homepage_submit_cta_start_building` · default: `"Start Building"`

## Motivation

This variant is part of an endgame experiment testing which submit button copy drives higher homepage conversion. `hero_content_improvement` is the winning base (97% of original traffic); these 6 variants isolate button text as the only variable to identify the best CTA before further iteration.

## Duplicates vs production

Only `HeroSection.tsx` is duplicated from `hero_content_improvement`. `HeroExamples` and `StartSection` are shared (not duplicated). `HomePage.tsx` is a thin wrapper that sets `data-homepage-variation="start_building"` for analytics attribution.

## If this variation wins (promote to final code)

1. In `hero_content_improvement/HeroSection.tsx`, replace the `<SendIcon />` button with the winning CTA:
   ```tsx
   // Remove:
   import SendIcon from '@ux/icon/send'
   // ...
   <SubmitInitialPrompt ... icon={<SendIcon />} />

   // Replace with:
   <SubmitInitialPrompt ...>
     <FormattedMessage id="builder_homepage_submit_cta_start_building" defaultMessage="Start Building" />
   </SubmitInitialPrompt>
   ```
2. Confirm the i18n key `builder_homepage_submit_cta_start_building` exists at i18n.int.gdcorp.tools for all target locales.
3. Delete the `start_building/` folder.
4. Remove `HOMEPAGE_ENGAGEMENT_COHORT_IDS.START_BUILDING` from `cohort-ids.ts` and its entry from `homepage-by-cohort.ts`.
5. Remove the other 5 losing CTA variant folders following [Remove a losing variant](../README.md#remove-a-losing-variant-any-cohort).
6. Run `pnpm --filter website typecheck` and `pnpm --filter website lint`.

## If this variation loses

Follow [Remove a losing variant](../README.md#remove-a-losing-variant-any-cohort) in the parent README.
